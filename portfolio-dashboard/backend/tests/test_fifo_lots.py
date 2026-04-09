"""Tests for FIFO lot reconstruction."""

from datetime import datetime

from models.schemas import Transaction
from utils.calculations import walk_transactions_avg_cost
from utils.fifo_lots import (
    compute_fifo_open_lots,
    collect_buy_dates_for_symbol,
    avg_calendar_days_between_buys,
    merge_lots_by_price,
)


def _tx(**kwargs):
    base = dict(
        symbol="AAPL",
        instrument_type="stock",
        total_amount=kwargs["quantity"] * kwargs["price"],
    )
    base.update(kwargs)
    return Transaction(**base)


def test_fifo_partial_sell_consumes_oldest_first():
    txns = [
        _tx(date=datetime(2024, 1, 1), side="BUY", quantity=10, price=5.0),
        _tx(date=datetime(2024, 1, 2), side="BUY", quantity=10, price=6.0),
        _tx(date=datetime(2024, 1, 3), side="SELL", quantity=12, price=7.0),
    ]
    lots = compute_fifo_open_lots(txns, "AAPL")
    assert len(lots) == 1
    assert lots[0].price == 6.0
    assert abs(lots[0].quantity - 8.0) < 1e-6
    acct = walk_transactions_avg_cost(txns)
    assert abs(acct.shares_held["AAPL"] - 8.0) < 1e-6


def test_long_to_short_clears_lots():
    txns = [
        _tx(date=datetime(2024, 1, 1), side="BUY", quantity=10, price=5.0),
        _tx(date=datetime(2024, 1, 2), side="SELL", quantity=15, price=6.0),
    ]
    assert compute_fifo_open_lots(txns, "AAPL") == []
    acct = walk_transactions_avg_cost(txns)
    assert acct.shares_held["AAPL"] < 0


def test_option_rows_ignored():
    txns = [
        _tx(
            date=datetime(2024, 1, 1),
            symbol="AAPL",
            side="BUY",
            quantity=10,
            price=5.0,
            instrument_type="stock",
        ),
        Transaction(
            date=datetime(2024, 1, 2),
            symbol="AAPL240119C00150000",
            side="BUY",
            quantity=1,
            price=2.0,
            total_amount=200.0,
            instrument_type="option",
        ),
    ]
    lots = compute_fifo_open_lots(txns, "AAPL")
    assert len(lots) == 1 and lots[0].quantity == 10


def test_merge_lots_by_price():
    from utils.fifo_lots import FifoLotInternal

    lots = [
        FifoLotInternal(10.0, 5.0, datetime(2024, 1, 1)),
        FifoLotInternal(10.0, 3.0, datetime(2024, 2, 1)),
        FifoLotInternal(12.0, 2.0, datetime(2024, 3, 1)),
    ]
    m = merge_lots_by_price(lots)
    assert len(m) == 2
    ten = next(x for x in m if x["price"] == 10.0)
    assert abs(ten["shares"] - 8.0) < 1e-6
    assert ten["date_min"].strftime("%Y-%m-%d") == "2024-01-01"
    assert ten["date_max"].strftime("%Y-%m-%d") == "2024-02-01"


def test_avg_days_between_buys():
    d = collect_buy_dates_for_symbol(
        [
            _tx(date=datetime(2024, 1, 1), side="BUY", quantity=1, price=1.0),
            _tx(date=datetime(2024, 1, 5), side="BUY", quantity=1, price=1.0),
        ],
        "AAPL",
    )
    assert avg_calendar_days_between_buys(d) == 4.0
