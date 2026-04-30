from datetime import date, datetime

import pandas as pd
import pytest

from models.schemas import Transaction
import services.debug_context as debug_context
from services.debug_context import (
    DebugHoldingOverride,
    DebugPriceOverrides,
    DebugScenario,
    DebugTransactionOverlay,
)


def _txn(d: date, symbol: str = "AAA") -> Transaction:
    return Transaction(
        date=datetime.combine(d, datetime.min.time()),
        symbol=symbol,
        side="BUY",
        quantity=1.0,
        price=10.0,
        total_amount=10.0,
        instrument_type="stock",
    )


@pytest.fixture(autouse=True)
def clear_debug_scenario():
    debug_context.clear_scenario()
    yield
    debug_context.clear_scenario()


def test_debug_gate_reads_explicit_env_flag(monkeypatch):
    monkeypatch.delenv("INDIGO_DEBUG_SCENARIOS", raising=False)
    assert debug_context.debug_scenarios_enabled() is False

    monkeypatch.setenv("INDIGO_DEBUG_SCENARIOS", "1")
    assert debug_context.debug_scenarios_enabled() is True


def test_valuation_date_controls_shared_today():
    debug_context.apply_scenario(
        DebugScenario(name="freeze", valuation_date=date(2024, 1, 5))
    )

    assert debug_context.today() == date(2024, 1, 5)


def test_holding_override_replaces_base_transactions_and_keeps_overlays():
    scenario = DebugScenario(
        name="holdings",
        valuation_date=date(2024, 1, 5),
        holding_overrides=[
            DebugHoldingOverride(symbol="BBB", shares=3.0, avg_cost=20.0)
        ],
        transaction_overlays=[
            DebugTransactionOverlay(
                date=date(2024, 1, 4),
                symbol="CCC",
                side="BUY",
                quantity=2.0,
                price=5.0,
            )
        ],
    )
    debug_context.apply_scenario(scenario)

    txns = debug_context.scenario_transactions(
        [_txn(date(2024, 1, 2), "AAA")],
        date(2024, 1, 2),
    )

    assert [t.symbol for t in txns] == ["BBB", "CCC"]
    assert txns[0].date.date() == date(2024, 1, 2)
    assert txns[0].total_amount == pytest.approx(60.0)
    assert txns[1].total_amount == pytest.approx(10.0)


def test_price_overrides_do_not_mutate_source_frame():
    source = pd.DataFrame({"Close": [10.0]}, index=pd.to_datetime(["2024-01-02"]))
    scenario = DebugScenario(
        name="prices",
        price_overrides=DebugPriceOverrides(
            current={"AAA": 12.5},
            historical={"AAA": {"2024-01-03": 11.0}},
        ),
    )
    debug_context.apply_scenario(scenario)

    out = debug_context.apply_historical_price_overrides(
        "AAA",
        date(2024, 1, 2),
        date(2024, 1, 3),
        source,
    )

    assert debug_context.current_price_override("AAA") == pytest.approx(12.5)
    assert "2024-01-03" not in source.index.strftime("%Y-%m-%d").tolist()
    assert float(out.loc[pd.Timestamp("2024-01-03"), "Close"]) == pytest.approx(11.0)
