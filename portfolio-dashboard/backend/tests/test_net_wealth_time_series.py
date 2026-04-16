"""Tests for cash-aware net wealth, time series, and drawdown helpers."""

from datetime import date, datetime

import pandas as pd
import pytest

from models.schemas import Transaction
from services.portfolio.time_series import TimeSeriesBuilder, _cash_series_from_timeline
from services.portfolio.response_builders import build_history
from utils.calculations import max_drawdown, wealth_series


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


def test_cash_series_ffill_aligns_to_business_days():
    dr = pd.date_range(date(2024, 1, 2), date(2024, 1, 8), freq="B")
    tl = [
        {"date": "2024-01-02", "cash_balance": 1000.0},
        {"date": "2024-01-04", "cash_balance": 900.0},
    ]
    s = _cash_series_from_timeline(tl, dr)
    assert float(s.loc[pd.Timestamp("2024-01-02")]) == pytest.approx(1000.0)
    assert float(s.loc[pd.Timestamp("2024-01-03")]) == pytest.approx(1000.0)
    assert float(s.loc[pd.Timestamp("2024-01-04")]) == pytest.approx(900.0)


def test_wealth_series_prefers_net_account():
    idx = pd.date_range(date(2024, 1, 2), periods=3, freq="B")
    df = pd.DataFrame({"total": [1.0, 2.0, 3.0], "net_account": [10.0, 11.0, 12.0]}, index=idx)
    assert wealth_series(df).tolist() == [10.0, 11.0, 12.0]
    df2 = pd.DataFrame({"total": [1.0, 2.0, 3.0]}, index=idx)
    assert wealth_series(df2).tolist() == [1.0, 2.0, 3.0]


def test_max_drawdown_undefined_without_positive_peak():
    s = pd.Series([-10.0, -20.0, -15.0])
    md, peak, trough = max_drawdown(s)
    assert md == 0.0
    assert peak is None
    assert trough is None


def test_max_drawdown_classic_path():
    s = pd.Series([100.0, 80.0, 90.0])
    md, _, _ = max_drawdown(s)
    assert md == pytest.approx(-0.2)


def test_time_series_net_account_equals_total_plus_cash():
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
    assert "net_account" in dv.columns
    assert "cash" in dv.columns
    assert float(dv["net_account"].iloc[0]) == pytest.approx(float(dv["total"].iloc[0]) + 5000.0)


def test_time_series_no_anchor_has_no_net_account_column():
    start, end = date(2024, 1, 2), date(2024, 1, 4)
    dr = pd.date_range(start, end, freq="B")
    sym = "AAA"
    prices = {sym: pd.DataFrame({sym: [10.0, 10.0, 10.0]}, index=dr)}
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
    assert "net_account" not in b.daily_values.columns


def test_build_history_net_account_field():
    idx = pd.date_range(date(2024, 1, 2), periods=3, freq="B")
    dv = pd.DataFrame(
        {
            "AAA": [100.0, 100.0, 100.0],
            "total": [100.0, 100.0, 100.0],
            "cash": [50.0, 50.0, 50.0],
            "net_account": [150.0, 150.0, 150.0],
            "equity_cost_basis": [70.0, 70.0, 70.0],
        },
        index=idx,
    )
    resp = build_history(dv, None, None)
    assert len(resp.history) == 3
    assert resp.history[0].net_account_value == pytest.approx(150.0)
    assert resp.history[0].value == pytest.approx(100.0)
    assert resp.history[0].equity_cost_basis == pytest.approx(70.0)
    assert resp.history[0].equity_unrealized_pnl == pytest.approx(30.0)
    assert resp.history[0].equity_total_pnl == pytest.approx(30.0)
    assert resp.history[0].cash_balance == pytest.approx(50.0)
