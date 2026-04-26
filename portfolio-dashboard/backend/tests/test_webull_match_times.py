"""CSV vs API diff matching uses the same UTC instant for both sides."""

from datetime import datetime

from zoneinfo import ZoneInfo

from models.schemas import Transaction, WebullUniformFillRow
from services.webull.mapper import (
    _format_fill_instant_utc_iso_ms,
    _instant_for_match_from_filled_at_utc,
    match_csv_to_api,
    transaction_to_csv_row,
)

NY = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")


def test_csv_and_api_filled_at_utc_same_canonical_format():
    naive = datetime(2024, 6, 15, 10, 30, 0)
    t = Transaction(
        date=naive,
        symbol="AAPL",
        side="BUY",
        quantity=1.0,
        price=100.0,
        total_amount=100.0,
        instrument_type="stock",
    )
    csv_row = transaction_to_csv_row(t, 0)
    local = naive.replace(tzinfo=NY)
    api_utc = local.astimezone(UTC)
    api_row = WebullUniformFillRow(
        source="api",
        row_index=0,
        symbol="AAPL",
        side="BUY",
        quantity=1.0,
        price=100.0,
        total_amount=100.0,
        instrument_type="stock",
        filled_at_utc=_format_fill_instant_utc_iso_ms(api_utc),
        filled_at_est="unused",
    )
    assert csv_row.filled_at_utc == api_row.filled_at_utc


def test_match_uses_utc_delta_csv_ny_wall_vs_api_z():
    naive = datetime(2024, 6, 15, 10, 30, 0)
    t = Transaction(
        date=naive,
        symbol="AAPL",
        side="BUY",
        quantity=1.0,
        price=100.0,
        total_amount=100.0,
        instrument_type="stock",
    )
    csv_row = transaction_to_csv_row(t, 0)
    api_utc = naive.replace(tzinfo=NY).astimezone(UTC)
    api_row = WebullUniformFillRow(
        source="api",
        row_index=0,
        symbol="AAPL",
        side="BUY",
        quantity=1.0,
        price=100.0,
        total_amount=100.0,
        instrument_type="stock",
        filled_at_utc=_format_fill_instant_utc_iso_ms(api_utc),
        filled_at_est="unused",
    )
    matches, u_csv, u_api = match_csv_to_api([csv_row], [api_row], time_tolerance_sec=5.0)
    assert matches == [(0, 0, 0)]
    assert u_csv == set()
    assert u_api == set()


def test_instant_parser_round_trip_utc():
    dt = datetime(2024, 1, 2, 15, 4, 5, 123000, tzinfo=UTC)
    s = _format_fill_instant_utc_iso_ms(dt)
    back = _instant_for_match_from_filled_at_utc(s)
    assert back == dt.replace(microsecond=123000)
