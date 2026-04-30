"""Historical close-price lookups for time-travel queries.

Reads from the engine's cached `_prices` DataFrame (fetched once during build()).
No yfinance calls — all data is in-memory.

`prices` has shape `{symbol: DataFrame}` where each DataFrame is a single-column
OHLC close series indexed by trading-day timestamps (column name == symbol).
"""

from __future__ import annotations

from datetime import date

import pandas as pd


def _series_for_symbol(df: pd.DataFrame, symbol: str) -> pd.Series:
    """Return a single close series even when pandas/yfinance leaves tuple columns."""
    if isinstance(df.columns, pd.MultiIndex):
        candidates = [
            col for col in df.columns
            if symbol in {str(part) for part in col}
        ]
        if not candidates:
            return pd.Series(dtype=float)
        col = df.loc[:, candidates[0]]
    else:
        if symbol not in df.columns:
            return pd.Series(dtype=float)
        col = df.loc[:, symbol]

    if isinstance(col, pd.DataFrame):
        col = col.iloc[:, 0]
    return pd.to_numeric(col, errors="coerce").dropna()


def close_at_or_before(
    prices: dict[str, pd.DataFrame],
    symbol: str,
    as_of: date,
) -> tuple[float | None, date | None]:
    """Return (close, trading_date) at or before `as_of`, or (None, None) if unavailable.

    Handles weekends/holidays by walking back to the most recent trading day
    with OHLC data. If the symbol is missing or has no data at/before as_of,
    returns (None, None).
    """
    df = prices.get(symbol)
    if df is None or df.empty:
        return None, None
    series = _series_for_symbol(df, symbol)
    if series.empty:
        return None, None
    cutoff = pd.Timestamp(as_of)
    available = series[series.index <= cutoff]
    if available.empty:
        return None, None
    selected = available.iloc[-1]
    val = float(selected)
    dt = available.index[-1].date()
    return val, dt


def prior_close(
    prices: dict[str, pd.DataFrame],
    symbol: str,
    as_of: date,
) -> float | None:
    """Return the close strictly before the as-of trading day.

    Used for the Day Change column: we want the bar whose close is the
    most-recent-at-or-before as_of (call it D0) and the close before D0.
    Returns None if there is no prior trading day in the window.
    """
    df = prices.get(symbol)
    if df is None or df.empty:
        return None
    series = _series_for_symbol(df, symbol)
    if series.empty:
        return None
    cutoff = pd.Timestamp(as_of)
    available = series[series.index <= cutoff]
    if len(available) < 2:
        return None
    return float(available.iloc[-2])
