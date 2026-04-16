"""Tests for date-scoped risk metrics and correlation."""

import random
from datetime import date
from unittest.mock import MagicMock

import pandas as pd
import pytest

from services.risk_engine import RiskEngine


def _risk_with_synthetic_series():
    random.seed(42)
    idx = pd.date_range(date(2024, 1, 2), periods=80, freq="B")
    dr = pd.Series([random.gauss(0, 0.015) for _ in range(len(idx))], index=idx)
    total = (1 + dr).cumprod() * 10000
    dv = pd.DataFrame({"total": total.values}, index=idx)
    dw = pd.DataFrame({"AAA": [0.5] * len(idx), "BBB": [0.5] * len(idx)}, index=idx)
    engine = MagicMock()
    engine.daily_returns = dr
    engine.daily_values = dv
    engine.daily_weights = dw
    risk = RiskEngine(engine, MagicMock())
    spy = pd.Series([random.gauss(0, 0.01) for _ in range(len(idx))], index=idx)
    risk._spy_returns = spy
    return risk


def test_compute_metrics_empty_range_returns_zeros():
    risk = _risk_with_synthetic_series()
    out = risk.compute_metrics(date(2030, 1, 1), date(2030, 1, 5))
    assert out.volatility_annualized == 0.0
    assert out.sharpe_ratio == 0.0
    assert out.beta == 0.0
    assert out.hhi == 0.0


def test_compute_metrics_partial_window_runs():
    risk = _risk_with_synthetic_series()
    out = risk.compute_metrics(date(2024, 4, 1), date(2024, 6, 30))
    assert out.volatility_annualized >= 0.0
    assert isinstance(out.sharpe_ratio, float)


def test_correlation_matrix_short_window():
    random.seed(7)
    idx = pd.date_range(date(2024, 1, 2), periods=30, freq="B")
    r1 = pd.Series([random.gauss(0, 0.01) for _ in range(len(idx))], index=idx)
    r2 = pd.Series([random.gauss(0, 0.01) for _ in range(len(idx))], index=idx)
    engine = MagicMock()
    engine._shares_held = {"AAA": 1.0, "BBB": 1.0}
    engine._prices = {
        "AAA": pd.DataFrame({"AAA": (1 + r1).cumprod()}, index=idx),
        "BBB": pd.DataFrame({"BBB": (1 + r2).cumprod()}, index=idx),
    }
    risk = RiskEngine(engine, MagicMock())
    narrow = risk.get_correlation_matrix(date(2024, 1, 15), date(2024, 1, 25))
    assert narrow.symbols == ["AAA", "BBB"]
    assert len(narrow.matrix) == 2
    assert narrow.matrix[0][0] == pytest.approx(1.0)
    assert narrow.matrix[1][1] == pytest.approx(1.0)
