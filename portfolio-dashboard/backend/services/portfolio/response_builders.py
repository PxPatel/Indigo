"""
Response builder functions — pure functions that assemble Pydantic response models.

Extracted from PortfolioEngine.get_summary/history/weights/holdings(). These functions
have no side effects beyond calling market.get_current_price / get_benchmark_data.
All calculation logic is preserved exactly from the original methods.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

import numpy as np
import pandas as pd

from models.schemas import (
    Transaction,
    PortfolioSummary,
    PortfolioHistoryResponse,
    PortfolioHistoryPoint,
    PortfolioWeightsResponse,
    WeightPoint,
    HoldingsResponse,
    HoldingDetail,
)
from services.market_data import (
    MarketDataService,
    current_price_ttl_for_request,
    live_prices_enabled,
    price_refresh_mode,
)
from services.debug_context import today as debug_today
from utils.calculations import sharpe_ratio, max_drawdown, beta_against, filter_date_range, wealth_series


def _cumulative_realized_eod_series(
    index: pd.DatetimeIndex,
    daily_cumulative_realized: dict[str, float] | None,
) -> pd.Series:
    """Align walk_transactions_avg_cost cumulative realized to each history index (EOD)."""
    if not daily_cumulative_realized:
        return pd.Series(0.0, index=index, dtype=float)
    sorted_days = sorted(daily_cumulative_realized.keys())
    ptr = -1
    last = 0.0
    out: list[float] = []
    for dt in index:
        ds = pd.Timestamp(dt).strftime("%Y-%m-%d")
        while ptr + 1 < len(sorted_days) and sorted_days[ptr + 1] <= ds:
            ptr += 1
            last = daily_cumulative_realized[sorted_days[ptr]]
        out.append(last)
    return pd.Series(out, index=index, dtype=float)


def build_summary(
    shares_held: dict[str, float],
    cost_basis: dict[str, float],
    avg_cost: dict[str, float],
    realized_pnl: float,
    cumulative_invested: float,
    gross_invested: float,
    daily_returns: pd.Series,
    daily_values: pd.DataFrame,
    market: MarketDataService,
    start_date: date,
    end_date: date,
    cash_anchor: dict | None,
    get_cash_timeline: Callable[[], list[dict]],
    option_symbols: set[str] | None = None,
) -> PortfolioSummary:
    """Build the portfolio summary snapshot.

    gross_invested: sum of all BUY transaction amounts ever (denominator for total P&L %).
    today_value / yesterday_value use signed shares so short positions reduce day-change
    when price rises. Day-change denominator includes cash so the percentage reflects
    the full portfolio (equity + cash), matching the attribution endpoint.

    Day-change uses a fresh 7-day price fetch (same window as attribution) so both
    show the same underlying closing prices.
    """
    _option_symbols = option_symbols or set()
    total_value = 0.0
    total_cost = 0.0
    unrealized = 0.0

    for symbol, shares in shares_held.items():
        if shares == 0:
            continue
        if symbol in _option_symbols:
            # Can't fetch live option prices via yfinance (OCC symbols).
            # Treat open options as 0 unrealized P&L, matching build_holdings.
            # Including them with price=0 would subtract their full cost basis
            # from unrealized and understate total P&L.
            continue
        is_short = shares < 0
        price = market.get_current_price(symbol)
        mv = abs(shares) * price
        cb = cost_basis.get(symbol, 0)
        # Short P&L: profit when price falls (sold high, buy back low).
        unrealized += (cb - mv) if is_short else (mv - cb)
        total_value += mv
        total_cost += cb

    total_pnl = unrealized + realized_pnl

    # Total P&L %: denominator is gross capital ever deployed (sum of all BUY amounts).
    # This answers "for every dollar I've committed to the market, what's my return?"
    # The denominator never shrinks when you close positions, so the % stays honest.
    pnl_pct = (total_pnl / gross_invested * 100) if gross_invested > 0 else 0.0

    # Resolve cash balance early — needed for the daily % denominator below.
    cash_balance: float | None = None
    net_account_value: float | None = None
    if cash_anchor:
        timeline = get_cash_timeline()
        if timeline:
            cash_balance = round(timeline[-1]["cash_balance"], 2)
            net_account_value = round(total_value + cash_balance, 2)
    cash_for_daily = float(cash_balance) if cash_balance is not None else 0.0

    # Day change: current price (fast_info, intraday-aware) vs prior session close.
    # This keeps today_change in sync with current_price used for total_value above.
    active_symbols = [s for s, sh in shares_held.items() if sh != 0]
    today = debug_today()
    day_start = today - timedelta(days=7)
    recent_prices = market.get_historical_prices_batch(active_symbols, day_start, today)
    today_ts = pd.Timestamp(today)

    today_value = 0.0
    yesterday_value = 0.0
    for symbol, shares in shares_held.items():
        if shares == 0:
            continue
        if symbol not in recent_prices or recent_prices[symbol].empty:
            continue
        p = recent_prices[symbol][symbol].dropna()
        if p.empty:
            continue

        # Prior close = last OHLCV close strictly before today (handles intraday + weekends).
        prior = p[p.index < today_ts]
        if prior.empty:
            prior = p  # edge case: only have today's OHLCV row
        prev_close = float(prior.iloc[-1])

        # Current price from fast_info — same source used for total_value.
        current = market.get_current_price(symbol)
        if current <= 0:
            current = float(p.iloc[-1])

        # Signed shares: short positions contribute negatively so a
        # price rise correctly reduces portfolio day-change.
        today_value += shares * current
        yesterday_value += shares * prev_close

    today_change = today_value - yesterday_value
    # Denominator = yesterday equity + cash.  Cash earns 0%, so holding cash
    # correctly dilutes the daily return (same logic attribution uses via equity_fraction).
    # Guard: skip if total denominator is non-positive (all-short or no data).
    daily_denominator = yesterday_value + cash_for_daily
    today_pct = (today_change / daily_denominator * 100) if daily_denominator > 0 else 0

    sr = sharpe_ratio(daily_returns) if len(daily_returns) > 10 else 0
    wser = wealth_series(daily_values)
    md, _, _ = max_drawdown(wser) if len(wser) > 2 else (0, None, None)

    spy_data = market.get_benchmark_data("SPY", start_date, end_date)
    b = 0.0
    if not spy_data.empty:
        spy_returns = spy_data["Close"].pct_change().dropna()
        spy_returns.index = pd.to_datetime(spy_returns.index).tz_localize(None)
        b = beta_against(daily_returns, spy_returns)

    price_symbols = sorted(
        s for s, sh in shares_held.items()
        if sh != 0 and s not in _option_symbols
    )
    oldest_ts = market.oldest_current_price_cache_time(price_symbols)
    cached_at_iso: str | None = None
    if oldest_ts is not None:
        cached_at_iso = (
            datetime.fromtimestamp(oldest_ts, tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )

    return PortfolioSummary(
        total_value=round(total_value, 2),
        total_cost_basis=round(total_cost, 2),
        total_pnl_dollars=round(total_pnl, 2),
        total_pnl_percent=round(pnl_pct, 2),
        today_change_dollars=round(today_change, 2),
        today_change_percent=round(today_pct, 2),
        sharpe_ratio=round(sr, 3),
        max_drawdown=round(md * 100, 2),
        beta=round(b, 3),
        holdings_count=sum(1 for s in shares_held.values() if s != 0),
        total_invested=round(cumulative_invested, 2),
        realized_pnl=round(realized_pnl, 2),
        unrealized_pnl=round(unrealized, 2),
        cash_balance=cash_balance,
        net_account_value=net_account_value,
        live_prices_enabled=live_prices_enabled(),
        price_refresh_mode=price_refresh_mode(),
        current_price_ttl_seconds=current_price_ttl_for_request(),
        current_prices_cached_at=cached_at_iso,
    )


def build_history(
    daily_values: pd.DataFrame,
    start: date | None,
    end: date | None,
    daily_cumulative_realized: dict[str, float] | None = None,
) -> PortfolioHistoryResponse:
    """Build daily portfolio value history with per-day and cumulative returns.

    `value` is signed equity MTM; `net_account_value` is set when a cash anchor
    supplies implied cash. Returns compound on wealth (net when present).
    `equity_total_pnl` is unrealized + cumulative realized (trading P&L, no cash flows).
    """
    if daily_values.empty:
        return PortfolioHistoryResponse(history=[])

    total_s = filter_date_range(daily_values["total"], start, end)
    wealth_s = filter_date_range(wealth_series(daily_values), start, end)
    common = total_s.index.intersection(wealth_s.index)
    total_s = total_s.loc[common]
    wealth_s = wealth_s.loc[common]

    if "equity_cost_basis" in daily_values.columns:
        basis_s = filter_date_range(daily_values["equity_cost_basis"], start, end)
        basis_s = basis_s.reindex(common).fillna(0.0)
    else:
        basis_s = pd.Series(0.0, index=common)
    has_cash_col = "cash" in daily_values.columns
    if has_cash_col:
        cash_s = filter_date_range(daily_values["cash"], start, end)
        cash_s = cash_s.reindex(common)
    else:
        cash_s = None

    prev = wealth_s.shift(1)
    returns = wealth_s.pct_change()
    returns = returns.where(prev.abs() >= 1e-6, 0)
    returns = returns.fillna(0).replace([np.inf, -np.inf], 0).clip(-1, 1)
    cum_returns = (1 + returns).cumprod() - 1

    cum_realized_s = _cumulative_realized_eod_series(common, daily_cumulative_realized)

    has_net = "net_account" in daily_values.columns
    points = []
    for i, dt in enumerate(wealth_s.index):
        nav = round(float(daily_values.loc[dt, "net_account"]), 2) if has_net else None
        tv = round(float(total_s.loc[dt]), 2)
        cb = round(float(basis_s.loc[dt]), 2)
        unr = round(tv - cb, 2)
        cum_r = round(float(cum_realized_s.loc[dt]), 2)
        eq_total = round(unr + cum_r, 2)
        cash_bal = None
        if has_cash_col and cash_s is not None and pd.notna(cash_s.loc[dt]):
            cash_bal = round(float(cash_s.loc[dt]), 2)
        points.append(
            PortfolioHistoryPoint(
                date=dt.strftime("%Y-%m-%d"),
                value=tv,
                daily_return=round(float(returns.iloc[i]) * 100, 4),
                cumulative_return=round(float(cum_returns.iloc[i]) * 100, 2),
                net_account_value=nav,
                equity_cost_basis=cb,
                equity_unrealized_pnl=unr,
                cumulative_realized_pnl=cum_r,
                equity_total_pnl=eq_total,
                cash_balance=cash_bal,
            )
        )
    return PortfolioHistoryResponse(history=points)


def build_weights(
    daily_weights: pd.DataFrame,
    symbols: set[str],
    start: date | None,
    end: date | None,
) -> PortfolioWeightsResponse:
    """Build per-symbol daily weight series, downsampled for large date ranges."""
    df = filter_date_range(daily_weights, start, end)

    # Downsample to reduce payload size for long histories
    if len(df) > 365:
        df = df.resample("W-FRI").last().dropna(how="all")
    elif len(df) > 90:
        df = df.resample("3D").last().dropna(how="all")

    sym_list = [c for c in df.columns if c in symbols]
    points = []
    for dt, row in df.iterrows():
        weights = {
            s: round(float(row.get(s, 0)) * 100, 2)
            for s in sym_list
            if abs(float(row.get(s, 0))) > 0.001
        }
        if weights:
            points.append(WeightPoint(date=dt.strftime("%Y-%m-%d"), weights=weights))

    return PortfolioWeightsResponse(weights=points, symbols=sorted(sym_list))


def build_holdings(
    shares_held: dict[str, float],
    avg_cost: dict[str, float],
    cost_basis: dict[str, float],
    last_activity: dict[str, str],
    processed_transactions: list[Transaction],
    prices: dict[str, pd.DataFrame],
    stock_info: dict[str, dict],
    market: MarketDataService,
) -> HoldingsResponse:
    """Build the per-position holdings breakdown.

    P&L for short positions: P&L = cost_basis - market_value (profit when price falls).
    Today change values are negated for shorts so a price rise shows as a loss.

    Prior close for today% uses a fresh 7d OHLC fetch (same window as build_summary),
    not engine snapshot prices — those only refresh on rebuild and go stale overnight.
    """
    # Map each symbol to its instrument type from the processed transaction list
    # (includes synthetic option-expiry closings so expired options are captured).
    symbol_instrument: dict[str, str] = {}
    for t in processed_transactions:
        symbol_instrument[t.symbol] = t.instrument_type

    equity_symbols = [
        s
        for s, sh in shares_held.items()
        if sh != 0 and symbol_instrument.get(s, "stock") != "option"
    ]
    today = debug_today()
    day_start = today - timedelta(days=7)
    recent_ohlc = (
        market.get_historical_prices_batch(equity_symbols, day_start, today)
        if equity_symbols
        else {}
    )

    holdings: list[HoldingDetail] = []
    total_mv = 0.0
    total_pnl = 0.0

    for symbol, shares in shares_held.items():
        if shares == 0:
            continue
        is_short = shares < 0
        is_option = symbol_instrument.get(symbol, "stock") == "option"

        if is_option:
            # Cannot fetch live option prices by OCC symbol via yfinance.
            # Display cost basis as market value; unrealized P&L is 0 until closed.
            price = 0.0
            cb = cost_basis.get(symbol, 0)
            mv = cb
            pnl = 0.0
            pnl_pct = 0.0
            today_dollars = 0.0
            today_pct = 0.0
            info: dict = {}
        else:
            price = market.get_current_price(symbol)
            mv = abs(shares) * price
            cb = cost_basis.get(symbol, 0)
            # Short P&L: profit when price falls (cost_basis > market_value)
            pnl = (cb - mv) if is_short else (mv - cb)
            pnl_pct = (pnl / cb * 100) if cb > 0 else 0
            today_dollars = 0.0
            today_pct = 0.0
            ohlc_df = recent_ohlc.get(symbol)
            if ohlc_df is None or ohlc_df.empty:
                ohlc_df = prices.get(symbol)
            if ohlc_df is not None and not ohlc_df.empty and symbol in ohlc_df.columns:
                p = ohlc_df[symbol].dropna()
                # Prior close = last OHLCV close strictly before today so that
                # today_pct uses the same current price (fast_info) already in `price`.
                today_ts = pd.Timestamp(today)
                prior = p[p.index < today_ts]
                if prior.empty:
                    prior = p  # edge case: only have today's OHLCV row
                if not prior.empty:
                    prev_close = float(prior.iloc[-1])
                    if prev_close > 0:
                        raw_pct = (price / prev_close - 1) * 100
                        raw_dollars = abs(shares) * (price - prev_close)
                        # Invert for shorts: a price rise is a loss for the short holder.
                        today_dollars = -raw_dollars if is_short else raw_dollars
                        today_pct = -raw_pct if is_short else raw_pct
            info = stock_info.get(symbol, {})

        total_mv += mv
        total_pnl += pnl

        holdings.append(HoldingDetail(
            symbol=symbol,
            name=info.get("name", symbol) if not is_option else symbol,
            shares=round(shares, 4),
            avg_cost=round(avg_cost.get(symbol, 0), 2),
            current_price=round(price, 2),
            market_value=round(mv, 2),
            cost_basis=round(cb, 2),
            pnl_dollars=round(pnl, 2),
            pnl_percent=round(pnl_pct, 2),
            weight=0,  # filled in second pass below
            today_change_dollars=round(today_dollars, 2),
            today_change_percent=round(today_pct, 2),
            sector=info.get("sector", "Options") if not is_option else "Options",
            last_activity=last_activity.get(symbol, ""),
            instrument_type=symbol_instrument.get(symbol, "stock"),
        ))

    # Fill weights in a second pass (requires total_mv to be complete)
    for h in holdings:
        h.weight = round(h.market_value / total_mv * 100, 2) if total_mv > 0 else 0

    holdings.sort(key=lambda h: h.market_value, reverse=True)

    # total_pnl_pct denominator is the original cost basis of all holdings
    # (total_mv - total_pnl = market_value - pnl = cost_basis, for a long-only portfolio)
    total_pnl_pct = (
        (total_pnl / (total_mv - total_pnl) * 100)
        if (total_mv - total_pnl) > 0
        else 0
    )

    return HoldingsResponse(
        holdings=holdings,
        total_market_value=round(total_mv, 2),
        total_pnl_dollars=round(total_pnl, 2),
        total_pnl_percent=round(total_pnl_pct, 2),
    )


def build_holdings_as_of(
    shares_held: dict[str, float],
    avg_cost: dict[str, float],
    cost_basis: dict[str, float],
    last_activity: dict[str, str],
    processed_transactions: list[Transaction],
    close_lookup: Callable[[str], tuple[Optional[float], Optional[float]]],
    stock_info: dict[str, dict],
    as_of: date,
) -> HoldingsResponse:
    """Holdings snapshot as of a past date.

    Uses the provided close_lookup (returns (close_at_or_before_as_of, prior_close))
    instead of live prices. today_change_percent becomes the one-day close-to-close
    change ending on as_of (flipped for shorts), so the UI labels it "Day Change"
    when in time-travel mode.

    Options: no historical OCC-symbol prices are available, so price/pnl stay 0
    (matches live-mode behavior for options).
    """
    symbol_instrument: dict[str, str] = {}
    for t in processed_transactions:
        symbol_instrument[t.symbol] = t.instrument_type

    holdings: list[HoldingDetail] = []
    total_mv = 0.0
    total_pnl = 0.0

    for symbol, shares in shares_held.items():
        if shares == 0:
            continue
        is_short = shares < 0
        is_option = symbol_instrument.get(symbol, "stock") == "option"

        if is_option:
            price = 0.0
            cb = cost_basis.get(symbol, 0)
            mv = cb
            pnl = 0.0
            pnl_pct = 0.0
            day_dollars = 0.0
            day_pct = 0.0
            info: dict = {}
        else:
            close, prev = close_lookup(symbol)
            price = float(close) if close is not None else 0.0
            cb = cost_basis.get(symbol, 0)
            mv = abs(shares) * price
            pnl = (cb - mv) if is_short else (mv - cb)
            pnl_pct = (pnl / cb * 100) if cb > 0 else 0
            day_dollars = 0.0
            day_pct = 0.0
            if prev is not None and prev > 0 and price > 0:
                raw_pct = (price / prev - 1) * 100
                raw_dollars = abs(shares) * (price - prev)
                day_dollars = -raw_dollars if is_short else raw_dollars
                day_pct = -raw_pct if is_short else raw_pct
            info = stock_info.get(symbol, {})

        total_mv += mv
        total_pnl += pnl

        holdings.append(HoldingDetail(
            symbol=symbol,
            name=info.get("name", symbol) if not is_option else symbol,
            shares=round(shares, 4),
            avg_cost=round(avg_cost.get(symbol, 0), 2),
            current_price=round(price, 2),
            market_value=round(mv, 2),
            cost_basis=round(cb, 2),
            pnl_dollars=round(pnl, 2),
            pnl_percent=round(pnl_pct, 2),
            weight=0,
            today_change_dollars=round(day_dollars, 2),
            today_change_percent=round(day_pct, 2),
            sector=info.get("sector", "Options") if not is_option else "Options",
            last_activity=last_activity.get(symbol, ""),
            instrument_type=symbol_instrument.get(symbol, "stock"),
        ))

    for h in holdings:
        h.weight = round(h.market_value / total_mv * 100, 2) if total_mv > 0 else 0

    holdings.sort(key=lambda h: h.market_value, reverse=True)

    total_pnl_pct = (
        (total_pnl / (total_mv - total_pnl) * 100)
        if (total_mv - total_pnl) > 0
        else 0
    )

    return HoldingsResponse(
        holdings=holdings,
        total_market_value=round(total_mv, 2),
        total_pnl_dollars=round(total_pnl, 2),
        total_pnl_percent=round(total_pnl_pct, 2),
        as_of=as_of.isoformat(),
    )
