"""Run CSV vs Webull API order-history diff (manual / dev tool)."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime, timezone
from pathlib import Path

from models.schemas import (
    Transaction,
    WebullCsvApiDiffResponse,
    WebullDiffMatch,
    WebullDiffRequest,
    WebullDiffStrategy,
    WebullFetchWindowMeta,
)
from services.webull.client import WebullOpenApiClient
from services.webull.fetch_order_history import (
    HISTORY_PATH,
    fetch_order_history_forward,
    fetch_order_history_full_backfill,
)
from services.webull.mapper import map_history_to_api_rows, match_csv_to_api, transaction_to_csv_row
from services.webull.local_env import webull_env_diagnostics

logger = logging.getLogger(__name__)

_EXPORT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "webull_api_raw"


def _safe_filename_segment(value: str, max_len: int = 48) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip()) or "account"
    return s[:max_len]


def _save_webull_order_history_raw(
    *,
    strategy: str,
    account_id: str,
    api_host: str,
    fetch_warnings: list[str],
    pages: list[dict],
) -> None:
    try:
        _EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        name = f"webull_order_history_raw_{strategy}_{_safe_filename_segment(account_id)}_{ts}.json"
        path = _EXPORT_DIR / name
        envelope = {
            "saved_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "strategy": strategy,
            "account_id": account_id,
            "api_host": api_host,
            "endpoint": HISTORY_PATH,
            "fetch_warnings": fetch_warnings,
            "pages": pages,
        }
        path.write_text(json.dumps(envelope, indent=2, default=str) + "\n", encoding="utf-8")
        logger.info("Saved raw Webull order history JSON (%s pages) to %s", len(pages), path)
    except OSError as e:
        logger.warning("Could not save raw Webull API JSON under %s: %s", _EXPORT_DIR, e)


def _webull_credentials_help() -> str:
    backend = Path(__file__).resolve().parent.parent.parent
    portfolio = backend.parent
    lines = [
        "WEBULL_APP_KEY and WEBULL_APP_SECRET are missing or empty in the API process.",
        "Put them in one of these files (restart uvicorn after saving), or export them in the shell:",
    ]
    for p in (
        backend / ".env.local",
        backend / "env.local",
        portfolio / ".env.local",
    ):
        lines.append(f"  - {p} {'(exists)' if p.is_file() else '(not found)'}")
    lines.append(
        "Tip: use ASCII KEY=value lines (no smart quotes). UTF-8 BOM and CRLF are OK. "
        "Unset empty shell exports: unset WEBULL_APP_KEY WEBULL_APP_SECRET"
    )
    diag = webull_env_diagnostics(backend)
    if diag:
        lines.append(diag)
    return "\n".join(lines)


def _webull_env() -> tuple[str, str, str, str | None, str | None]:
    key = os.environ.get("WEBULL_APP_KEY", "").strip()
    secret = os.environ.get("WEBULL_APP_SECRET", "").strip()
    host = os.environ.get("WEBULL_API_HOST", "api.webull.com").strip()
    token = os.environ.get("WEBULL_ACCESS_TOKEN", "").strip() or None
    acct = os.environ.get("WEBULL_ACCOUNT_ID", "").strip() or None
    return key, secret, host, token, acct


def run_csv_api_diff(
    csv_transactions: list[Transaction],
    body: WebullDiffRequest,
) -> WebullCsvApiDiffResponse:
    if not csv_transactions:
        raise ValueError("Upload a CSV first so there is a baseline to diff.")

    key, secret, host, token, acct_env = _webull_env()
    if not key or not secret:
        raise ValueError(_webull_credentials_help())

    account_id = (body.account_id or acct_env or "").strip()
    if not account_id:
        raise ValueError("Provide account_id in the request body or set WEBULL_ACCOUNT_ID.")

    client = WebullOpenApiClient(key, secret, host, access_token=token)
    strategy: WebullDiffStrategy = body.strategy
    windows_meta: list[WebullFetchWindowMeta] = []
    end = date.today()

    raw_api_pages: list[dict] = []
    fetch_warnings: list[str] = []
    if strategy == "since_csv_last":
        start = max(t.date.date() for t in csv_transactions)
        groups, raw_meta, fetch_warnings = fetch_order_history_forward(
            client, account_id, start, end, raw_pages_out=raw_api_pages
        )
    elif strategy == "from_csv_first":
        start = min(t.date.date() for t in csv_transactions)
        groups, raw_meta, fetch_warnings = fetch_order_history_forward(
            client, account_id, start, end, raw_pages_out=raw_api_pages
        )
    elif strategy == "full_backfill":
        groups, raw_meta, fetch_warnings = fetch_order_history_full_backfill(
            client, account_id, raw_pages_out=raw_api_pages
        )
    else:
        raise ValueError(f"Unknown strategy: {strategy}")

    for w_start, w_end, n in raw_meta:
        windows_meta.append(
            WebullFetchWindowMeta(start_date=w_start.isoformat(), end_date=w_end.isoformat(), group_count=n)
        )

    _save_webull_order_history_raw(
        strategy=strategy,
        account_id=account_id,
        api_host=host,
        fetch_warnings=fetch_warnings,
        pages=raw_api_pages,
    )

    api_rows = map_history_to_api_rows(groups)
    csv_rows = [transaction_to_csv_row(t, i) for i, t in enumerate(csv_transactions)]
    raw_matches, u_csv, u_api = match_csv_to_api(csv_rows, api_rows)
    matches = [WebullDiffMatch(csv_row_index=a, api_row_index=b, time_delta_ms=ms) for a, b, ms in raw_matches]

    time_note = (
        "API times (UTC): filled_time_at, else filled_time (epoch), else place_time_at, else place_time (epoch). "
        "CSV uses Filled Time from the export, parsed as America/New_York wall time for comparison."
    )

    return WebullCsvApiDiffResponse(
        strategy=strategy,
        account_id=account_id,
        time_note=time_note,
        windows=windows_meta,
        api_group_count=len(groups),
        csv_rows=csv_rows,
        api_rows=api_rows,
        matches=matches,
        unmatched_csv_indices=sorted(u_csv),
        unmatched_api_indices=sorted(u_api),
        fetch_warnings=fetch_warnings,
    )
