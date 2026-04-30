import pandas as pd
import pytest

from services.market_data import _close_frame_for_symbol
from services.portfolio.as_of import close_at_or_before, prior_close


def test_close_frame_for_symbol_flattens_tuple_column_for_symbol_named_like_metric():
    idx = pd.to_datetime(["2026-04-23", "2026-04-24"])
    raw = pd.DataFrame(
        [[12.0], [12.5]],
        index=idx,
        columns=pd.MultiIndex.from_tuples([("ASX", "ASX")]),
    )

    out = _close_frame_for_symbol(raw, "ASX")

    assert list(out.columns) == ["ASX"]
    assert float(out.loc[pd.Timestamp("2026-04-24"), "ASX"]) == pytest.approx(12.5)


def test_as_of_price_lookup_handles_tuple_column_for_symbol_named_like_metric():
    idx = pd.to_datetime(["2026-04-23", "2026-04-24"])
    prices = {
        "ASX": pd.DataFrame(
            [[12.0], [12.5]],
            index=idx,
            columns=pd.MultiIndex.from_tuples([("ASX", "ASX")]),
        )
    }

    close, trading_date = close_at_or_before(prices, "ASX", pd.Timestamp("2026-04-26").date())

    assert close == pytest.approx(12.5)
    assert trading_date == pd.Timestamp("2026-04-24").date()
    assert prior_close(prices, "ASX", pd.Timestamp("2026-04-26").date()) == pytest.approx(12.0)
