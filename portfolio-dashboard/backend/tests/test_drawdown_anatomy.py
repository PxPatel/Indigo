from datetime import date, datetime
from unittest.mock import MagicMock

import pandas as pd
import pytest

from models.schemas import Transaction
from services.risk_engine import RiskEngine


def _dt(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time())


def _stock(d: date, symbol: str, side: str, qty: float, price: float) -> Transaction:
    return Transaction(
        date=_dt(d),
        symbol=symbol,
        side=side,
        quantity=qty,
        price=price,
        total_amount=round(qty * price, 2),
        instrument_type="stock",
    )


def _risk(daily_values: pd.DataFrame, txns: list[Transaction] | None = None) -> RiskEngine:
    engine = MagicMock()
    engine.daily_values = daily_values
    wealth_col = "net_account" if "net_account" in daily_values else "total"
    engine.daily_returns = daily_values[wealth_col].pct_change().fillna(0)
    engine.daily_weights = pd.DataFrame(index=daily_values.index)
    engine.start_date = daily_values.index[0].date()
    engine.end_date = daily_values.index[-1].date()
    engine.transactions = txns or []
    engine._accounting_transactions = txns or []
    engine.fund_transfers = []

    market = MagicMock()
    market.get_benchmark_data.return_value = pd.DataFrame(
        {"Close": [100.0 for _ in daily_values.index]},
        index=daily_values.index,
    )
    return RiskEngine(engine, market)


def _point_by_date(response, d: str):
    return next(p for p in response.series if p.date == d)


def test_drawdown_anatomy_zero_at_new_high_even_if_one_symbol_fell():
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    dv = pd.DataFrame(
        {
            "AAA": [100.0, 90.0],
            "BBB": [0.0, 20.0],
            "total": [100.0, 110.0],
        },
        index=idx,
    )

    point = _point_by_date(_risk(dv).get_drawdown_series(), "2024-01-03")

    assert point.drawdown == 0.0
    assert point.peak_date == "2024-01-03"
    assert point.contributors == []
    assert point.cash_or_flow_contribution is None


def test_drawdown_anatomy_no_trade_contributors_sum_to_drawdown():
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    dv = pd.DataFrame(
        {
            "AAA": [60.0, 50.0],
            "BBB": [40.0, 30.0],
            "total": [100.0, 80.0],
        },
        index=idx,
    )

    point = _point_by_date(_risk(dv).get_drawdown_series(), "2024-01-03")
    total_impact = sum(c.impact_percent for c in point.contributors)

    assert point.drawdown == pytest.approx(-20.0)
    assert total_impact == pytest.approx(point.drawdown)
    assert {c.symbol: c.impact_percent for c in point.contributors} == {
        "AAA": pytest.approx(-10.0),
        "BBB": pytest.approx(-10.0),
    }


def test_drawdown_anatomy_buy_during_drawdown_offsets_entry_cash():
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    dv = pd.DataFrame(
        {
            "AAA": [100.0, 80.0],
            "BBB": [0.0, 10.0],
            "total": [100.0, 90.0],
        },
        index=idx,
    )
    txns = [_stock(date(2024, 1, 3), "BBB", "BUY", 1.0, 20.0)]

    point = _point_by_date(_risk(dv, txns).get_drawdown_series(), "2024-01-03")
    impacts = {c.symbol: c.impact_percent for c in point.contributors}

    assert point.drawdown == pytest.approx(-10.0)
    assert impacts["AAA"] == pytest.approx(-20.0)
    assert impacts["BBB"] == pytest.approx(-10.0)
    assert point.cash_or_flow_contribution is not None
    assert point.cash_or_flow_contribution.symbol == "Trading flow / cash not modeled"
    assert point.cash_or_flow_contribution.impact_percent == pytest.approx(20.0)


def test_drawdown_anatomy_sell_keeps_realized_loss_on_ticker_with_cash_anchor():
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    dv = pd.DataFrame(
        {
            "AAA": [100.0, 0.0],
            "total": [100.0, 0.0],
            "cash": [0.0, 80.0],
            "net_account": [100.0, 80.0],
        },
        index=idx,
    )
    txns = [_stock(date(2024, 1, 3), "AAA", "SELL", 1.0, 80.0)]

    point = _point_by_date(_risk(dv, txns).get_drawdown_series(), "2024-01-03")

    assert point.uses_cash_anchor is True
    assert point.drawdown == pytest.approx(-20.0)
    assert len(point.contributors) == 1
    assert point.contributors[0].symbol == "AAA"
    assert point.contributors[0].impact_percent == pytest.approx(-20.0)
    assert point.cash_or_flow_contribution is None


def test_drawdown_anatomy_cash_anchor_reconciles_cash_external_flow():
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    dv = pd.DataFrame(
        {
            "AAA": [100.0, 80.0],
            "total": [100.0, 80.0],
            "cash": [50.0, 60.0],
            "net_account": [150.0, 140.0],
        },
        index=idx,
    )

    point = _point_by_date(_risk(dv).get_drawdown_series(), "2024-01-03")

    assert point.drawdown == pytest.approx(-6.67)
    assert point.contributors[0].impact_percent == pytest.approx(-13.3333)
    assert point.cash_or_flow_contribution is not None
    assert point.cash_or_flow_contribution.symbol == "Cash / external flow"
    assert point.cash_or_flow_contribution.impact_percent == pytest.approx(6.6667)
