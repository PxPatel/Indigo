"""FIFO lot reconstruction for cost-basis ladder (long book). Uses split-adjusted transactions."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime

from models.schemas import Transaction
from utils.calculations import MIN_SHARE_THRESHOLD


@dataclass
class FifoLotInternal:
    price: float
    quantity: float
    acquisition_date: datetime


def _snap_shares(q: float) -> float:
    q = round(q, 6)
    return 0.0 if abs(q) < MIN_SHARE_THRESHOLD else q


def compute_fifo_open_lots(transactions: list[Transaction], symbol: str) -> list[FifoLotInternal]:
    """Walk BUY/SELL for one symbol (stock only) in chronological order; return remaining long lots.

    Mirrors long/short transition semantics used in walk_transactions_avg_cost so ending
    share counts align with the engine. Open lots exist only when net position is long.
    """
    sym = symbol.upper()
    rows = sorted(
        (t for t in transactions if t.symbol == sym and t.instrument_type == "stock"),
        key=lambda t: t.date,
    )
    if not rows:
        return []

    shares = 0.0
    lots: deque[FifoLotInternal] = deque()

    for t in rows:
        if t.side == "BUY":
            if shares < 0:
                short_abs = abs(shares)
                cover_qty = min(t.quantity, short_abs)
                shares += cover_qty
                remaining_buy = t.quantity - cover_qty
                if remaining_buy > 0:
                    shares = _snap_shares(shares + remaining_buy)
                    lots.append(
                        FifoLotInternal(
                            price=t.price,
                            quantity=remaining_buy,
                            acquisition_date=t.date,
                        )
                    )
                else:
                    shares = _snap_shares(shares)
            else:
                shares = _snap_shares(shares + t.quantity)
                lots.append(
                    FifoLotInternal(
                        price=t.price,
                        quantity=t.quantity,
                        acquisition_date=t.date,
                    )
                )

        elif t.side == "SELL":
            if shares > 0:
                sell_qty = min(t.quantity, shares)
                remaining_sell = sell_qty
                while remaining_sell > MIN_SHARE_THRESHOLD and lots:
                    front = lots[0]
                    take = min(front.quantity, remaining_sell)
                    front.quantity -= take
                    remaining_sell -= take
                    if front.quantity < MIN_SHARE_THRESHOLD:
                        lots.popleft()
                shares -= sell_qty
                shares = _snap_shares(shares)

                flip_qty = t.quantity - sell_qty
                if flip_qty > MIN_SHARE_THRESHOLD:
                    shares = _snap_shares(shares - flip_qty)
                    lots.clear()
            else:
                shares = _snap_shares(shares - t.quantity)

    if shares <= MIN_SHARE_THRESHOLD:
        return []

    total_lot_shares = sum(l.quantity for l in lots)
    if abs(total_lot_shares - shares) > 0.01:
        # Should not happen if logic matches engine; return empty to avoid lying.
        return []

    return list(lots)


def collect_buy_dates_for_symbol(transactions: list[Transaction], symbol: str) -> list[datetime]:
    """Chronological BUY dates for stock rows (used for avg days between buys)."""
    sym = symbol.upper()
    return sorted(
        t.date
        for t in transactions
        if t.symbol == sym and t.instrument_type == "stock" and t.side == "BUY"
    )


def avg_calendar_days_between_buys(buy_dates: list[datetime]) -> float | None:
    if len(buy_dates) < 2:
        return None
    gaps: list[int] = []
    for i in range(1, len(buy_dates)):
        d0 = buy_dates[i - 1].date()
        d1 = buy_dates[i].date()
        gaps.append((d1 - d0).days)
    return sum(gaps) / len(gaps) if gaps else None


def merge_lots_by_price(lots: list[FifoLotInternal]) -> list[dict]:
    """Merge open lots at the same price (2dp) for chart bars: shares, date range."""
    buckets: dict[float, dict] = {}
    for lot in lots:
        key = round(lot.price, 2)
        if key not in buckets:
            buckets[key] = {
                "price": key,
                "shares": 0.0,
                "date_min": lot.acquisition_date,
                "date_max": lot.acquisition_date,
            }
        b = buckets[key]
        b["shares"] += lot.quantity
        if lot.acquisition_date < b["date_min"]:
            b["date_min"] = lot.acquisition_date
        if lot.acquisition_date > b["date_max"]:
            b["date_max"] = lot.acquisition_date
    merged = list(buckets.values())
    merged.sort(key=lambda x: x["price"])
    return merged
