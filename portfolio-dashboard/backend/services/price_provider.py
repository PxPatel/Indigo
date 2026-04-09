"""
Pluggable price provider for daily return fetching.

To swap in a different data source (e.g., Alpaca, Polygon, Twelve Data):
  1. Implement a class that matches the PriceProvider Protocol below.
  2. Update get_price_provider() to return your implementation.
  No other file needs to change.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Protocol, runtime_checkable

import pandas as pd

logger = logging.getLogger(__name__)


@runtime_checkable
class PriceProvider(Protocol):
    """Interface for fetching single-day close-to-close returns.

    Returns (actual_date, {symbol: pct_return}) where pct_return is the
    percentage change for that day (e.g. +1.5 means +1.5%).
    actual_date may differ from target_date when the market was closed.
    """

    def get_daily_returns(
        self,
        symbols: list[str],
        target_date: date,
    ) -> tuple[date, dict[str, float]]:
        ...


class YFinancePriceProvider:
    """Fetches daily returns using fast_info current price vs prior session close.

    Current price comes from fast_info (intraday-aware), so the return reflects
    the actual move from the prior close to right now — not just closed sessions.
    Prior close = last OHLCV close strictly before target_date, so weekends and
    holidays automatically fall back to the most recent completed session.
    """

    def __init__(self, market_data_service) -> None:
        self._market = market_data_service

    def get_daily_returns(
        self,
        symbols: list[str],
        target_date: date,
    ) -> tuple[date, dict[str, float]]:
        if not symbols:
            return target_date, {}

        window_start = target_date - timedelta(days=7)
        prices = self._market.get_historical_prices_batch(
            symbols, window_start, target_date
        )

        returns: dict[str, float] = {}
        today_ts = pd.Timestamp(target_date)

        for symbol in symbols:
            df = prices.get(symbol)
            if df is None or df.empty:
                continue
            col = df.columns[0]
            closes = df[col].dropna()
            if closes.empty:
                continue

            # Prior close = last OHLCV close strictly before target_date.
            # This correctly handles weekends (uses Friday) and intraday (uses yesterday).
            prior = closes[closes.index < today_ts]
            if prior.empty:
                prior = closes  # edge case: only have today's OHLCV row

            prev_close = float(prior.iloc[-1])
            if prev_close <= 0:
                continue

            # Current price from fast_info — reflects intraday moves, not just closed sessions.
            # Falls back to latest available OHLCV close if fast_info returns 0.
            current_price = self._market.get_current_price(symbol)
            if current_price <= 0:
                current_price = float(closes.iloc[-1])

            returns[symbol] = (current_price / prev_close - 1) * 100

        # actual_date = target_date: we always use current price as of now.
        return target_date, returns


def get_price_provider(market_data_service) -> YFinancePriceProvider:
    """Factory — swap the return value here to plug in a different data source."""
    return YFinancePriceProvider(market_data_service)