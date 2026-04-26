"""Map Webull order-history JSON groups → uniform fill rows for diff / future ingestion."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from zoneinfo import ZoneInfo

from models.schemas import Transaction, WebullUniformFillRow
from services.parsers._utils import (
    OPTIONS_MULTIPLIER,
    _is_option,
    _normalize_side,
    _parse_float,
    _round_currency,
    build_occ_option_symbol,
)

logger = logging.getLogger(__name__)

UTC = ZoneInfo("UTC")
NY = ZoneInfo("America/New_York")


def _format_fill_instant_utc_iso_ms(dt_utc: datetime) -> str:
    """Canonical ``filled_at_utc`` for CSV and API rows: UTC instant, ms precision, ``Z`` suffix."""
    if dt_utc.tzinfo is None:
        raise ValueError("fill time must be timezone-aware for UTC serialization")
    u = dt_utc.astimezone(UTC)
    return u.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _instant_for_match_from_filled_at_utc(filled_at_utc: str) -> datetime:
    """Parse ``filled_at_utc`` back to an aware UTC instant — same basis used for CSV and API rows."""
    s = filled_at_utc.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s).astimezone(UTC)


_FILLED_STATUSES = frozenset(
    {"FILLED", "PARTIALLY_FILLED", "PARTIAL_FILLED", "PARTIAL", "EXECUTED", "COMPLETED"}
)


def _side_from_position_intent(intent: Any) -> str | None:
    """Map Webull ``position_intent`` (e.g. SELL_TO_OPEN, BUY_TO_CLOSE) → BUY | SELL.

    Covers long/short options and equity: open/close is still a buy or sell for ledger purposes.
    """
    if intent is None or intent == "":
        return None
    u = str(intent).strip().upper().replace(" ", "_")
    if u.startswith("SELL"):
        return "SELL"
    if u.startswith("BUY"):
        return "BUY"
    return None


def _parse_api_time(iso_z: str) -> datetime:
    """ISO-8601 instant (often with ``Z``) → UTC aware."""
    s = iso_z.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s).astimezone(UTC)


def _parse_epoch_to_utc(val: Any) -> datetime | None:
    """Webull ``filled_time`` / ``place_time``: epoch in seconds, ms, or μs (UTC)."""
    if val is None or val == "":
        return None
    try:
        if isinstance(val, str):
            s = val.strip()
            if not s:
                return None
            n = float(s)
        else:
            n = float(val)
    except (ValueError, TypeError):
        return None
    if n <= 0:
        return None
    if n >= 1e15:
        sec = n / 1_000_000.0
    elif n >= 1e12:
        sec = n / 1000.0
    else:
        sec = n
    return datetime.fromtimestamp(sec, tz=UTC)


def _order_fill_time_utc(od: dict[str, Any]) -> datetime | None:
    """Resolve fill/placement instant in UTC.

    Priority: ``filled_time_at``, ``filled_time`` (epoch), ``place_time_at``, ``place_time`` (epoch).
    """
    fta = od.get("filled_time_at")
    if fta is not None and str(fta).strip():
        try:
            return _parse_api_time(str(fta).strip())
        except ValueError:
            pass

    e = _parse_epoch_to_utc(od.get("filled_time"))
    if e is not None:
        return e

    pta = od.get("place_time_at")
    if pta is not None and str(pta).strip():
        try:
            return _parse_api_time(str(pta).strip())
        except ValueError:
            pass

    return _parse_epoch_to_utc(od.get("place_time"))


def flatten_order_history_payload(payload: Any) -> list[dict[str, Any]]:
    """Normalize response body to a list of combo/group objects."""
    if isinstance(payload, list):
        return [g for g in payload if isinstance(g, dict)]
    if isinstance(payload, dict):
        for key in ("data", "list", "items", "orders", "result"):
            v = payload.get(key)
            if isinstance(v, list):
                return [g for g in v if isinstance(g, dict)]
    logger.warning("Unexpected Webull order history shape: %s", type(payload).__name__)
    return []


def map_order_group_to_rows(group: dict[str, Any]) -> list[WebullUniformFillRow]:
    """Expand one API group (combo_type + orders[]) into 0..n uniform rows.

    OPTION + ``legs[]``: builds OCC symbols (underlying + YYMMDD + P/C + strike×1000) so CSV
    diff matches Webull exports. SINGLE-leg uses order ``filled_quantity``; multi-leg spreads
    emit one row per leg (leg qty / side); net ``filled_price`` is split evenly across legs
    for ``total_amount`` (approximation until per-leg premiums exist on the API).

    ``position_intent`` (SELL_TO_OPEN, BUY_TO_CLOSE, …) overrides ``side`` when present so
    short-option opens/closes match the ledger (same BUY/SELL convention as equity shorts).
    """
    combo_type = str(group.get("combo_type") or "")
    parent_client_id = group.get("client_order_id")
    rows: list[WebullUniformFillRow] = []
    for od in group.get("orders") or []:
        if not isinstance(od, dict):
            continue
        status = str(od.get("status") or "").upper().replace(" ", "_")
        if status not in _FILLED_STATUSES:
            continue
        raw_qty = od.get("filled_quantity") or od.get("total_quantity") or "0"
        try:
            qty = abs(_parse_float(str(raw_qty)))
        except (ValueError, TypeError):
            continue
        if qty <= 0:
            continue
        order_side = _side_from_position_intent(od.get("position_intent")) or _normalize_side(
            str(od.get("side") or "")
        )
        if order_side is None:
            continue
        price_raw = od.get("filled_price") or od.get("limit_price") or "0"
        try:
            price = abs(_parse_float(str(price_raw)))
        except (ValueError, TypeError):
            continue
        if price <= 0:
            continue
        dt_utc = _order_fill_time_utc(od)
        if dt_utc is None:
            logger.debug("Skip order: no usable time (filled_time_at / filled_time / place_time_at / place_time)")
            continue

        inst_u = str(od.get("instrument_type") or "").upper()
        sub_legs = od.get("legs") if isinstance(od.get("legs"), list) else []
        dict_legs = [sl for sl in sub_legs if isinstance(sl, dict)]

        # (symbol, quantity, side, premium_per_contract)
        slices: list[tuple[str, float, str, float]] = []

        if inst_u == "OPTION" and dict_legs:
            n_leg = len(dict_legs)
            split_prem = price / n_leg if n_leg > 1 else price
            for sl in dict_legs:
                u = str(sl.get("symbol") or od.get("symbol") or "").strip().upper()
                exp = str(sl.get("option_expire_date") or "").strip()
                if u and exp:
                    try:
                        occ = build_occ_option_symbol(
                            u,
                            exp,
                            str(sl.get("option_type") or "PUT"),
                            sl.get("strike_price") or "0",
                        )
                    except (ValueError, TypeError) as e:
                        logger.warning("Option OCC build failed for %s: %s", u, e)
                        occ = u
                else:
                    occ = u or str(od.get("symbol") or "").strip().upper()
                try:
                    lq = abs(_parse_float(str(sl.get("quantity") or "0")))
                except (ValueError, TypeError):
                    lq = 0.0
                use_q = qty if n_leg == 1 else (lq if lq > 0 else qty)
                s_side = (
                    _side_from_position_intent(sl.get("position_intent"))
                    or _side_from_position_intent(od.get("position_intent"))
                    or _normalize_side(str(sl.get("side") or od.get("side") or ""))
                )
                if s_side is None:
                    s_side = order_side
                if not occ:
                    continue
                slices.append((occ, use_q, s_side, split_prem))
        else:
            symbol = str(od.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            slices.append((symbol, qty, order_side, price))

        local = dt_utc.astimezone(NY)
        filled_utc_s = _format_fill_instant_utc_iso_ms(dt_utc)
        filled_est_s = local.strftime("%Y-%m-%d %H:%M:%S") + f" {local.tzname()}"

        for symbol, use_q, s_side, prem in slices:
            is_opt = _is_option(symbol) or inst_u == "OPTION"
            mult = OPTIONS_MULTIPLIER if is_opt else 1
            prem_r = round(prem, 6)
            total_amount = _round_currency(use_q * prem_r * mult)
            rows.append(
                WebullUniformFillRow(
                    source="api",
                    row_index=0,
                    symbol=symbol,
                    side=s_side,  # type: ignore[arg-type]
                    quantity=use_q,
                    price=prem_r,
                    total_amount=total_amount,
                    instrument_type="option" if is_opt else "stock",
                    filled_at_utc=filled_utc_s,
                    filled_at_est=filled_est_s,
                    combo_type=combo_type or None,
                    client_order_id=str(od.get("client_order_id") or parent_client_id or "") or None,
                    order_id=str(od.get("order_id") or "") or None,
                )
            )
    return rows


def _dedupe_api_rows(rows: list[WebullUniformFillRow]) -> list[WebullUniformFillRow]:
    seen: set[tuple[Any, ...]] = set()
    uniq: list[WebullUniformFillRow] = []
    for r in rows:
        key = (r.client_order_id, r.order_id, r.symbol, r.side, r.filled_at_utc, r.quantity, r.price)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    return [r.model_copy(update={"row_index": i}) for i, r in enumerate(uniq)]


def map_history_to_api_rows(groups: list[dict[str, Any]]) -> list[WebullUniformFillRow]:
    out: list[WebullUniformFillRow] = []
    for g in groups:
        out.extend(map_order_group_to_rows(g))
    return _dedupe_api_rows(out)


def transaction_to_csv_row(t: Transaction, row_index: int) -> WebullUniformFillRow:
    """CSV dates are naive wall time; treat as America/New_York (Webull US export with EST/EDT stripped in parser)."""
    naive = t.date
    if naive.tzinfo is None:
        local = naive.replace(tzinfo=NY)
    else:
        local = naive.astimezone(NY)
    utc = local.astimezone(UTC)
    return WebullUniformFillRow(
        source="csv",
        row_index=row_index,
        symbol=t.symbol.upper(),
        side=t.side,
        quantity=t.quantity,
        price=round(t.price, 6),
        total_amount=t.total_amount,
        instrument_type=t.instrument_type,
        filled_at_utc=_format_fill_instant_utc_iso_ms(utc),
        filled_at_est=local.strftime("%Y-%m-%d %H:%M:%S") + f" {local.tzname()}",
        combo_type=None,
        client_order_id=None,
        order_id=None,
    )


def match_csv_to_api(
    csv_rows: list[WebullUniformFillRow],
    api_rows: list[WebullUniformFillRow],
    *,
    time_tolerance_sec: float = 5.0,
    price_tolerance: float = 0.02,
) -> tuple[list[tuple[int, int, int]], set[int], set[int]]:
    """Greedy match: same symbol, side, qty, price within tol; closest time within window.

    Time delta is ``|csv_utc - api_utc|`` on ``filled_at_utc`` only: both CSV and API rows use the same
    UTC serialization (``_format_fill_instant_utc_iso_ms``) and the matcher parses both with
    ``_instant_for_match_from_filled_at_utc``.
    """
    used_api: set[int] = set()
    matches: list[tuple[int, int, int]] = []
    for i, c in enumerate(csv_rows):
        best_j: int | None = None
        best_dt = time_tolerance_sec + 1.0
        for j, a in enumerate(api_rows):
            if j in used_api:
                continue
            if c.symbol != a.symbol or c.side != a.side:
                continue
            if abs(c.quantity - a.quantity) > 2e-2:
                continue
            if abs(c.price - a.price) > price_tolerance:
                continue
            ct = _instant_for_match_from_filled_at_utc(c.filled_at_utc)
            at = _instant_for_match_from_filled_at_utc(a.filled_at_utc)
            dt = abs((ct - at).total_seconds())
            if dt <= time_tolerance_sec and dt < best_dt:
                best_dt = dt
                best_j = j
        if best_j is not None:
            used_api.add(best_j)
            matches.append((i, best_j, int(round(best_dt * 1000))))
    matched_csv = {m[0] for m in matches}
    matched_api = {m[1] for m in matches}
    unmatched_csv = set(range(len(csv_rows))) - matched_csv
    unmatched_api = set(range(len(api_rows))) - matched_api
    return matches, unmatched_csv, unmatched_api
