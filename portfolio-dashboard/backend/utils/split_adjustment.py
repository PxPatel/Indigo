"""
Normalize stock transaction quantities to Yahoo Finance split-adjusted share units.

yfinance historical prices use auto_adjust=True (split-adjusted). Broker CSV exports
typically leave past fills in original share units, so average-cost accounting must
express each fill in the same basis as prices.

For each stock transaction, multiply quantity by the cumulative product of split ratios
for every corporate split whose effective calendar date is strictly after the
transaction's calendar date — aligned with TimeSeriesBuilder's pre-change rule
(dates before the split are scaled).

total_amount is never changed (canonical cash flow). Per-share price is derived as
total_amount / quantity after scaling so dollars stay consistent.

Options are not adjusted (different contract mechanics). If a future CSV were already
split-restated by the broker, applying this again would double-adjust — not detected here.

See BACKLOG: stock split handling.
"""

from __future__ import annotations

from datetime import date

import pandas as pd

from models.schemas import Transaction


def _split_calendar_date(split_ts: pd.Timestamp | date) -> date:
    return pd.Timestamp(split_ts).normalize().date()


def cumulative_split_factor_after_transaction(
    txn_date: date,
    splits: pd.Series,
) -> float:
    """Product of yfinance split ratios for all splits strictly after txn_date."""
    if splits is None or splits.empty:
        return 1.0
    factor = 1.0
    for split_ts, ratio in splits.sort_index().items():
        if ratio is None or (isinstance(ratio, float) and ratio == 0.0):
            continue
        r = float(ratio)
        if r <= 0:
            continue
        if _split_calendar_date(split_ts) > txn_date:
            factor *= r
    return factor


def adjust_stock_transactions_for_splits(
    transactions: list[Transaction],
    splits_by_symbol: dict[str, pd.Series],
) -> list[Transaction]:
    """Return a new list: stock rows scaled to split-adjusted units; options unchanged."""
    out: list[Transaction] = []
    for t in transactions:
        if t.instrument_type != "stock":
            out.append(t.model_copy())
            continue
        series = splits_by_symbol.get(t.symbol)
        if series is None:
            series = pd.Series(dtype=float)
        factor = cumulative_split_factor_after_transaction(t.date.date(), series)
        if abs(factor - 1.0) < 1e-15:
            out.append(t.model_copy())
            continue
        new_qty = t.quantity * factor
        if new_qty == 0:
            out.append(t.model_copy())
            continue
        new_price = t.total_amount / new_qty
        out.append(
            t.model_copy(
                update={
                    "quantity": new_qty,
                    "price": new_price,
                }
            )
        )
    return out
