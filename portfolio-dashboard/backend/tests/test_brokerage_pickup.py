from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

import main
import services.brokerage_pickup as pickup
from models.schemas import (
    BrokeragePickupImportRequest,
    Transaction,
    WebullUniformFillRow,
)


class FrozenDate(date):
    @classmethod
    def today(cls):
        return cls(2026, 4, 29)


def _txn(dt: datetime, symbol: str = "AAPL") -> Transaction:
    return Transaction(
        date=dt,
        symbol=symbol,
        side="BUY",
        quantity=1.0,
        price=100.0,
        total_amount=100.0,
        instrument_type="stock",
    )


def _api_row(
    *,
    row_index: int,
    symbol: str,
    filled_at_utc: str,
    side: str = "BUY",
    quantity: float = 1.0,
    price: float = 100.0,
    total_amount: float | None = None,
    instrument_type: str = "stock",
    order_id: str | None = None,
) -> WebullUniformFillRow:
    return WebullUniformFillRow(
        source="api",
        row_index=row_index,
        symbol=symbol,
        side=side,
        quantity=quantity,
        price=price,
        total_amount=total_amount if total_amount is not None else quantity * price * (100 if instrument_type == "option" else 1),
        instrument_type=instrument_type,
        filled_at_utc=filled_at_utc,
        filled_at_est="2026-04-01 10:30:00 EDT",
        order_id=order_id,
    )


def test_integration_discovery_masks_request_preview(monkeypatch):
    monkeypatch.setenv("WEBULL_APP_KEY", "key")
    monkeypatch.setenv("WEBULL_APP_SECRET", "secret")
    monkeypatch.setenv("WEBULL_ACCOUNT_ID", "123456789")
    monkeypatch.setattr(pickup, "date", FrozenDate)

    response = pickup.list_brokerage_integrations([_txn(datetime(2026, 4, 20, 9, 30))])
    integration = response.integrations[0]

    assert integration.id == "webull"
    assert integration.configured is True
    assert integration.request_preview is not None
    assert integration.request_preview.query["account_id"] == "••••6789"
    assert integration.request_preview.query["start_date"] == "2026-04-20"
    assert "WEBULL_APP_SECRET" in integration.request_preview.hidden
    assert "secret" not in integration.request_preview.model_dump_json()


def test_webull_pickup_preview_uses_csv_last_date_inclusively(monkeypatch):
    monkeypatch.setenv("WEBULL_APP_KEY", "key")
    monkeypatch.setenv("WEBULL_APP_SECRET", "secret")
    monkeypatch.setenv("WEBULL_ACCOUNT_ID", "acct-7890")
    monkeypatch.setattr(pickup, "date", FrozenDate)
    monkeypatch.setattr(pickup, "WebullOpenApiClient", lambda *args, **kwargs: object())

    captured = {}

    def fake_fetch(_client, account_id, start, end):
        captured["account_id"] = account_id
        captured["start"] = start
        captured["end"] = end
        return [], [(start, end, 2)], ["lookback note"]

    csv_txn = _txn(datetime(2026, 4, 1, 10, 30))
    # Use the actual CSV mapper for the matched row so this test covers the same matching basis.
    matching_utc = pickup.transaction_to_csv_row(csv_txn, 0).filled_at_utc
    api_rows = [
        _api_row(row_index=0, symbol="AAPL", filled_at_utc=matching_utc, order_id="matched"),
        _api_row(row_index=1, symbol="MSFT", filled_at_utc="2026-04-02T14:30:00.000Z", order_id="new"),
    ]

    monkeypatch.setattr(pickup, "fetch_order_history_forward", fake_fetch)
    monkeypatch.setattr(pickup, "map_history_to_api_rows", lambda _groups: api_rows)

    response = pickup.preview_brokerage_pickup(
        "webull",
        [_txn(datetime(2025, 1, 2, 9, 30)), csv_txn],
        pickup.BrokeragePickupPreviewRequest(),
    )

    assert captured["account_id"] == "acct-7890"
    assert captured["start"] == date(2026, 4, 1)
    assert captured["end"] == date(2026, 4, 29)
    assert response.requested_start_date == "2026-04-01"
    assert response.unmatched_api_rows == [api_rows[1]]
    assert response.fetch_warnings == ["lookback note"]


def test_pickup_row_to_manual_entry_fields_preserves_option_total():
    row = _api_row(
        row_index=0,
        symbol="SPY260501C00600000",
        side="BUY",
        quantity=2.0,
        price=1.25,
        total_amount=250.0,
        instrument_type="option",
        filled_at_utc="2026-04-28T15:30:00.000Z",
        order_id="oid-1",
    )

    fields = pickup.pickup_row_to_manual_entry_fields(row)

    assert fields["date"] == "2026-04-28"
    assert fields["instrument_type"] == "option"
    assert fields["total_amount"] == 250.0
    assert "order_id=oid-1" in fields["note"]


@pytest.fixture(autouse=True)
def reset_main_state(monkeypatch):
    main._csv_transactions = [_txn(datetime(2026, 4, 1, 10, 30))]
    main._manual_entries = []
    main._manual_id_counter = 0
    monkeypatch.setattr(main, "_rebuild_engine", lambda: None)
    yield
    main._csv_transactions = []
    main._manual_entries = []
    main._manual_id_counter = 0


def test_import_endpoint_adds_selected_trades_as_manual_entries(monkeypatch):
    monkeypatch.setattr(main, "debug_today", lambda: date(2026, 4, 29))
    client = TestClient(main.app)
    row = _api_row(
        row_index=0,
        symbol="AAPL",
        filled_at_utc="2026-04-02T14:30:00.000Z",
        order_id="new-1",
    )

    response = client.post(
        "/api/v1/brokerage-integrations/webull/import",
        json=BrokeragePickupImportRequest(trades=[row]).model_dump(),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["imported_ids"] == [1]
    assert payload["manual_entries"]["count"] == 1
    entry = payload["manual_entries"]["entries"][0]
    assert entry["symbol"] == "AAPL"
    assert entry["instrument_type"] == "stock"
    assert entry["note"].startswith("Imported from Webull API")


def test_import_endpoint_skips_duplicate_webull_imports(monkeypatch):
    monkeypatch.setattr(main, "debug_today", lambda: date(2026, 4, 29))
    client = TestClient(main.app)
    row = _api_row(
        row_index=0,
        symbol="AAPL",
        filled_at_utc="2026-04-02T14:30:00.000Z",
        order_id="new-1",
    )
    body = BrokeragePickupImportRequest(trades=[row]).model_dump()

    first = client.post("/api/v1/brokerage-integrations/webull/import", json=body)
    second = client.post("/api/v1/brokerage-integrations/webull/import", json=body)

    assert first.status_code == 200
    assert second.status_code == 200
    payload = second.json()
    assert payload["imported_ids"] == []
    assert payload["skipped_count"] == 1
    assert payload["manual_entries"]["count"] == 1


def test_import_endpoint_rolls_back_when_rebuild_fails(monkeypatch):
    monkeypatch.setattr(main, "debug_today", lambda: date(2026, 4, 29))

    def fail_rebuild():
        raise ValueError("price frame exploded")

    monkeypatch.setattr(main, "_rebuild_engine", fail_rebuild)
    client = TestClient(main.app)
    row = _api_row(
        row_index=0,
        symbol="AAPL",
        filled_at_utc="2026-04-02T14:30:00.000Z",
        order_id="new-1",
    )

    response = client.post(
        "/api/v1/brokerage-integrations/webull/import",
        json=BrokeragePickupImportRequest(trades=[row]).model_dump(),
    )

    assert response.status_code == 500
    assert main._manual_entries == []
    assert main._manual_id_counter == 0
