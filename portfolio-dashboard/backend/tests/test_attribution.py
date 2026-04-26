from datetime import date

import pandas as pd
import pytest

from services.attribution import AttributionService
from services.portfolio.query import QueryService


def test_snapshot_weights_use_prior_trading_day():
    weights = pd.DataFrame(
        {"AAA": [0.25, 0.5], "BBB": [0.75, 0.5]},
        index=pd.to_datetime(["2024-01-02", "2024-01-03"]),
    )
    service = QueryService(original_transactions=[], daily_weights=weights, stock_info={})

    snap_date, snap_weights = service.get_snapshot_weights(date(2024, 1, 3))

    assert snap_date == "2024-01-02"
    assert snap_weights == {"AAA": 0.25, "BBB": 0.75}


def test_attribution_uses_account_level_weights_without_cash_double_scaling():
    class Engine:
        cash_anchor = None
        daily_values = pd.DataFrame(
            {"total": [500.0], "net_account": [1000.0]},
            index=pd.to_datetime(["2024-01-03"]),
        )

        def get_snapshot_weights(self, target_date):
            return "2024-01-02", {"AAA": 0.5}

        def get_holding_sectors(self):
            return {"AAA": "Tech"}

    class Provider:
        def get_daily_returns(self, symbols, target_date):
            return target_date, {"AAA": 10.0}

    result = AttributionService(Engine(), Provider()).compute(date(2024, 1, 3))

    assert result.cash_weight == 50.0
    assert result.portfolio_return == pytest.approx(5.0)
    assert result.contributors[0].weight == 50.0
    assert result.contributors[0].contribution == pytest.approx(5.0)
