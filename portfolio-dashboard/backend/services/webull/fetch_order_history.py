"""Chunked order-history fetch: max ~2y per call, cursor pagination, rate limiting via client."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from services.webull.client import WebullOpenApiClient
from services.webull.mapper import flatten_order_history_payload

logger = logging.getLogger(__name__)

# Docs: max ~2y per *single* request (start_date/end_date span).
MAX_WINDOW_DAYS = 362

# Webull rejects start_date older than ~2 years before *today* (rolling), with errors like:
# OAUTH_OPENAPI_PARAM_ERR / "invalid start_date" (often HTTP 417).
MAX_LOOKBACK_DAYS = 729

PAGE_SIZE = "100"
HISTORY_PATH = "/openapi/trade/order/history"


def earliest_allowed_start(as_of: date | None = None) -> date:
    d = as_of or date.today()
    return d - timedelta(days=MAX_LOOKBACK_DAYS)


def clamp_history_window(
    start: date,
    end: date,
    *,
    as_of: date | None = None,
) -> tuple[date, date] | None:
    """Return (effective_start, effective_end) for the API, or None if the window is entirely disallowed."""
    if start > end:
        return None
    earliest = earliest_allowed_start(as_of)
    eff_start = max(start, earliest)
    eff_end = end
    if eff_start > eff_end:
        return None
    return eff_start, eff_end


def iter_forward_windows(range_start: date, range_end: date) -> list[tuple[date, date]]:
    if range_start > range_end:
        return []
    out: list[tuple[date, date]] = []
    cur = range_start
    while cur <= range_end:
        w_end = min(range_end, cur + timedelta(days=MAX_WINDOW_DAYS))
        out.append((cur, w_end))
        cur = w_end + timedelta(days=1)
    return out


def iter_backward_windows(from_end: date, stop_before: date | None = None) -> list[tuple[date, date]]:
    """Non-overlapping windows moving backward from from_end."""
    stop = stop_before or date(1990, 1, 1)
    out: list[tuple[date, date]] = []
    cur_end = from_end
    while cur_end >= stop:
        cur_start = cur_end - timedelta(days=MAX_WINDOW_DAYS)
        out.append((cur_start, cur_end))
        cur_end = cur_start - timedelta(days=1)
    return out


def _fetch_window_paginated(
    client: WebullOpenApiClient,
    account_id: str,
    start: date,
    end: date,
    *,
    raw_pages_out: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """All order groups in [start, end] with cursor pagination (caller must pass API-valid bounds)."""
    all_groups: list[dict[str, Any]] = []
    last_cursor: str | None = None
    safety_pages = 500
    for _ in range(safety_pages):
        params: dict[str, str] = {
            "account_id": account_id,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "page_size": PAGE_SIZE,
        }
        if last_cursor:
            params["last_client_order_id"] = last_cursor
        try:
            payload = client.get_json(HISTORY_PATH, query_params=params)
        except Exception:
            logger.exception("Webull history fetch failed for %s–%s", start, end)
            raise
        if raw_pages_out is not None:
            raw_pages_out.append({"query": dict(params), "response": payload})
        batch = flatten_order_history_payload(payload)
        if not batch:
            break
        new_last = str(batch[-1].get("client_order_id") or "") if batch else ""
        if last_cursor and new_last == last_cursor:
            logger.warning("Webull pagination stalled at cursor %s", last_cursor)
            break
        all_groups.extend([g for g in batch if isinstance(g, dict)])
        last_cursor = new_last or None
        if len(batch) < int(PAGE_SIZE):
            break
    return all_groups


def fetch_order_history_forward(
    client: WebullOpenApiClient,
    account_id: str,
    range_start: date,
    range_end: date,
    *,
    raw_pages_out: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[tuple[date, date, int]], list[str]]:
    """Strategy (1) and (2): single forward range split into API windows."""
    windows_meta: list[tuple[date, date, int]] = []
    all_groups: list[dict[str, Any]] = []
    warnings: list[str] = []
    today = date.today()
    earliest = earliest_allowed_start(today)

    for w_start, w_end in iter_forward_windows(range_start, range_end):
        bounds = clamp_history_window(w_start, w_end, as_of=today)
        if bounds is None:
            warnings.append(
                f"No API fetch for {w_start.isoformat()}–{w_end.isoformat()}: window is entirely "
                f"before Webull rolling lookback (start_date must be ≥ {earliest.isoformat()})."
            )
            windows_meta.append((w_start, w_end, 0))
            continue
        eff_start, eff_end = bounds
        if eff_start != w_start:
            warnings.append(
                f"Window {w_start.isoformat()}–{w_end.isoformat()}: start_date raised to "
                f"{eff_start.isoformat()} (Webull allows ~{MAX_LOOKBACK_DAYS} days of history from today)."
            )
        chunk = _fetch_window_paginated(
            client, account_id, eff_start, eff_end, raw_pages_out=raw_pages_out
        )
        all_groups.extend(chunk)
        windows_meta.append((w_start, w_end, len(chunk)))

    if range_start < earliest:
        warnings.append(
            f"CSV starts before the API lookback: transactions before {earliest.isoformat()} "
            "will not appear in API rows; rely on CSV for older history."
        )

    return all_groups, windows_meta, warnings


def fetch_order_history_full_backfill(
    client: WebullOpenApiClient,
    account_id: str,
    *,
    max_windows: int = 40,
    raw_pages_out: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[tuple[date, date, int]], list[str]]:
    """Strategy (3): walk backward in slices; stop when a window is entirely before API lookback."""
    windows_meta: list[tuple[date, date, int]] = []
    all_groups: list[dict[str, Any]] = []
    warnings: list[str] = []
    today = date.today()
    earliest = earliest_allowed_start(today)

    for i, (w_start, w_end) in enumerate(iter_backward_windows(today)):
        if i >= max_windows:
            break
        bounds = clamp_history_window(w_start, w_end, as_of=today)
        if bounds is None:
            warnings.append(
                f"Stopped backfill before {w_start.isoformat()}–{w_end.isoformat()}: older history "
                f"is outside Webull rolling lookback (start_date ≥ {earliest.isoformat()})."
            )
            windows_meta.append((w_start, w_end, 0))
            break
        eff_start, eff_end = bounds
        if eff_start != w_start:
            warnings.append(
                f"Window {w_start.isoformat()}–{w_end.isoformat()}: start_date raised to {eff_start.isoformat()}."
            )
        chunk = _fetch_window_paginated(
            client, account_id, eff_start, eff_end, raw_pages_out=raw_pages_out
        )
        windows_meta.append((w_start, w_end, len(chunk)))
        all_groups.extend(chunk)

    return all_groups, windows_meta, warnings
