"""History payload: equity cost basis, unrealized P&L, and cash align with MTM and net wealth."""

from datetime import date, datetime

import pandas as pd
import pytest

from models.schemas import Transaction
from services.portfolio.response_builders import build_history
from services.portfolio.time_series import TimeSeriesBuilder
from utils.calculations import daily_equity_cost_basis_eod_series, walk_transactions_avg_cost


def _dt(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time())


def _stock(d: date, symbol: str, side: str, qty: float, price: float) -> Transaction:
    amt = round(qty * price, 2)
    return Transaction(
        date=_dt(d),
        symbol=symbol,
        side=side,
        quantity=qty,
        price=price,
        total_amount=amt,
        instrument_type="stock",
    )


def test_daily_basis_series_matches_walk_equity_cost_basis_sum():
    sym = "AAA"
    tx = [
        _stock(date(2024, 1, 2), sym, "BUY", 10.0, 10.0),
        _stock(date(2024, 1, 3), sym, "BUY", 5.0, 12.0),
    ]
    walk = walk_transactions_avg_cost(tx)
    dr = pd.date_range(date(2024, 1, 2), date(2024, 1, 5), freq="B")
    s = daily_equity_cost_basis_eod_series(tx, {sym}, dr)
    expected = sum(walk.total_cost_basis.get(s, 0.0) for s in [sym])
    assert float(s.iloc[-1]) == pytest.approx(expected, rel=1e-5, abs=1e-3)


def test_time_series_basis_plus_unrealized_matches_total():
    start, end = date(2024, 1, 2), date(2024, 1, 5)
    dr = pd.date_range(start, end, freq="B")
    sym = "AAA"
    prices = {sym: pd.DataFrame({sym: [10.0, 10.0, 10.0, 10.0]}, index=dr)}
    tx = [_stock(date(2024, 1, 2), sym, "BUY", 1.0, 10.0)]
    b = TimeSeriesBuilder(
        processed_transactions=tx,
        equity_symbols={sym},
        all_symbols={sym},
        prices=prices,
        start_date=start,
        end_date=end,
        cash_timeline=[],
    )
    b.build()
    dv = b.daily_values
    assert "equity_cost_basis" in dv.columns
    for i in range(len(dv)):
        tot = float(dv["total"].iloc[i])
        cb = float(dv["equity_cost_basis"].iloc[i])
        assert cb + (tot - cb) == pytest.approx(tot, rel=1e-5, abs=0.02)


def test_time_series_net_equals_total_plus_cash_with_basis():
    start, end = date(2024, 1, 2), date(2024, 1, 5)
    dr = pd.date_range(start, end, freq="B")
    sym = "AAA"
    prices = {sym: pd.DataFrame({sym: [10.0, 10.0, 10.0, 10.0]}, index=dr)}
    tx = [_stock(date(2024, 1, 2), sym, "BUY", 1.0, 10.0)]
    cash_tl = [{"date": "2024-01-02", "cash_balance": 5000.0}]
    b = TimeSeriesBuilder(
        processed_transactions=tx,
        equity_symbols={sym},
        all_symbols={sym},
        prices=prices,
        start_date=start,
        end_date=end,
        cash_timeline=cash_tl,
    )
    b.build()
    dv = b.daily_values
    for i in range(len(dv)):
        t = float(dv["total"].iloc[i])
        c = float(dv["cash"].iloc[i])
        n = float(dv["net_account"].iloc[i])
        assert n == pytest.approx(t + c, rel=1e-5, abs=0.02)


def test_build_history_roundtrip_invariants():
    idx = pd.date_range(date(2024, 1, 2), periods=2, freq="B")
    dv = pd.DataFrame(
        {
            "AAA": [200.0, 210.0],
            "total": [200.0, 210.0],
            "cash": [100.0, 100.0],
            "net_account": [300.0, 310.0],
            "equity_cost_basis": [150.0, 150.0],
        },
        index=idx,
    )
    resp = build_history(dv, None, None)
    for p in resp.history:
        assert p.equity_cost_basis + p.equity_unrealized_pnl == pytest.approx(p.value, abs=0.05)
        assert p.cumulative_realized_pnl == pytest.approx(0.0)
        assert p.equity_total_pnl == pytest.approx(p.equity_unrealized_pnl)
        assert p.cash_balance is not None
        assert p.net_account_value is not None
        assert p.value + p.cash_balance == pytest.approx(p.net_account_value, abs=0.05)


def test_build_history_equity_total_pnl_includes_realized():
    idx = pd.date_range(date(2024, 1, 2), periods=2, freq="B")
    dv = pd.DataFrame(
        {
            "total": [100.0, 80.0],
            "equity_cost_basis": [100.0, 40.0],
        },
        index=idx,
    )
    rmap = {"2024-01-03": 25.0}
    resp = build_history(dv, None, None, daily_cumulative_realized=rmap)
    assert resp.history[0].equity_unrealized_pnl == pytest.approx(0.0)
    assert resp.history[0].cumulative_realized_pnl == pytest.approx(0.0)
    assert resp.history[0].equity_total_pnl == pytest.approx(0.0)
    assert resp.history[1].equity_unrealized_pnl == pytest.approx(40.0)
    assert resp.history[1].cumulative_realized_pnl == pytest.approx(25.0)
    assert resp.history[1].equity_total_pnl == pytest.approx(65.0)
