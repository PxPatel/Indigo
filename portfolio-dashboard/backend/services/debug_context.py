import os
from datetime import date, datetime
from threading import RLock
from typing import Literal, Optional

import pandas as pd
from pydantic import BaseModel, Field

from models.schemas import Transaction


_TRUTHY = {"1", "true", "yes", "on"}
_LOCK = RLock()
_ACTIVE_SCENARIO: Optional["DebugScenario"] = None


class DebugTransactionOverlay(BaseModel):
    date: date
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float
    instrument_type: Literal["stock", "option"] = "stock"
    note: str = ""


class DebugHoldingOverride(BaseModel):
    symbol: str
    shares: float
    avg_cost: float
    instrument_type: Literal["stock", "option"] = "stock"
    name: str = ""
    sector: str = "Debug"


class DebugPriceOverrides(BaseModel):
    current: dict[str, float] = Field(default_factory=dict)
    historical: dict[str, dict[str, float]] = Field(default_factory=dict)


class DebugScenario(BaseModel):
    name: str = "Untitled scenario"
    notes: str = ""
    valuation_date: Optional[date] = None
    transaction_overlays: list[DebugTransactionOverlay] = Field(default_factory=list)
    holding_overrides: list[DebugHoldingOverride] = Field(default_factory=list)
    price_overrides: DebugPriceOverrides = Field(default_factory=DebugPriceOverrides)


class DebugStatus(BaseModel):
    enabled: bool
    active: bool
    scenario: Optional[DebugScenario] = None
    effective_today: date


def _copy_scenario(scenario: DebugScenario) -> DebugScenario:
    if hasattr(scenario, "model_copy"):
        return scenario.model_copy(deep=True)
    return scenario.copy(deep=True)


def debug_scenarios_enabled() -> bool:
    return os.getenv("INDIGO_DEBUG_SCENARIOS", "").strip().lower() in _TRUTHY


def today() -> date:
    with _LOCK:
        if _ACTIVE_SCENARIO and _ACTIVE_SCENARIO.valuation_date:
            return _ACTIVE_SCENARIO.valuation_date
    return date.today()


def active_scenario() -> Optional[DebugScenario]:
    with _LOCK:
        return _copy_scenario(_ACTIVE_SCENARIO) if _ACTIVE_SCENARIO else None


def debug_status() -> DebugStatus:
    scenario = active_scenario()
    return DebugStatus(
        enabled=debug_scenarios_enabled(),
        active=scenario is not None,
        scenario=scenario,
        effective_today=today(),
    )


def apply_scenario(scenario: DebugScenario) -> DebugStatus:
    global _ACTIVE_SCENARIO
    with _LOCK:
        _ACTIVE_SCENARIO = _copy_scenario(scenario)
    return debug_status()


def clear_scenario() -> DebugStatus:
    global _ACTIVE_SCENARIO
    with _LOCK:
        _ACTIVE_SCENARIO = None
    return debug_status()


def _transaction_from_overlay(overlay: DebugTransactionOverlay) -> Transaction:
    return Transaction(
        date=datetime.combine(overlay.date, datetime.min.time()),
        symbol=overlay.symbol.strip().upper(),
        side=overlay.side,
        quantity=overlay.quantity,
        price=overlay.price,
        total_amount=round(overlay.quantity * overlay.price, 2),
        instrument_type=overlay.instrument_type,
    )


def _transactions_from_holdings(
    holdings: list[DebugHoldingOverride],
    synthetic_date: date,
) -> list[Transaction]:
    txns: list[Transaction] = []
    for holding in holdings:
        if abs(holding.shares) < 1e-12:
            continue
        side: Literal["BUY", "SELL"] = "BUY" if holding.shares > 0 else "SELL"
        quantity = abs(holding.shares)
        txns.append(
            Transaction(
                date=datetime.combine(synthetic_date, datetime.min.time()),
                symbol=holding.symbol.strip().upper(),
                side=side,
                quantity=quantity,
                price=holding.avg_cost,
                total_amount=round(quantity * holding.avg_cost, 2),
                instrument_type=holding.instrument_type,
            )
        )
    return txns


def scenario_transactions(
    base_transactions: list[Transaction],
    csv_start: date | None,
) -> list[Transaction]:
    scenario = active_scenario()
    if scenario is None:
        return list(base_transactions)

    if scenario.holding_overrides:
        synthetic_date = csv_start or scenario.valuation_date or today()
        transactions = _transactions_from_holdings(scenario.holding_overrides, synthetic_date)
    else:
        transactions = list(base_transactions)

    transactions.extend(_transaction_from_overlay(t) for t in scenario.transaction_overlays)
    return transactions


def stock_info_overrides() -> dict[str, dict]:
    scenario = active_scenario()
    if scenario is None:
        return {}
    overrides: dict[str, dict] = {}
    for holding in scenario.holding_overrides:
        symbol = holding.symbol.strip().upper()
        overrides[symbol] = {
            "name": holding.name or symbol,
            "sector": holding.sector or "Debug",
            "industry": "Debug Scenario",
            "market_cap": 0,
        }
    return overrides


def current_price_override(symbol: str) -> float | None:
    scenario = active_scenario()
    if scenario is None:
        return None
    value = scenario.price_overrides.current.get(symbol.strip().upper())
    return float(value) if value is not None else None


def apply_historical_price_overrides(
    symbol: str,
    start: date,
    end: date,
    df: pd.DataFrame,
) -> pd.DataFrame:
    scenario = active_scenario()
    if scenario is None:
        return df

    points = scenario.price_overrides.historical.get(symbol.strip().upper(), {})
    if not points:
        return df

    result = df.copy()
    if result.empty:
        result = pd.DataFrame(columns=["Close"])
    for iso_date, close in points.items():
        dt = pd.Timestamp(iso_date)
        if start <= dt.date() <= end:
            result.loc[dt, "Close"] = float(close)
    if result.empty:
        return result
    result.index = pd.to_datetime(result.index).tz_localize(None)
    return result.sort_index()
