import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import yfinance as yf
import pandas as pd

from services.debug_context import (
    apply_historical_price_overrides,
    current_price_override,
    stock_info_overrides,
)
from utils.calculations import RETRY_SLEEP_SECONDS

logger = logging.getLogger(__name__)


def _coerce_splits_to_series(raw: pd.Series | pd.DataFrame | None) -> pd.Series:
    """yfinance returns splits as a one-column DataFrame; split code expects index → ratio."""
    if raw is None:
        return pd.Series(dtype=float)
    if isinstance(raw, pd.DataFrame):
        if raw.empty or len(raw.columns) == 0:
            return pd.Series(dtype=float)
        return raw.iloc[:, 0].astype(float)
    return raw


def _close_frame_for_symbol(
    df: pd.DataFrame,
    symbol: str,
    column_name: str | None = None,
) -> pd.DataFrame:
    """Normalize yfinance close data to one scalar-valued column for a symbol."""
    if df.empty:
        return pd.DataFrame()

    series: pd.Series | pd.DataFrame
    if isinstance(df.columns, pd.MultiIndex):
        candidates = [
            col for col in df.columns
            if symbol in {str(part) for part in col}
            and ("Close" in {str(part) for part in col} or len(df.columns) == 1)
        ]
        if not candidates:
            candidates = [
                col for col in df.columns
                if symbol in {str(part) for part in col}
            ]
        if not candidates:
            return pd.DataFrame()
        series = df.loc[:, candidates[0]]
    elif "Close" in df.columns:
        series = df.loc[:, "Close"]
    elif symbol in df.columns:
        series = df.loc[:, symbol]
    elif len(df.columns) == 1:
        series = df.iloc[:, 0]
    else:
        return pd.DataFrame()

    if isinstance(series, pd.DataFrame):
        series = series.iloc[:, 0]
    series = pd.to_numeric(series, errors="coerce").dropna()
    if series.empty:
        return pd.DataFrame()

    out = pd.DataFrame({column_name or symbol: series})
    out.index = pd.to_datetime(out.index).tz_localize(None)
    return out.sort_index()


# Cache TTLs
_TTL_HISTORICAL = 43200      # 12 hours — historical data doesn't change
_TTL_INTRADAY = 45           # intraday must refresh often while the tape is moving
_NY = ZoneInfo("America/New_York")
_TTL_STOCK_INFO = 7200      # 12 hours — name/sector rarely change

# Spot price TTL: per-request toggle via `price_refresh_scope` / `?price_mode=`.
TTL_CURRENT_PRICE_LIVE = 60        # live feed on
TTL_CURRENT_PRICE_RELAXED = 300    # slow feed (5 minutes)
TTL_CURRENT_PRICE_FROZEN = 365 * 24 * 60 * 60  # no-update mode; reuse existing spot cache

PriceRefreshMode = Literal["live", "slow", "off"]

_PRICE_REFRESH_MODE: ContextVar[PriceRefreshMode] = ContextVar("_PRICE_REFRESH_MODE", default="live")


def live_prices_enabled() -> bool:
    return _PRICE_REFRESH_MODE.get() == "live"


def price_refresh_mode() -> PriceRefreshMode:
    return _PRICE_REFRESH_MODE.get()


def current_price_ttl_for_request() -> int:
    mode = _PRICE_REFRESH_MODE.get()
    if mode == "live":
        return TTL_CURRENT_PRICE_LIVE
    if mode == "slow":
        return TTL_CURRENT_PRICE_RELAXED
    return TTL_CURRENT_PRICE_FROZEN


@contextmanager
def price_refresh_scope(mode: PriceRefreshMode):
    """Set live, slow, or frozen spot price cache TTL for this request."""
    token = _PRICE_REFRESH_MODE.set(mode)
    try:
        yield
    finally:
        _PRICE_REFRESH_MODE.reset(token)


@contextmanager
def live_prices_scope(enabled: bool):
    """Backward-compatible bool scope: live (60s) vs slow (5m)."""
    with price_refresh_scope("live" if enabled else "slow"):
        yield


def _filter_us_regular_hours(df: pd.DataFrame) -> pd.DataFrame:
    """NYSE/Nasdaq regular hours in America/New_York (09:30–16:00), weekdays only."""
    if df.empty:
        return df
    idx = pd.DatetimeIndex(df.index)
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    ny = idx.tz_convert(_NY)
    minutes = ny.hour * 60 + ny.minute
    session = (ny.weekday < 5) & (minutes >= 9 * 60 + 30) & (minutes <= 16 * 60)
    return df.loc[session]


class MarketDataService:
    def __init__(self):
        self._price_cache: dict[str, pd.DataFrame] = {}
        self._info_cache: dict[str, dict] = {}
        self._cache_ts: dict[str, float] = {}

    def _is_fresh(self, key: str, ttl: int) -> bool:
        return key in self._cache_ts and (time.time() - self._cache_ts[key]) < ttl

    # --- Single-symbol methods (used by get_current_price, get_benchmark_data) ---

    def get_historical_prices(
        self, symbol: str, start: date, end: date
    ) -> pd.DataFrame:
        cache_key = f"hist_{symbol}_{start}_{end}"
        if cache_key in self._price_cache and self._is_fresh(cache_key, _TTL_HISTORICAL):
            return apply_historical_price_overrides(symbol, start, end, self._price_cache[cache_key])

        for attempt in range(3):
            try:
                ticker = yf.Ticker(symbol)
                df = ticker.history(
                    start=start.isoformat(),
                    end=(end + timedelta(days=1)).isoformat(),
                    interval="1d",
                    auto_adjust=True,
                )
                if df.empty and attempt < 2:
                    time.sleep(RETRY_SLEEP_SECONDS)
                    continue
                df.index = pd.to_datetime(df.index).tz_localize(None)
                self._price_cache[cache_key] = df
                self._cache_ts[cache_key] = time.time()
                return apply_historical_price_overrides(symbol, start, end, df)
            except Exception:
                if attempt < 2:
                    time.sleep(RETRY_SLEEP_SECONDS)
        return pd.DataFrame()

    def get_intraday_last_session(
        self,
        symbol: str,
        interval: str = "1m",
        lookback_period: str = "7d",
    ) -> pd.DataFrame:
        """1m/2m/5m bars for the most recent US regular-hours session.

        `prepost=True` avoids yfinance clipping good 1m bars when Yahoo's
        tradingPeriods \"end\" metadata is wrong (symptom: chart stopping ~lunch).
        We then keep regular session only (09:30–16:00 America/New_York).
        """
        ny_date = datetime.now(_NY).date().isoformat()
        cache_bucket = int(time.time() // _TTL_INTRADAY)
        cache_key = f"intraday_ls_{symbol}_{interval}_{lookback_period}_{ny_date}_{cache_bucket}"
        if cache_key in self._price_cache and self._is_fresh(cache_key, _TTL_INTRADAY):
            return self._price_cache[cache_key].copy()

        for attempt in range(3):
            try:
                ticker = yf.Ticker(symbol)
                df = ticker.history(
                    period=lookback_period,
                    interval=interval,
                    auto_adjust=True,
                    prepost=True,
                )
                if df.empty and attempt < 2:
                    time.sleep(RETRY_SLEEP_SECONDS)
                    continue
                if df.empty:
                    break
                df = df.sort_index()
                idx = pd.DatetimeIndex(df.index)
                if idx.tz is None:
                    idx = idx.tz_localize("UTC")
                ny = idx.tz_convert(_NY)
                session_day = ny[-1].date()
                day_mask = ny.date == session_day
                df = df.loc[day_mask]
                df = _filter_us_regular_hours(df)
                self._price_cache[cache_key] = df
                self._cache_ts[cache_key] = time.time()
                return df.copy()
            except Exception:
                if attempt < 2:
                    time.sleep(RETRY_SLEEP_SECONDS)
        return pd.DataFrame()

    def get_current_price(self, symbol: str) -> float:
        override = current_price_override(symbol)
        if override is not None:
            return override

        cache_key = f"cur_{symbol}"
        ttl = current_price_ttl_for_request()
        if cache_key in self._price_cache and self._is_fresh(cache_key, ttl):
            return float(self._price_cache[cache_key])

        for attempt in range(3):
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.fast_info
                price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
                if price is None:
                    hist = ticker.history(period="5d")
                    if not hist.empty:
                        price = float(hist["Close"].iloc[-1])
                if price is not None:
                    self._price_cache[cache_key] = price
                    self._cache_ts[cache_key] = time.time()
                    return float(price)
            except Exception:
                if attempt < 2:
                    time.sleep(RETRY_SLEEP_SECONDS)
        return 0.0

    def oldest_current_price_cache_time(self, symbols: list[str]) -> float | None:
        """Earliest `_cache_ts` among `cur_{symbol}` keys (stalest quote in the batch)."""
        times: list[float] = []
        for sym in symbols:
            key = f"cur_{sym}"
            if key in self._cache_ts:
                times.append(self._cache_ts[key])
        return min(times) if times else None

    def get_stock_info(self, symbol: str) -> dict:
        override = stock_info_overrides().get(symbol.strip().upper())
        if override is not None:
            return override

        if symbol in self._info_cache and self._is_fresh(f"info_{symbol}", _TTL_STOCK_INFO):
            return self._info_cache[symbol]

        for attempt in range(3):
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info
                result = {
                    "name": info.get("shortName", info.get("longName", symbol)),
                    "sector": info.get("sector", "Unknown"),
                    "industry": info.get("industry", "Unknown"),
                    "market_cap": info.get("marketCap", 0),
                }
                self._info_cache[symbol] = result
                self._cache_ts[f"info_{symbol}"] = time.time()
                return result
            except Exception:
                if attempt < 2:
                    time.sleep(RETRY_SLEEP_SECONDS)

        return {"name": symbol, "sector": "Unknown", "industry": "Unknown", "market_cap": 0}

    def get_benchmark_data(self, ticker: str, start: date, end: date) -> pd.DataFrame:
        return self.get_historical_prices(ticker, start, end)

    def get_splits(self, symbol: str) -> pd.Series:
        """Return split history as a Series {date: split_ratio}.
        Empty series if no splits or fetch fails.
        """
        cache_key = f"splits_{symbol}"
        if cache_key in self._price_cache and self._is_fresh(cache_key, _TTL_HISTORICAL):
            splits = _coerce_splits_to_series(self._price_cache[cache_key])
            splits.index = pd.to_datetime(splits.index).tz_localize(None)
            self._price_cache[cache_key] = splits
            return splits

        for attempt in range(2):
            try:
                ticker = yf.Ticker(symbol)
                splits = _coerce_splits_to_series(ticker.splits)
                splits.index = pd.to_datetime(splits.index).tz_localize(None)
                self._price_cache[cache_key] = splits
                self._cache_ts[cache_key] = time.time()
                return splits
            except Exception:
                if attempt == 0:
                    time.sleep(0.3)
        return pd.Series(dtype=float)

    # --- Batch methods (used during portfolio build) ---

    def get_historical_prices_batch(
        self, symbols: list[str], start: date, end: date
    ) -> dict[str, pd.DataFrame]:
        """Fetch historical prices for multiple symbols using yf.download batch API.
        Returns dict mapping symbol -> DataFrame with Close column renamed to symbol.
        Falls back to per-symbol fetch for any that fail.
        """
        results: dict[str, pd.DataFrame] = {}

        # Split into cached (skip) and uncached (fetch)
        uncached = []
        for symbol in symbols:
            cache_key = f"hist_{symbol}_{start}_{end}"
            if cache_key in self._price_cache and self._is_fresh(cache_key, _TTL_HISTORICAL):
                df = apply_historical_price_overrides(symbol, start, end, self._price_cache[cache_key])
                normalized = _close_frame_for_symbol(df, symbol)
                if not normalized.empty:
                    results[symbol] = normalized
            else:
                uncached.append(symbol)

        if not uncached:
            return results

        logger.info(f"Batch downloading prices for {len(uncached)} symbols...")

        for attempt in range(2):
            try:
                raw = yf.download(
                    uncached,
                    start=start.isoformat(),
                    end=(end + timedelta(days=1)).isoformat(),
                    interval="1d",
                    auto_adjust=True,
                    threads=True,
                    progress=False,
                )
                if raw.empty:
                    if attempt == 0:
                        time.sleep(1)
                        continue
                    break

                # yf.download returns different structures for 1 vs multiple tickers
                if len(uncached) == 1:
                    sym = uncached[0]
                    if "Close" in raw.columns:
                        df = raw[["Close"]].copy()
                        df.index = pd.to_datetime(df.index).tz_localize(None)
                        # Cache the full DataFrame for single-symbol lookups too
                        cache_key = f"hist_{sym}_{start}_{end}"
                        self._price_cache[cache_key] = df
                        self._cache_ts[cache_key] = time.time()
                        out = apply_historical_price_overrides(sym, start, end, df)
                        normalized = _close_frame_for_symbol(out, sym)
                        if not normalized.empty:
                            results[sym] = normalized
                else:
                    # Multi-ticker: columns are MultiIndex (metric, symbol)
                    if "Close" in raw.columns.get_level_values(0):
                        close_df = raw["Close"]
                        close_df.index = pd.to_datetime(close_df.index).tz_localize(None)
                        for sym in uncached:
                            if sym in close_df.columns:
                                sym_close = close_df.loc[:, sym]
                                if isinstance(sym_close, pd.DataFrame):
                                    sym_close = sym_close.iloc[:, 0]
                                sym_close = sym_close.dropna()
                                if not sym_close.empty:
                                    # Cache the full DataFrame for single-symbol lookups
                                    full_df = pd.DataFrame({"Close": sym_close})
                                    cache_key = f"hist_{sym}_{start}_{end}"
                                    self._price_cache[cache_key] = full_df
                                    self._cache_ts[cache_key] = time.time()
                                    out = apply_historical_price_overrides(sym, start, end, full_df)
                                    normalized = _close_frame_for_symbol(out, sym)
                                    if not normalized.empty:
                                        results[sym] = normalized
                break
            except Exception as e:
                logger.warning(f"Batch download attempt {attempt + 1} failed: {e}")
                if attempt == 0:
                    time.sleep(1)

        # Fallback: fetch individually for any symbols that failed in batch
        for sym in uncached:
            if sym not in results:
                logger.info(f"Falling back to individual fetch for {sym}")
                df = self.get_historical_prices(sym, start, end)
                if not df.empty:
                    normalized = _close_frame_for_symbol(df, sym)
                    if not normalized.empty:
                        results[sym] = normalized

        return results

    def get_stock_info_batch(self, symbols: list[str]) -> dict[str, dict]:
        """Fetch stock info for multiple symbols concurrently using threads.
        Returns dict mapping symbol -> info dict.
        """
        results: dict[str, dict] = {}
        overrides = stock_info_overrides()

        # Split into cached and uncached
        uncached = []
        for symbol in symbols:
            norm_symbol = symbol.strip().upper()
            if norm_symbol in overrides:
                results[symbol] = overrides[norm_symbol]
            elif symbol in self._info_cache and self._is_fresh(f"info_{symbol}", _TTL_STOCK_INFO):
                results[symbol] = self._info_cache[symbol]
            else:
                uncached.append(symbol)

        if not uncached:
            return results

        logger.info(f"Fetching stock info for {len(uncached)} symbols in parallel...")

        # Use threads — yfinance is I/O bound, GIL doesn't matter
        max_workers = min(10, len(uncached))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_sym = {
                executor.submit(self.get_stock_info, sym): sym
                for sym in uncached
            }
            for future in as_completed(future_to_sym):
                sym = future_to_sym[future]
                try:
                    results[sym] = future.result()
                except Exception:
                    results[sym] = {
                        "name": sym, "sector": "Unknown",
                        "industry": "Unknown", "market_cap": 0,
                    }

        return results
