"""Unit tests for split-adjusted transaction normalization."""

from datetime import date, datetime

import pandas as pd
import pytest

from models.schemas import Transaction
from utils.calculations import walk_transactions_avg_cost
from utils.split_adjustment import (
    adjust_stock_transactions_for_splits,
    cumulative_split_factor_after_transaction,
)


def _dt(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time())


def _stock(
    d: date,
    symbol: str,
    side: str,
    qty: float,
    price: float,
    *,
    total: float | None = None,
) -> Transaction:
    amt = total if total is not None else round(qty * price, 2)
    return Transaction(
        date=_dt(d),
        symbol=symbol,
        side=side,
        quantity=qty,
        price=price,
        total_amount=amt,
        instrument_type="stock",
    )


def _option(d: date, symbol: str, side: str, qty: float, price: float) -> Transaction:
    return Transaction(
        date=_dt(d),
        symbol=symbol,
        side=side,
        quantity=qty,
        price=price,
        total_amount=qty * price * 100,
        instrument_type="option",
    )


class TestCumulativeFactor:
    def test_empty_splits(self):
        assert cumulative_split_factor_after_transaction(date(2020, 1, 1), pd.Series(dtype=float)) == 1.0

    def test_forward_split_after_trade(self):
        splits = pd.Series([2.0], index=[pd.Timestamp("2021-06-01")])
        assert cumulative_split_factor_after_transaction(date(2020, 1, 1), splits) == 2.0

    def test_split_same_day_excluded(self):
        splits = pd.Series([2.0], index=[pd.Timestamp("2020-01-15")])
        assert cumulative_split_factor_after_transaction(date(2020, 1, 15), splits) == 1.0

    def test_multiple_splits(self):
        splits = pd.Series(
            [2.0, 2.0],
            index=[pd.Timestamp("2021-01-01"), pd.Timestamp("2022-01-01")],
        )
        assert cumulative_split_factor_after_transaction(date(2020, 1, 1), splits) == 4.0
        assert cumulative_split_factor_after_transaction(date(2021, 6, 1), splits) == 2.0
        assert cumulative_split_factor_after_transaction(date(2023, 1, 1), splits) == 1.0


class TestAdjustStockTransactions:
    def test_forward_split_scales_qty_and_preserves_dollars(self):
        t = [_stock(date(2020, 1, 1), "AAA", "BUY", 100.0, 10.0, total=1000.0)]
        splits = {"AAA": pd.Series([2.0], index=[pd.Timestamp("2021-01-01")])}
        adj = adjust_stock_transactions_for_splits(t, splits)
        assert len(adj) == 1
        assert adj[0].quantity == pytest.approx(200.0)
        assert adj[0].total_amount == pytest.approx(1000.0)
        assert adj[0].price == pytest.approx(5.0)

    def test_reverse_split(self):
        t = [_stock(date(2020, 1, 1), "REV", "BUY", 100.0, 1.0, total=100.0)]
        splits = {"REV": pd.Series([0.1], index=[pd.Timestamp("2021-01-01")])}
        adj = adjust_stock_transactions_for_splits(t, splits)
        assert adj[0].quantity == pytest.approx(10.0)
        assert adj[0].total_amount == pytest.approx(100.0)
        assert adj[0].price == pytest.approx(10.0)

    def test_option_unchanged(self):
        t = [_option(date(2020, 1, 1), "QQQ240119C00400000", "BUY", 1.0, 2.5)]
        splits = {"QQQ240119C00400000": pd.Series([2.0], index=[pd.Timestamp("2021-01-01")])}
        adj = adjust_stock_transactions_for_splits(t, splits)
        assert adj[0].quantity == t[0].quantity
        assert adj[0].price == t[0].price

    def test_walk_terminal_matches_split_adjusted_basis(self):
        """Single BUY before 2:1 split → walk yields 2x shares, half avg vs nominal."""
        t = [_stock(date(2020, 1, 1), "ZZZ", "BUY", 100.0, 50.0, total=5000.0)]
        splits = {"ZZZ": pd.Series([2.0], index=[pd.Timestamp("2022-01-01")])}
        adj = adjust_stock_transactions_for_splits(t, splits)
        r = walk_transactions_avg_cost(adj)
        assert r.shares_held["ZZZ"] == pytest.approx(200.0)
        assert r.avg_cost_per_share["ZZZ"] == pytest.approx(25.0)
        assert r.total_cost_basis["ZZZ"] == pytest.approx(5000.0)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
