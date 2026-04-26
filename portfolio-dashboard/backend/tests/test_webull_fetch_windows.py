from datetime import date, timedelta

from services.webull.fetch_order_history import clamp_history_window, earliest_allowed_start


def test_clamp_entire_window_before_lookback_returns_none():
    today = date(2026, 4, 15)
    earliest = earliest_allowed_start(today)
    assert earliest == today - timedelta(days=729)

    # Historical window ends before API would allow any start_date (rolling from today)
    b = clamp_history_window(date(2021, 12, 2), date(2022, 11, 29), as_of=today)
    assert b is None


def test_clamp_raises_start_when_window_spans_lookback():
    today = date(2026, 4, 15)
    earliest = earliest_allowed_start(today)
    # Window crosses from "too old" into allowed range
    b = clamp_history_window(date(2021, 1, 1), today, as_of=today)
    assert b is not None
    eff_start, eff_end = b
    assert eff_start == earliest
    assert eff_end == today


def test_clamp_allows_recent_window():
    today = date(2026, 4, 15)
    b = clamp_history_window(date(2025, 1, 1), date(2025, 12, 1), as_of=today)
    assert b == (date(2025, 1, 1), date(2025, 12, 1))


def test_clamp_older_range_fully_invalid():
    today = date(2026, 4, 15)
    b2 = clamp_history_window(date(2019, 1, 1), date(2019, 6, 1), as_of=today)
    assert b2 is None
