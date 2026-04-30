from datetime import date, datetime

import pandas as pd

from models.schemas import Transaction
from services.portfolio.time_series import TimeSeriesBuilder


def test_time_series_uses_one_price_series_when_price_frame_has_duplicate_symbol_columns():
    date_range = pd.date_range(date(2026, 4, 1), date(2026, 4, 3), freq="B")
    prices = pd.DataFrame(
        [[100.0, 999.0], [101.0, 999.0], [102.0, 999.0]],
        index=date_range,
        columns=["AAPL", "AAPL"],
    )
    builder = TimeSeriesBuilder(
        processed_transactions=[
            Transaction(
                date=datetime(2026, 4, 1, 10, 30),
                symbol="AAPL",
                side="BUY",
                quantity=2.0,
                price=100.0,
                total_amount=200.0,
            )
        ],
        equity_symbols={"AAPL"},
        all_symbols={"AAPL"},
        prices={"AAPL": prices},
        start_date=date(2026, 4, 1),
        end_date=date(2026, 4, 3),
    )

    builder.build()

    assert builder.daily_values["AAPL"].tolist() == [200.0, 202.0, 204.0]
