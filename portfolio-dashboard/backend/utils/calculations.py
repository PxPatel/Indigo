from __future__ import annotations

import numpy as np
import pandas as pd
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from models.schemas import Transaction

RISK_FREE_RATE = 0.05
TRADING_DAYS = 252

# Positions below this share count are snapped to zero to avoid floating-point dust.
# Must match across all accounting paths (portfolio_engine, symbol_chart).
MIN_SHARE_THRESHOLD = 0.0001

# Pause between yfinance retry attempts. Named constant so all callers stay in sync.
RETRY_SLEEP_SECONDS = 0.5


@dataclass
class AccountingResult:
    """Complete accounting state produced by walk_transactions_avg_cost."""
    shares_held: dict[str, float]
    avg_cost_per_share: dict[str, float]
    total_cost_basis: dict[str, float]   # avg_cost_per_share * abs(shares) per symbol
    realized_pnl: float
    cumulative_invested: float           # net cash deployed (outlays minus sell proceeds)
    last_activity: dict[str, str]        # symbol → "YYYY-MM-DD" of most recent transaction
    daily_cumulative_realized: dict[str, float]  # "YYYY-MM-DD" → cumulative realized P&L after all txns that date


def apply_avg_cost_transaction_step(
    shares: dict[str, float],
    avg_cost: dict[str, float],
    t: Transaction,
) -> None:
    """Apply one transaction to average-cost state (mutates shares, avg_cost).

    Must stay in lockstep with the share/avg_cost branches in walk_transactions_avg_cost.
    """
    current = shares[t.symbol]

    if t.side == "BUY":
        if current < 0:
            cover_qty = min(t.quantity, abs(current))
            shares[t.symbol] += cover_qty
            remaining_buy = t.quantity - cover_qty

            if remaining_buy > 0:
                avg_cost[t.symbol] = t.price
                shares[t.symbol] += remaining_buy
            elif abs(shares[t.symbol]) < MIN_SHARE_THRESHOLD:
                avg_cost[t.symbol] = 0.0
        else:
            old_total_cost = avg_cost[t.symbol] * current
            new_total_cost = old_total_cost + t.total_amount
            shares[t.symbol] += t.quantity
            if shares[t.symbol] > 0:
                avg_cost[t.symbol] = new_total_cost / shares[t.symbol]

    elif t.side == "SELL":
        if current > 0:
            sell_qty = min(t.quantity, current)
            shares[t.symbol] -= sell_qty
            remaining_sell = t.quantity - sell_qty

            if remaining_sell > 0:
                avg_cost[t.symbol] = t.price
                shares[t.symbol] -= remaining_sell
            elif abs(shares[t.symbol]) < MIN_SHARE_THRESHOLD:
                avg_cost[t.symbol] = 0.0
        else:
            old_total_cost = avg_cost[t.symbol] * abs(current)
            new_total_cost = old_total_cost + t.total_amount
            shares[t.symbol] -= t.quantity
            if shares[t.symbol] < 0:
                avg_cost[t.symbol] = new_total_cost / abs(shares[t.symbol])

    shares[t.symbol] = round(shares[t.symbol], 6)
    if abs(shares[t.symbol]) < MIN_SHARE_THRESHOLD:
        shares[t.symbol] = 0.0
        avg_cost[t.symbol] = 0.0


def daily_equity_cost_basis_eod_series(
    transactions: list[Transaction],
    equity_symbols: set[str],
    date_range: pd.DatetimeIndex,
) -> pd.Series:
    """End-of-day aggregate equity cost basis (avg_cost × abs(shares)) per business day.

    Applies the same average-cost rules as walk_transactions_avg_cost, advancing through
    calendar time so EOD on day D includes all transactions with date ≤ D (calendar).
    Only symbols in ``equity_symbols`` contribute to the sum (matches equity MTM scope).
    """
    # Same chronological ordering as walk_transactions_avg_cost / engine (stable on equal timestamps).
    sorted_txns = sorted(transactions, key=lambda t: t.date)
    shares: dict[str, float] = defaultdict(float)
    avg_cost: dict[str, float] = defaultdict(float)
    idx = 0
    n = len(sorted_txns)
    values: list[float] = []

    for D in date_range:
        d_py = pd.Timestamp(D).date()
        while idx < n and sorted_txns[idx].date.date() <= d_py:
            apply_avg_cost_transaction_step(shares, avg_cost, sorted_txns[idx])
            idx += 1
        total_cb = 0.0
        for sym in equity_symbols:
            if sym in shares and abs(shares[sym]) >= MIN_SHARE_THRESHOLD:
                total_cb += avg_cost[sym] * abs(shares[sym])
        values.append(total_cb)

    return pd.Series(values, index=date_range, dtype=float)


def walk_transactions_avg_cost(transactions: list[Transaction]) -> AccountingResult:
    """Single canonical implementation of average-cost accounting.

    Walks a chronologically-sorted transaction list and produces complete accounting
    state. All callers that need realized P&L, shares held, cost basis, or cumulative
    invested must use this function so the numbers stay consistent across views.

    Handles:
    - Long positions: BUY opens/adds, SELL closes/reduces, P&L realized on sell
    - Short positions: SELL opens/adds (negative shares), BUY covers, P&L on cover
    - Long→short flip within a single SELL transaction (and vice versa for BUY)
    - Options expiring worthless: price=0, total_amount=0 → full cost basis is realized loss

    daily_cumulative_realized keys are "YYYY-MM-DD" strings. If multiple transactions
    fall on the same date, the last one's running total is recorded (end-of-day value).

    Precondition: transactions must be sorted chronologically. Callers are responsible
    for sorting before calling this function.
    """
    shares: dict[str, float] = defaultdict(float)
    avg_cost: dict[str, float] = defaultdict(float)  # per-share, always positive
    last_activity: dict[str, str] = {}
    realized = 0.0
    total_invested = 0.0
    daily_cumulative_realized: dict[str, float] = {}

    for t in transactions:
        last_activity[t.symbol] = t.date.strftime("%Y-%m-%d")
        current = shares[t.symbol]

        if t.side == "BUY":
            if current < 0:
                # Covering a short position — realize P&L on the covered portion.
                # Short P&L: opened at avg_cost (received that price), now buying back at t.price.
                cover_qty = min(t.quantity, abs(current))
                realized += cover_qty * (avg_cost[t.symbol] - t.price)
                shares[t.symbol] += cover_qty
                remaining_buy = t.quantity - cover_qty

                if remaining_buy > 0:
                    # Flip: short → long. New long's cost basis is the BUY price.
                    avg_cost[t.symbol] = t.price
                    shares[t.symbol] += remaining_buy
                    total_invested += remaining_buy * t.price
                elif abs(shares[t.symbol]) < MIN_SHARE_THRESHOLD:
                    avg_cost[t.symbol] = 0.0
            else:
                # Opening or adding to a long position.
                # Avg-cost = (existing_cost + new_cost) / new_total_shares.
                old_total_cost = avg_cost[t.symbol] * current
                new_total_cost = old_total_cost + t.total_amount
                shares[t.symbol] += t.quantity
                if shares[t.symbol] > 0:
                    avg_cost[t.symbol] = new_total_cost / shares[t.symbol]
                total_invested += t.total_amount

        elif t.side == "SELL":
            if current > 0:
                # Selling from a long position.
                sell_qty = min(t.quantity, current)
                # long_proportion: fraction of this sell that closes existing long shares.
                # When sell_qty == t.quantity there is no flip; the fraction is 1.0.
                long_proportion = sell_qty / t.quantity if t.quantity > 0 else 1.0
                sell_proceeds = t.total_amount * long_proportion
                sell_cost_basis = avg_cost[t.symbol] * sell_qty
                realized += sell_proceeds - sell_cost_basis
                shares[t.symbol] -= sell_qty
                remaining_sell = t.quantity - sell_qty

                if remaining_sell > 0:
                    # Flip: long → short. New short's avg_cost is this SELL's price.
                    avg_cost[t.symbol] = t.price
                    shares[t.symbol] -= remaining_sell
                    # Proceeds for the short-opening portion also reduce net invested.
                    total_invested -= t.total_amount * (remaining_sell / t.quantity)
                elif abs(shares[t.symbol]) < MIN_SHARE_THRESHOLD:
                    avg_cost[t.symbol] = 0.0
                # Cash received from closing the long portion reduces net invested.
                total_invested -= sell_proceeds
            else:
                # Opening or adding to a short position.
                # avg_cost tracks the average price at which the short was opened.
                old_total_cost = avg_cost[t.symbol] * abs(current)
                new_total_cost = old_total_cost + t.total_amount
                shares[t.symbol] -= t.quantity
                if shares[t.symbol] < 0:
                    avg_cost[t.symbol] = new_total_cost / abs(shares[t.symbol])

        # Snap floating-point dust to zero so downstream comparisons are clean.
        shares[t.symbol] = round(shares[t.symbol], 6)
        if abs(shares[t.symbol]) < MIN_SHARE_THRESHOLD:
            shares[t.symbol] = 0.0
            avg_cost[t.symbol] = 0.0

        # Record end-of-transaction cumulative realized P&L.
        # If multiple transactions fall on the same date the last one wins,
        # giving the correct end-of-day cumulative for that date.
        daily_cumulative_realized[t.date.strftime("%Y-%m-%d")] = realized

    cost_basis = {s: avg_cost[s] * abs(shares[s]) for s in shares}

    return AccountingResult(
        shares_held=dict(shares),
        avg_cost_per_share=dict(avg_cost),
        total_cost_basis=cost_basis,
        realized_pnl=realized,
        cumulative_invested=total_invested,
        last_activity=last_activity,
        daily_cumulative_realized=daily_cumulative_realized,
    )


def annualized_return(cumulative_return: float, days: int) -> float:
    if days <= 0 or cumulative_return <= -1:
        return 0.0
    return (1 + cumulative_return) ** (TRADING_DAYS / days) - 1


def annualized_volatility(daily_returns: pd.Series) -> float:
    if len(daily_returns) < 2:
        return 0.0
    return float(daily_returns.std() * np.sqrt(TRADING_DAYS))


def sharpe_ratio(daily_returns: pd.Series) -> float:
    vol = annualized_volatility(daily_returns)
    if vol < 1e-10:
        return 0.0
    ann_ret = annualized_return(
        float((1 + daily_returns).prod() - 1), len(daily_returns)
    )
    return (ann_ret - RISK_FREE_RATE) / vol


def sortino_ratio(daily_returns: pd.Series) -> float:
    """Sortino ratio using the standard downside deviation formula.

    Downside deviation = sqrt(mean(min(r, 0)^2) * 252) where the mean is taken
    over ALL periods (not just negative ones). Using only negative periods inflates
    the denominator and is non-standard.
    """
    if len(daily_returns) < 2:
        return 0.0
    # Clip positives to 0 so only drawdown days contribute, divide by total N
    downside_dev = float(np.sqrt((daily_returns.clip(upper=0) ** 2).mean() * TRADING_DAYS))
    if downside_dev < 1e-10:
        return 0.0
    ann_ret = annualized_return(
        float((1 + daily_returns).prod() - 1), len(daily_returns)
    )
    return (ann_ret - RISK_FREE_RATE) / downside_dev


def wealth_series(daily_values: pd.DataFrame) -> pd.Series:
    """Equity MTM + implied cash when present; else signed equity MTM only."""
    if daily_values.empty:
        return pd.Series(dtype=float)
    if "net_account" in daily_values.columns:
        return daily_values["net_account"]
    return daily_values["total"]


def max_drawdown(cumulative_values: pd.Series):
    """Returns (max_dd_fraction, peak_date, trough_date).

    Underwater % is (W - running_max) / running_max only where running_max is
    strictly positive, so short-book paths without a positive peak do not produce
    undefined ratios.
    """
    if len(cumulative_values) < 2:
        return 0.0, None, None
    running_max = cumulative_values.cummax()
    eps = 1e-9
    safe = running_max > eps
    if not safe.any():
        return 0.0, None, None
    dd = pd.Series(0.0, index=cumulative_values.index)
    dd.loc[safe] = ((cumulative_values - running_max) / running_max).loc[safe]
    dd = dd.replace([np.inf, -np.inf], np.nan).fillna(0).clip(-1.0, 0.0)
    trough_idx = dd.idxmin()
    peak_idx = cumulative_values.loc[:trough_idx].idxmax()
    return float(dd.min()), peak_idx, trough_idx


def beta_against(portfolio_returns: pd.Series, benchmark_returns: pd.Series) -> float:
    aligned = pd.DataFrame({"p": portfolio_returns, "b": benchmark_returns}).dropna()
    if len(aligned) < 10:
        return 0.0
    cov = aligned["p"].cov(aligned["b"])
    var = aligned["b"].var()
    if var == 0:
        return 0.0
    return float(cov / var)


def alpha_jensen(
    portfolio_return: float, benchmark_return: float, beta: float
) -> float:
    return portfolio_return - (RISK_FREE_RATE + beta * (benchmark_return - RISK_FREE_RATE))


def value_at_risk_historical(daily_returns: pd.Series, confidence: float = 0.95) -> float:
    if len(daily_returns) < 10:
        return 0.0
    return float(daily_returns.quantile(1 - confidence))


def herfindahl_index(weights: list[float]) -> float:
    return float(sum(w ** 2 for w in weights))


def rolling_metric(series: pd.Series, window: int, func) -> pd.Series:
    return series.rolling(window, min_periods=max(10, window // 2)).apply(func, raw=False)


def filter_date_range(
    obj: pd.Series | pd.DataFrame,
    start: date | None,
    end: date | None,
) -> pd.Series | pd.DataFrame:
    """Slice a DatetimeIndex-indexed Series or DataFrame to an optional date range.

    Both bounds are inclusive. Converts date → pd.Timestamp so callers don't need
    to think about the conversion. Passing None for either bound is a no-op for
    that side.
    """
    if start is not None:
        obj = obj[obj.index >= pd.Timestamp(start)]
    if end is not None:
        obj = obj[obj.index <= pd.Timestamp(end)]
    return obj
