"""Flow-adjusted benchmark returns: external cash removed from daily wealth changes."""

import pandas as pd

from services.benchmark import _flow_adjusted_returns, _compound_return_index


def test_deposit_only_flat_performance():
    """Wealth jumps only from deposit; adjusted return is ~0 and index stays ~100."""
    idx = pd.date_range("2024-01-02", periods=3, freq="B")
    w = pd.Series([100.0, 200.0, 200.0], index=idx)
    flows = {idx[1].strftime("%Y-%m-%d"): 100.0}
    r = _flow_adjusted_returns(w, flows)
    assert abs(r.iloc[1]) < 1e-9
    assert abs(r.iloc[2]) < 1e-9
    ix = _compound_return_index(r)
    assert abs(ix.iloc[0] - 100.0) < 1e-6
    assert abs(ix.iloc[-1] - 100.0) < 1e-6


def test_no_transfers_matches_wealth_ratio_compound():
    """With F=0, compounded flow-adjusted index matches wealth normalization."""
    idx = pd.date_range("2024-01-02", periods=5, freq="B")
    w = pd.Series([100.0, 102.0, 101.0, 105.0, 104.0], index=idx)
    r = _flow_adjusted_returns(w, {})
    ix = _compound_return_index(r)
    for i in range(len(w)):
        assert abs(ix.iloc[i] - (w.iloc[i] / w.iloc[0]) * 100.0) < 1e-6


def test_withdrawal_removes_from_delta():
    """Withdrawal reduces wealth; adjusted return isolates market move."""
    idx = pd.date_range("2024-01-02", periods=2, freq="B")
    w = pd.Series([1000.0, 400.0], index=idx)
    flows = {idx[1].strftime("%Y-%m-%d"): -500.0}
    r = _flow_adjusted_returns(w, flows)
    # ΔW = -600, F = -500 → market component -100 → -10%
    assert abs(r.iloc[1] - (-0.10)) < 1e-9


def test_deposit_timing_no_false_negative_return():
    """Deposit recorded before wealth updates: do not imply -100% daily return."""
    idx = pd.date_range("2024-01-02", periods=3, freq="B")
    # Flat wealth then jump (deposit lands in W on day 3 only)
    w = pd.Series([10000.0, 10000.0, 20000.0], index=idx)
    d2, d3 = idx[1].strftime("%Y-%m-%d"), idx[2].strftime("%Y-%m-%d")
    # Early entry on d2; same deposit also tagged on d3 when W updates (user double-entry)
    flows = {d2: 10000.0, d3: 10000.0}
    r = _flow_adjusted_returns(w, flows)
    assert r.iloc[1] > -0.01  # was ~-1.0 without coherent cap
    assert abs(r.iloc[2]) < 1e-9  # ΔW matches F on jump day
    ix = _compound_return_index(r)
    assert abs(ix.iloc[-1] - 100.0) < 1e-6
