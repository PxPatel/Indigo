from datetime import datetime

from zoneinfo import ZoneInfo

from services.webull.mapper import _order_fill_time_utc

UTC = ZoneInfo("UTC")


def _expect(dt: datetime, y: int, mo: int, d: int, h: int, mi: int, s: int) -> None:
    got = dt.astimezone(UTC)
    assert (got.year, got.month, got.day, got.hour, got.minute, got.second) == (y, mo, d, h, mi, s)


def test_priority_filled_time_at_over_epoch():
    iso = "2024-05-15T12:00:00.000Z"
    dt = _order_fill_time_utc(
        {
            "filled_time_at": iso,
            "filled_time": 9999999999999,
        }
    )
    assert dt is not None
    _expect(dt, 2024, 5, 15, 12, 0, 0)


def test_filled_time_epoch_ms():
    dt = _order_fill_time_utc({"filled_time": 1715774400000})
    assert dt is not None
    _expect(dt, 2024, 5, 15, 12, 0, 0)


def test_filled_time_epoch_seconds():
    dt = _order_fill_time_utc({"filled_time": 1715774400})
    assert dt is not None
    _expect(dt, 2024, 5, 15, 12, 0, 0)


def test_place_time_at_when_no_fill_fields():
    dt = _order_fill_time_utc({"place_time_at": "2024-05-15T12:00:00.000Z"})
    assert dt is not None
    _expect(dt, 2024, 5, 15, 12, 0, 0)


def test_place_time_epoch_last_resort():
    dt = _order_fill_time_utc({"place_time": 1715774400000})
    assert dt is not None
    _expect(dt, 2024, 5, 15, 12, 0, 0)


def test_invalid_filled_time_at_falls_through_to_filled_time():
    dt = _order_fill_time_utc({"filled_time_at": "not-a-date", "filled_time": 1715774400})
    assert dt is not None
    _expect(dt, 2024, 5, 15, 12, 0, 0)


def test_none_when_all_missing():
    assert _order_fill_time_utc({}) is None
