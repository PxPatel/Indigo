"""
QueryService — read-only queries over the transaction log and weight history.

Extracted from PortfolioEngine.get_transactions(), get_snapshot_weights(),
and get_holding_sectors(). All logic is preserved exactly.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

import pandas as pd

from models.schemas import (
    Transaction,
    TransactionsResponse,
    TransactionRecord,
    TransactionStats,
)


class QueryService:
    """Provides filtered queries over user-facing transaction data and weight history."""

    def __init__(
        self,
        original_transactions: list[Transaction],
        daily_weights: pd.DataFrame,
        stock_info: dict[str, dict],
    ) -> None:
        # original_transactions: user-visible trades only (no synthetic option-expiry closings)
        self._transactions = original_transactions
        self._daily_weights = daily_weights
        self._stock_info = stock_info

    def get_transactions(
        self,
        symbol: str | None = None,
        side: str | None = None,
        start: date | None = None,
        end: date | None = None,
    ) -> TransactionsResponse:
        """Return filtered transaction log with cumulative-invested running total."""
        filtered = self._transactions
        if symbol:
            filtered = [t for t in filtered if t.symbol == symbol.upper()]
        if side:
            filtered = [t for t in filtered if t.side == side.upper()]
        if start:
            filtered = [t for t in filtered if t.date.date() >= start]
        if end:
            filtered = [t for t in filtered if t.date.date() <= end]

        # Compute cumulative invested from ALL transactions (not just the filtered set)
        # so that each displayed row shows its position in the overall cash-flow history.
        all_sorted = sorted(self._transactions, key=lambda t: t.date)
        cum_map: dict[int, float] = {}
        c = 0.0
        for t in all_sorted:
            if t.side == "BUY":
                c += t.total_amount
            else:
                c -= t.total_amount
            cum_map[id(t)] = c

        records = [
            TransactionRecord(
                date=t.date.strftime("%Y-%m-%d"),
                symbol=t.symbol,
                side=t.side,
                type="Market",
                quantity=round(t.quantity, 4),
                price=round(t.price, 2),
                total=round(t.total_amount, 2),
                cumulative_invested=round(cum_map.get(id(t), 0), 2),
                instrument_type=t.instrument_type,
            )
            for t in filtered
        ]

        buys = [t for t in self._transactions if t.side == "BUY"]
        sells = [t for t in self._transactions if t.side == "SELL"]

        sym_counts: dict[str, int] = defaultdict(int)
        for t in self._transactions:
            sym_counts[t.symbol] += 1
        most_traded = max(sym_counts, key=sym_counts.get) if sym_counts else ""

        stats = TransactionStats(
            total_count=len(self._transactions),
            buy_count=len(buys),
            sell_count=len(sells),
            avg_buy_size=round(sum(t.total_amount for t in buys) / len(buys), 2) if buys else 0,
            avg_sell_size=round(sum(t.total_amount for t in sells) / len(sells), 2) if sells else 0,
            most_traded_symbol=most_traded,
        )

        return TransactionsResponse(transactions=records, stats=stats)

    def get_snapshot_weights(self, target_date: date) -> tuple[str, dict[str, float]]:
        """Return portfolio weights (fractions 0–1) for the most recent trading day at or before target_date.

        Used by AttributionService to get start-of-day weights for return attribution.
        """
        df = self._daily_weights
        if df.empty:
            return target_date.isoformat(), {}

        cutoff = pd.Timestamp(target_date)
        available = df[df.index <= cutoff]
        if available.empty:
            available = df   # fall back to earliest available if target is before portfolio start

        row = available.iloc[-1]
        snap_date = row.name.date()
        weights = {
            col: float(row[col])
            for col in df.columns
            if abs(float(row.get(col, 0))) > 0.001
        }
        return snap_date.isoformat(), weights

    def get_holding_sectors(self) -> dict[str, str]:
        """Return {symbol: sector} for all equity holdings. Used by AttributionService."""
        return {
            symbol: info.get("sector", "Unknown")
            for symbol, info in self._stock_info.items()
        }
