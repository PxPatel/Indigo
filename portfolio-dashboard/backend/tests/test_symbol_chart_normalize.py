"""OHLCV normalization for yfinance frame shape variants."""

import pandas as pd

from services.symbol_chart import _normalize_yfinance_ohlcv_df


def test_normalize_lowercase_columns():
    idx = pd.date_range("2024-01-01", periods=2, freq="D")
    df = pd.DataFrame(
        {
            "open": [1.0, 2.0],
            "high": [1.1, 2.1],
            "low": [0.9, 1.9],
            "close": [1.05, 2.05],
            "volume": [10.0, 20.0],
        },
        index=idx,
    )
    out = _normalize_yfinance_ohlcv_df(df)
    assert list(out.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert len(out) == 2


def test_normalize_multindex_metric_then_ticker():
    idx = pd.date_range("2024-01-01", periods=1, freq="D")
    cols = pd.MultiIndex.from_tuples(
        [
            ("Open", "NVDA"),
            ("High", "NVDA"),
            ("Low", "NVDA"),
            ("Close", "NVDA"),
            ("Volume", "NVDA"),
        ]
    )
    df = pd.DataFrame([[1.0, 1.2, 0.8, 1.1, 1000.0]], index=idx, columns=cols)
    out = _normalize_yfinance_ohlcv_df(df)
    assert list(out.columns) == ["Open", "High", "Low", "Close", "Volume"]


def test_close_only_filled():
    idx = pd.date_range("2024-01-01", periods=1, freq="D")
    df = pd.DataFrame({"Close": [50.0]}, index=idx)
    out = _normalize_yfinance_ohlcv_df(df)
    assert out["Open"].iloc[0] == 50.0
    assert out["Volume"].iloc[0] == 0.0
