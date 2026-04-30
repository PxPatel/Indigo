"""Brokerage API pickup adapters.

The public surface here is intentionally brokerage-agnostic; Webull is the
first adapter behind it.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from models.schemas import (
    BrokerageIntegration,
    BrokerageIntegrationsResponse,
    BrokeragePickupPreviewRequest,
    BrokeragePickupPreviewResponse,
    BrokerageRequestPreview,
    Transaction,
    WebullDiffMatch,
    WebullFetchWindowMeta,
    WebullUniformFillRow,
)
from services.webull.client import WebullOpenApiClient
from services.webull.fetch_order_history import HISTORY_PATH, fetch_order_history_forward
from services.webull.mapper import map_history_to_api_rows, match_csv_to_api, transaction_to_csv_row

NY = ZoneInfo("America/New_York")


def _webull_env() -> tuple[str, str, str, str | None, str | None]:
    key = os.environ.get("WEBULL_APP_KEY", "").strip()
    secret = os.environ.get("WEBULL_APP_SECRET", "").strip()
    host = os.environ.get("WEBULL_API_HOST", "api.webull.com").strip()
    token = os.environ.get("WEBULL_ACCESS_TOKEN", "").strip() or None
    account_id = os.environ.get("WEBULL_ACCOUNT_ID", "").strip() or None
    return key, secret, host, token, account_id


def _mask_identifier(value: str) -> str:
    stripped = value.strip()
    if len(stripped) <= 4:
        return "••••"
    return f"••••{stripped[-4:]}"


def _resolve_webull_account_id(requested: str | None, env_account_id: str | None) -> str:
    account_id = (requested or env_account_id or "").strip()
    if not account_id:
        raise ValueError("Provide account_id in the request body or set WEBULL_ACCOUNT_ID.")
    return account_id


def _webull_request_preview(host: str, account_id: str, start: date, end: date) -> BrokerageRequestPreview:
    return BrokerageRequestPreview(
        method="GET",
        url=f"https://{host}{HISTORY_PATH}",
        query={
            "account_id": _mask_identifier(account_id),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "page_size": "100",
        },
        body=None,
        hidden=[
            "x-app-key",
            "x-access-token",
            "x-signature",
            "WEBULL_APP_SECRET",
            "cookies",
        ],
    )


def list_brokerage_integrations(csv_transactions: list[Transaction]) -> BrokerageIntegrationsResponse:
    key, secret, host, _token, account_id = _webull_env()
    warnings: list[str] = []
    configured = True
    unavailable_reason = None

    if not key or not secret:
        configured = False
        unavailable_reason = "WEBULL_APP_KEY and WEBULL_APP_SECRET are required on the backend."
    if not account_id:
        configured = False
        if unavailable_reason:
            warnings.append("WEBULL_ACCOUNT_ID is not set; you can still provide it before pickup.")
        else:
            unavailable_reason = "WEBULL_ACCOUNT_ID is not set; provide it before pickup."

    request_preview = None
    if csv_transactions and account_id:
        start = max(t.date.date() for t in csv_transactions)
        request_preview = _webull_request_preview(host, account_id, start, date.today())

    return BrokerageIntegrationsResponse(
        integrations=[
            BrokerageIntegration(
                id="webull",
                label="Webull",
                description="Fetch filled order history from Webull OpenAPI and compare it against the uploaded CSV.",
                configured=configured,
                unavailable_reason=unavailable_reason,
                warnings=warnings,
                request_preview=request_preview,
            )
        ]
    )


def preview_brokerage_pickup(
    integration: str,
    csv_transactions: list[Transaction],
    body: BrokeragePickupPreviewRequest,
) -> BrokeragePickupPreviewResponse:
    if integration != "webull":
        raise ValueError(f"Unsupported brokerage integration: {integration}")
    return _preview_webull_pickup(csv_transactions, body)


def _preview_webull_pickup(
    csv_transactions: list[Transaction],
    body: BrokeragePickupPreviewRequest,
) -> BrokeragePickupPreviewResponse:
    if not csv_transactions:
        raise ValueError("Upload a CSV first so brokerage pickup has a baseline to compare.")

    key, secret, host, token, env_account_id = _webull_env()
    if not key or not secret:
        raise ValueError("WEBULL_APP_KEY and WEBULL_APP_SECRET are required on the backend.")

    account_id = _resolve_webull_account_id(body.account_id, env_account_id)
    requested_start = max(t.date.date() for t in csv_transactions)
    requested_end = date.today()

    client = WebullOpenApiClient(key, secret, host, access_token=token)
    groups, raw_meta, fetch_warnings = fetch_order_history_forward(
        client,
        account_id,
        requested_start,
        requested_end,
    )
    api_rows = map_history_to_api_rows(groups)
    csv_rows = [transaction_to_csv_row(t, i) for i, t in enumerate(csv_transactions)]
    raw_matches, _u_csv, unmatched_api_indices = match_csv_to_api(csv_rows, api_rows)
    unmatched_api_rows = [api_rows[i] for i in sorted(unmatched_api_indices)]
    matches = [WebullDiffMatch(csv_row_index=a, api_row_index=b, time_delta_ms=ms) for a, b, ms in raw_matches]
    windows = [
        WebullFetchWindowMeta(start_date=w_start.isoformat(), end_date=w_end.isoformat(), group_count=count)
        for w_start, w_end, count in raw_meta
    ]

    time_note = (
        "API times use Webull's fill instant where available. CSV times are parsed as America/New_York wall time; "
        "matching compares the normalized UTC instant."
    )

    return BrokeragePickupPreviewResponse(
        integration="webull",
        account_id=_mask_identifier(account_id),
        request_preview=_webull_request_preview(host, account_id, requested_start, requested_end),
        csv_start_date=min(t.date.date() for t in csv_transactions).isoformat(),
        csv_last_date=requested_start.isoformat(),
        requested_start_date=requested_start.isoformat(),
        requested_end_date=requested_end.isoformat(),
        windows=windows,
        api_group_count=len(groups),
        api_rows=api_rows,
        unmatched_api_rows=unmatched_api_rows,
        matches=matches,
        fetch_warnings=fetch_warnings,
        time_note=time_note,
    )


def pickup_row_to_manual_entry_fields(row: WebullUniformFillRow) -> dict[str, Any]:
    if row.source != "api":
        raise ValueError("Only API trades can be imported.")
    filled_at = row.filled_at_utc.strip()
    if filled_at.endswith("Z"):
        filled_at = filled_at[:-1] + "+00:00"
    trade_date = datetime.fromisoformat(filled_at).astimezone(NY).date().isoformat()
    note_parts = ["Imported from Webull API", f"filled_at={row.filled_at_utc}"]
    if row.order_id:
        note_parts.append(f"order_id={row.order_id}")
    if row.client_order_id:
        note_parts.append(f"client_order_id={row.client_order_id}")
    return {
        "date": trade_date,
        "symbol": row.symbol.strip().upper(),
        "side": row.side,
        "quantity": row.quantity,
        "price": row.price,
        "total_amount": row.total_amount,
        "note": "; ".join(note_parts),
        "instrument_type": row.instrument_type,
    }
