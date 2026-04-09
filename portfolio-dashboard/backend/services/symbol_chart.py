"""
Symbol chart service — OHLCV data + trade overlay for the Charts tab.

Responsibilities:
- Fetch full OHLCV bars for any ticker via market_data
- Filter stock-only transactions for a symbol (options skipped — no yfinance mapping)
- Cluster same-calendar-day fills into single markers
- FIFO round-trip matching for visualizing buy→sell connections
- Per-sell realized P&L via avg-cost replay (does not touch engine's accounting)
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta

import pandas as pd

from models.schemas import (
    ClusteredTrade,
    OHLCVPoint,
    RoundTrip,
    SymbolChartResponse,
)
from utils.calculations import walk_transactions_avg_cost

logger = logging.getLogger(__name__)


def _sanitize_ohlc(o: float, h: float, l: float, c: float) -> tuple[float, float, float, float]:
    """Ensure high/low bracket the body so candlestick coloring (close vs open) is valid."""
    o, h, l, c = float(o), float(h), float(l), float(c)
    body_hi = max(o, c)
    body_lo = min(o, c)
    h = max(h, body_hi)
    l = min(l, body_lo)
    return o, h, l, c


def _normalize_yfinance_ohlcv_df(df: pd.DataFrame, *, strip_index_tz: bool = True) -> pd.DataFrame:
    """Ensure Open/High/Low/Close/Volume columns exist (yfinance shape varies by call).

    Handles MultiIndex columns, lowercase names, and frames with only Close/Adj Close.
    For intraday frames, pass strip_index_tz=False so bar order and session boundaries stay correct.
    """
    if df.empty:
        return df
    out = df.copy()
    out.index = pd.to_datetime(out.index)
    if strip_index_tz and out.index.tz is not None:
        out.index = out.index.tz_convert("UTC").tz_localize(None)
    if isinstance(out.columns, pd.MultiIndex):
        flat: list[str] = []
        for c in out.columns:
            if not isinstance(c, tuple):
                flat.append(str(c))
                continue
            picked: str | None = None
            for p in c:
                s = str(p).strip().lower().replace(" ", "_")
                if s in ("adj_close", "adjclose"):
                    picked = "Adj Close"
                    break
                if s in ("open", "high", "low", "close", "volume"):
                    picked = s.capitalize()
                    break
            flat.append(picked if picked is not None else str(c[-1]))
        out.columns = flat

    rename: dict[str, str] = {}
    for c in list(out.columns):
        raw = str(c).strip().lower().replace(" ", "_")
        if raw in ("adj_close", "adjclose"):
            rename[c] = "Adj Close"
        elif raw == "open":
            rename[c] = "Open"
        elif raw == "high":
            rename[c] = "High"
        elif raw == "low":
            rename[c] = "Low"
        elif raw == "close":
            rename[c] = "Close"
        elif raw == "volume":
            rename[c] = "Volume"
    out = out.rename(columns=rename)

    close = None
    if "Close" in out.columns:
        close = out["Close"]
    elif "Adj Close" in out.columns:
        close = out["Adj Close"]
        out["Close"] = close
    if close is None:
        logger.warning("OHLCV frame has no Close/Adj Close; skipping chart bars")
        return pd.DataFrame()

    if "Open" not in out.columns:
        out["Open"] = out["Close"]
    if "High" not in out.columns:
        out["High"] = out["Close"]
    if "Low" not in out.columns:
        out["Low"] = out["Close"]
    if "Volume" not in out.columns:
        out["Volume"] = 0.0

    return out[["Open", "High", "Low", "Close", "Volume"]]


def _bar_unix_utc_from_ts(ts: object) -> int:
    """Unix seconds UTC for lightweight-charts (yfinance uses UTC for naive intraday indices)."""
    t = pd.Timestamp(ts)
    if t.tzinfo is None:
        t = t.tz_localize("UTC")
    return int(t.tz_convert("UTC").timestamp())


def _session_date_ny(ts: object) -> str:
    t = pd.Timestamp(ts)
    if t.tzinfo is None:
        t = t.tz_localize("UTC")
    return t.tz_convert("America/New_York").date().isoformat()


def _daily_ohlcv_points_from_history_df(df: pd.DataFrame) -> list[OHLCVPoint]:
    out: list[OHLCVPoint] = []
    if df.empty:
        return out
    df = _normalize_yfinance_ohlcv_df(df, strip_index_tz=True)
    if df.empty:
        return out
    df = df.sort_index()
    day_idx = df.index.normalize()
    agg = (
        df.assign(_day=day_idx)
        .groupby("_day", sort=True)
        .agg(
            Open=("Open", "first"),
            High=("High", "max"),
            Low=("Low", "min"),
            Close=("Close", "last"),
            Volume=("Volume", "sum"),
        )
    )
    for dt, row in agg.iterrows():
        close = float(row.get("Close", 0) or 0)
        o = float(row.get("Open", close) or close)
        h = float(row.get("High", close) or close)
        l = float(row.get("Low", close) or close)
        o, h, l, c = _sanitize_ohlc(o, h, l, close)
        out.append(
            OHLCVPoint(
                date=pd.Timestamp(dt).strftime("%Y-%m-%d"),
                time=None,
                open=round(o, 6),
                high=round(h, 6),
                low=round(l, 6),
                close=round(c, 6),
                volume=round(float(row.get("Volume", 0) or 0), 0),
            )
        )
    return out


def _intraday_ohlcv_points(df: pd.DataFrame) -> list[OHLCVPoint]:
    out: list[OHLCVPoint] = []
    if df.empty:
        return out
    df = _normalize_yfinance_ohlcv_df(df, strip_index_tz=False)
    if df.empty:
        return out
    df = df.sort_index()
    for ts, row in df.iterrows():
        close = float(row.get("Close", 0) or 0)
        o = float(row.get("Open", close) or close)
        h = float(row.get("High", close) or close)
        l = float(row.get("Low", close) or close)
        o, h, l, c = _sanitize_ohlc(o, h, l, close)
        out.append(
            OHLCVPoint(
                date=_session_date_ny(ts),
                time=_bar_unix_utc_from_ts(ts),
                open=round(o, 6),
                high=round(h, 6),
                low=round(l, 6),
                close=round(c, 6),
                volume=round(float(row.get("Volume", 0) or 0), 0),
            )
        )
    return out


class SymbolChartService:
    def __init__(self, engine, market) -> None:
        self._engine = engine
        self._market = market

    def get_chart(
        self,
        symbol: str,
        start: date | None,
        end: date | None,
        timeframe: str | None = None,
    ) -> SymbolChartResponse:
        symbol = symbol.upper().strip()
        tf = (timeframe or "").strip().upper()

        ohlcv: list[OHLCVPoint] = []
        if tf == "1D":
            idf = self._market.get_intraday_last_session(
                symbol, interval="1m", lookback_period="7d"
            )
            ohlcv = _intraday_ohlcv_points(idf)
            if not ohlcv:
                logger.warning(
                    "Intraday empty for %s; falling back to short daily window", symbol
                )
                chart_end_fb = end or date.today()
                chart_start_fb = chart_end_fb - timedelta(days=7)
                df_fb = self._market.get_historical_prices(
                    symbol, chart_start_fb, chart_end_fb
                )
                ohlcv = _daily_ohlcv_points_from_history_df(df_fb)
        else:
            chart_start = start or self._engine.start_date
            chart_end = end or date.today()
            df = self._market.get_historical_prices(symbol, chart_start, chart_end)
            ohlcv = _daily_ohlcv_points_from_history_df(df)

        # --- Stock transactions only (split-adjusted; matches engine accounting) ---
        symbol_trades = [
            t for t in self._engine.accounting_transactions
            if t.symbol == symbol and t.instrument_type == "stock"
        ]
        symbol_trades.sort(key=lambda t: t.date)

        if not symbol_trades:
            return SymbolChartResponse(
                symbol=symbol,
                ohlcv=ohlcv,
                trades=[],
                round_trips=[],
                current_price=0.0,
                shares_held=0.0,
                avg_cost=0.0,
                has_trade_data=False,
            )

        current_price = self._market.get_current_price(symbol)
        shares_held = self._engine._shares_held.get(symbol, 0.0)
        avg_cost = self._engine._avg_cost.get(symbol, 0.0)

        # Walk this symbol's trades through the shared accounting function to get
        # per-date cumulative realized P&L. symbol_trades is already sorted by date.
        accounting = walk_transactions_avg_cost(symbol_trades)
        trades = self._cluster_trades(symbol_trades, current_price, shares_held, accounting.daily_cumulative_realized)
        round_trips = self._compute_round_trips(symbol_trades)

        return SymbolChartResponse(
            symbol=symbol,
            ohlcv=ohlcv,
            trades=trades,
            round_trips=round_trips,
            current_price=round(current_price, 2),
            shares_held=round(shares_held, 4),
            avg_cost=round(avg_cost, 2),
            has_trade_data=True,
        )

    # ------------------------------------------------------------------ #

    def _cluster_trades(
        self,
        trades,
        current_price: float,
        shares_held: float,
        daily_cumulative_realized: dict[str, float],
    ) -> list[ClusteredTrade]:
        """Group same-calendar-day, same-side fills into one marker.

        Per-cluster realized P&L is computed as the delta in cumulative realized P&L
        between the previous transaction date and this date. This uses the same
        avg-cost numbers as the portfolio engine (via walk_transactions_avg_cost),
        so the chart and the holdings view always agree.

        daily_cumulative_realized maps "YYYY-MM-DD" → cumulative realized after all
        transactions on that date. Groups sorted by (date, side): within a date,
        "BUY" < "SELL" alphabetically, so same-date BUY clusters are processed before
        SELL clusters, which means prev_realized always reflects the prior date when
        we hit a SELL cluster.
        """
        groups: dict[tuple[str, str], list] = defaultdict(list)
        for t in trades:
            key = (t.date.date().isoformat(), t.side)
            groups[key].append(t)

        # prev_realized tracks the cumulative realized P&L as of the end of the
        # previous date, so we can compute the per-cluster delta.
        prev_realized = 0.0
        prev_date: str | None = None

        clustered: list[ClusteredTrade] = []
        for (date_str, side), group in sorted(groups.items()):
            total_qty = sum(t.quantity for t in group)
            total_amt = sum(t.total_amount for t in group)
            avg_price = total_amt / total_qty if total_qty > 0 else 0.0

            # When the date changes, carry the previous date's cumulative forward
            # as the new baseline. Do this BEFORE computing the sell delta so that
            # prev_realized reflects the state before this date's transactions.
            if date_str != prev_date:
                if prev_date is not None:
                    prev_realized = daily_cumulative_realized.get(prev_date, prev_realized)
                prev_date = date_str

            realized: float | None = None
            unrealized: float | None = None

            if side == "SELL":
                # All sells on this date are in one cluster; their combined P&L is
                # the increase in cumulative realized vs the prior date's baseline.
                date_realized = daily_cumulative_realized.get(date_str, prev_realized)
                realized = round(date_realized - prev_realized, 2)
            elif side == "BUY" and shares_held > 0 and current_price > 0:
                unrealized = round((current_price - avg_price) * total_qty, 2)

            clustered.append(ClusteredTrade(
                date=date_str,
                side=side,
                quantity=round(total_qty, 4),
                price=round(avg_price, 2),
                total_amount=round(total_amt, 2),
                count=len(group),
                individual_trades=[
                    {
                        "date": t.date.strftime("%Y-%m-%d"),
                        "qty": round(t.quantity, 4),
                        "price": round(t.price, 2),
                        "total": round(t.total_amount, 2),
                    }
                    for t in group
                ],
                unrealized_pnl=unrealized,
                realized_pnl=realized,
            ))

        return clustered

    def _compute_round_trips(self, trades) -> list[RoundTrip]:
        """FIFO buy→sell matching for visualization only.
        Does not affect the engine's average-cost accounting."""
        buy_queue: list[list] = []  # [date, price, qty] — mutable for partial matching
        round_trips: list[RoundTrip] = []

        for t in trades:
            if t.side == "BUY":
                buy_queue.append([t.date.date(), t.price, t.quantity])
            elif t.side == "SELL":
                remaining = t.quantity
                while remaining > 0 and buy_queue:
                    buy_date, buy_price, buy_qty = buy_queue[0]
                    matched = min(remaining, buy_qty)
                    round_trips.append(RoundTrip(
                        buy_date=buy_date.isoformat(),
                        sell_date=t.date.date().isoformat(),
                        buy_price=round(buy_price, 2),
                        sell_price=round(t.price, 2),
                        quantity=round(matched, 4),
                        realized_pnl=round((t.price - buy_price) * matched, 2),
                    ))
                    remaining -= matched
                    if buy_qty > matched:
                        buy_queue[0][2] = buy_qty - matched
                    else:
                        buy_queue.pop(0)

        return round_trips
