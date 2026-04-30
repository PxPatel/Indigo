from pathlib import Path
import os

_backend_dir = Path(__file__).resolve().parent
_portfolio_dir = _backend_dir.parent

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def _load_env_file_fallback(path: Path, override: bool = False) -> None:
    """Tiny .env reader for local dev when python-dotenv is not installed."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and (override or key not in os.environ):
            os.environ[key] = value


if load_dotenv is not None:
    load_dotenv(_backend_dir / ".env")
    load_dotenv(_portfolio_dir / ".env")
    for path in (
        _portfolio_dir / ".env.local",
        _portfolio_dir / "env.local",
        _backend_dir / ".env.local",
        _backend_dir / "env.local",
        Path.cwd() / ".env.local",
        Path.cwd() / "env.local",
    ):
        load_dotenv(path, override=True)
else:
    _load_env_file_fallback(_backend_dir / ".env")
    _load_env_file_fallback(_portfolio_dir / ".env")
    for path in (
        _portfolio_dir / ".env.local",
        _portfolio_dir / "env.local",
        _backend_dir / ".env.local",
        _backend_dir / "env.local",
        Path.cwd() / ".env.local",
        Path.cwd() / "env.local",
    ):
        _load_env_file_fallback(path, override=True)

# WEBULL_* — always parse with utf-8-sig / CRLF-safe logic (works even if python-dotenv
# is not installed in the interpreter that runs uvicorn).
from services.webull.local_env import merge_webull_env_from_paths, standard_webull_env_paths

merge_webull_env_from_paths(standard_webull_env_paths(_backend_dir, _portfolio_dir), override=True)

from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import date, datetime
from typing import Optional
import io

import requests

from services.csv_parser import parse_csv
from services.portfolio_engine import PortfolioEngine
from services.market_data import MarketDataService, price_refresh_scope
from services.risk_engine import RiskEngine
from services.benchmark import BenchmarkService
from services.attribution import AttributionService
from services.price_provider import get_price_provider
from services.symbol_chart import SymbolChartService
from services.simulator import SimulatorService
from services.debug_context import (
    DebugScenario,
    DebugStatus,
    active_scenario,
    apply_scenario,
    clear_scenario,
    debug_scenarios_enabled,
    debug_status,
    scenario_transactions,
    today as debug_today,
)
from models.schemas import (
    Transaction,
    UploadResponse,
    PortfolioSummary,
    PortfolioHistoryResponse,
    PortfolioWeightsResponse,
    HoldingsResponse,
    CashflowTimelineResponse,
    RiskMetricsResponse,
    DrawdownResponse,
    CorrelationResponse,
    SectorExposureResponse,
    BenchmarkCompareResponse,
    TransactionsResponse,
    ManualEntryRequest,
    ManualEntryRecord,
    ManualEntriesResponse,
    FundTransferRequest,
    FundTransferRecord,
    FundTransfersResponse,
    CashAnchorRequest,
    CashAnchorResponse,
    AttributionResponse,
    SymbolChartResponse,
    SimulatorResponse,
    CostBasisLadderResponse,
    BrokerageIntegrationsResponse,
    BrokeragePickupPreviewRequest,
    BrokeragePickupPreviewResponse,
    BrokeragePickupImportRequest,
    BrokeragePickupImportResponse,
    WebullCsvApiDiffResponse,
    WebullDiffRequest,
)
from services.webull.diff_job import run_csv_api_diff
from services.brokerage_pickup import (
    list_brokerage_integrations,
    pickup_row_to_manual_entry_fields,
    preview_brokerage_pickup,
)

app = FastAPI(title="Portfolio Command Center", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state
_engine: Optional[PortfolioEngine] = None
_risk: Optional[RiskEngine] = None
_benchmark_svc: Optional[BenchmarkService] = None
market = MarketDataService()

# Persistent across rebuilds — survives manual entry add/remove
_csv_transactions: list[Transaction] = []
_manual_entries: list[ManualEntryRecord] = []
_manual_id_counter: int = 0
_fund_transfers: list[FundTransferRecord] = []
_fund_transfer_id_counter: int = 0
_cash_anchor: Optional[CashAnchorRequest] = None
_PRICE_REFRESH_MODES = {"live", "slow", "off"}


def _coerce_price_refresh_mode(price_mode: Optional[str], live: Optional[bool]) -> str:
    if price_mode is not None:
        if price_mode not in _PRICE_REFRESH_MODES:
            raise HTTPException(status_code=400, detail="price_mode must be live, slow, or off")
        return price_mode
    if live is None:
        return "live"
    return "live" if live else "slow"


def _require_engine() -> PortfolioEngine:
    if _engine is None:
        raise HTTPException(status_code=400, detail="No portfolio data. Upload a CSV first.")
    return _engine


def _require_risk() -> RiskEngine:
    if _risk is None:
        raise HTTPException(status_code=400, detail="No portfolio data. Upload a CSV first.")
    return _risk


def _manual_entries_as_transactions() -> list[Transaction]:
    """Convert manual entries into Transaction objects for merging."""
    txns = []
    for e in _manual_entries:
        txns.append(Transaction(
            date=datetime.strptime(e.date, "%Y-%m-%d"),
            symbol=e.symbol.upper(),
            side=e.side,
            quantity=e.quantity,
            price=e.price,
            total_amount=e.total_amount,
            instrument_type=e.instrument_type,
        ))
    return txns


def _manual_entry_total_amount(quantity: float, price: float, instrument_type: str) -> float:
    multiplier = 100 if instrument_type == "option" else 1
    return round(quantity * price * multiplier, 2)


def _dedup_and_sort(transactions: list[Transaction]) -> list[Transaction]:
    """De-duplicate by (date, symbol, side, quantity, price) and sort chronologically."""
    seen = set()
    result = []
    for t in transactions:
        key = (t.date.isoformat(), t.symbol, t.side, t.quantity, t.price)
        if key not in seen:
            seen.add(key)
            result.append(t)
    result.sort(key=lambda t: t.date)
    return result


def _rebuild_engine() -> None:
    """Merge CSV transactions + manual entries, rebuild all derived state."""
    global _engine, _risk, _benchmark_svc

    all_txns = list(_csv_transactions) + _manual_entries_as_transactions()
    csv_start = min(t.date.date() for t in _csv_transactions) if _csv_transactions else None
    transactions = _dedup_and_sort(scenario_transactions(all_txns, csv_start))

    if not transactions:
        _engine = None
        _risk = None
        _benchmark_svc = None
        return

    # Convert fund transfers to the format the engine expects
    transfers = [
        {"date": ft.date, "type": ft.type, "amount": ft.amount, "note": ft.note}
        for ft in _fund_transfers
    ]

    # Cash anchor as dict or None
    anchor = (
        {"date": _cash_anchor.date, "balance": _cash_anchor.balance}
        if _cash_anchor else None
    )

    # Anchor start_date to the CSV data's first transaction.
    # Manual entries can fall within the portfolio range but must never shift
    # start_date backward — doing so extends the price-fetch window and includes
    # dead-period (all-zero) days in returns, causing haywire risk metrics.

    _engine = PortfolioEngine(transactions, market, fund_transfers=transfers, cash_anchor=anchor, csv_start=csv_start)
    _engine.build()
    _risk = RiskEngine(_engine, market)
    _benchmark_svc = BenchmarkService(_engine, market)


@app.get("/api/v1/status")
async def status():
    return {"has_data": _engine is not None}


if debug_scenarios_enabled():
    @app.get("/api/v1/debug/status", response_model=DebugStatus)
    async def debug_scenario_status():
        return debug_status()


    @app.get("/api/v1/debug/scenario", response_model=DebugScenario)
    async def export_debug_scenario():
        scenario = active_scenario()
        if scenario is None:
            raise HTTPException(status_code=404, detail="No active debug scenario.")
        return scenario


    @app.post("/api/v1/debug/scenario", response_model=DebugStatus)
    async def import_debug_scenario(scenario: DebugScenario):
        apply_scenario(scenario)
        _rebuild_engine()
        return debug_status()


    @app.delete("/api/v1/debug/scenario", response_model=DebugStatus)
    async def clear_debug_scenario():
        clear_scenario()
        _rebuild_engine()
        return debug_status()


@app.post("/api/v1/upload", response_model=UploadResponse)
async def upload_csv(files: list[UploadFile] = File(...)):
    global _csv_transactions
    all_transactions = []
    for file in files:
        content = await file.read()
        text = content.decode("utf-8")
        txns = parse_csv(io.StringIO(text))
        all_transactions.extend(txns)

    if not all_transactions:
        raise HTTPException(status_code=400, detail="No valid transactions found in the uploaded CSV(s).")

    _csv_transactions = all_transactions
    _rebuild_engine()

    engine = _require_engine()
    transactions = engine.transactions
    return UploadResponse(
        transaction_count=len(transactions),
        symbols=sorted(engine.symbols),
        date_range_start=transactions[0].date.date().isoformat(),
        date_range_end=transactions[-1].date.date().isoformat(),
        total_invested=float(engine.cumulative_invested),
    )


@app.post("/api/v1/webull/csv-api-diff", response_model=WebullCsvApiDiffResponse)
async def webull_csv_api_diff(body: WebullDiffRequest):
    """Dev tool: fetch Webull order history vs uploaded CSV with greedy timestamp matching."""
    try:
        return run_csv_api_diff(_csv_transactions, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Webull HTTP error: {e}",
        ) from e


# --- Brokerage pickup ---

@app.get("/api/v1/brokerage-integrations", response_model=BrokerageIntegrationsResponse)
async def brokerage_integrations():
    return list_brokerage_integrations(_csv_transactions)


@app.post(
    "/api/v1/brokerage-integrations/{integration}/preview",
    response_model=BrokeragePickupPreviewResponse,
)
async def brokerage_pickup_preview(integration: str, body: BrokeragePickupPreviewRequest):
    try:
        return preview_brokerage_pickup(integration, _csv_transactions, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Brokerage HTTP error: {e}",
        ) from e


@app.post(
    "/api/v1/brokerage-integrations/{integration}/import",
    response_model=BrokeragePickupImportResponse,
)
async def brokerage_pickup_import(integration: str, body: BrokeragePickupImportRequest):
    global _manual_entries, _manual_id_counter
    if integration != "webull":
        raise HTTPException(status_code=400, detail=f"Unsupported brokerage integration: {integration}")
    if not body.trades:
        raise HTTPException(status_code=400, detail="Select at least one trade to import.")

    csv_min = min((t.date.date() for t in _csv_transactions), default=None)
    imported_ids: list[int] = []
    skipped_count = 0
    existing_import_notes = {e.note for e in _manual_entries if e.note.startswith("Imported from Webull API")}

    records_to_import: list[ManualEntryRecord] = []
    next_id = _manual_id_counter

    for row in body.trades:
        try:
            fields = pickup_row_to_manual_entry_fields(row)
            entry_date = datetime.strptime(fields["date"], "%Y-%m-%d").date()
        except (ValueError, TypeError) as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        if fields["quantity"] <= 0 or fields["price"] <= 0:
            raise HTTPException(status_code=400, detail="Imported trades must have positive quantity and price.")
        if csv_min is not None and entry_date < csv_min:
            raise HTTPException(
                status_code=400,
                detail=f"Imported trade {fields['date']} is before your earliest CSV transaction ({csv_min}).",
            )
        if entry_date > debug_today():
            raise HTTPException(status_code=400, detail="Imported trade date cannot be in the future.")
        if fields["note"] in existing_import_notes:
            skipped_count += 1
            continue

        next_id += 1
        record = ManualEntryRecord(
            id=next_id,
            date=fields["date"],
            symbol=fields["symbol"],
            side=fields["side"],
            quantity=fields["quantity"],
            price=fields["price"],
            total_amount=fields["total_amount"],
            note=fields["note"],
            instrument_type=fields["instrument_type"],
        )
        records_to_import.append(record)
        existing_import_notes.add(record.note)
        imported_ids.append(record.id)

    if records_to_import:
        previous_entries = list(_manual_entries)
        previous_counter = _manual_id_counter
        _manual_entries.extend(records_to_import)
        _manual_id_counter = next_id
        try:
            _rebuild_engine()
        except Exception as e:
            _manual_entries = previous_entries
            _manual_id_counter = previous_counter
            try:
                _rebuild_engine()
            except Exception:
                pass
            raise HTTPException(
                status_code=500,
                detail=f"Imported trades could not be applied to the portfolio: {e}",
            ) from e

    return BrokeragePickupImportResponse(
        integration="webull",
        imported_ids=imported_ids,
        skipped_count=skipped_count,
        manual_entries=ManualEntriesResponse(entries=_manual_entries, count=len(_manual_entries)),
    )


# --- Manual entries ---

@app.get("/api/v1/manual-entries", response_model=ManualEntriesResponse)
async def get_manual_entries():
    return ManualEntriesResponse(entries=_manual_entries, count=len(_manual_entries))


@app.post("/api/v1/manual-entries", response_model=ManualEntriesResponse)
async def add_manual_entry(entry: ManualEntryRequest):
    global _manual_id_counter

    # Validate
    if entry.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive.")
    if entry.price <= 0:
        raise HTTPException(status_code=400, detail="Price must be positive.")
    try:
        entry_date = datetime.strptime(entry.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD format.")
    if not entry.symbol.strip():
        raise HTTPException(status_code=400, detail="Symbol is required.")
    if _csv_transactions:
        csv_min = min(t.date.date() for t in _csv_transactions)
        csv_max = max(t.date.date() for t in _csv_transactions)
        if entry_date < csv_min:
            raise HTTPException(
                status_code=400,
                detail=f"Date {entry.date} is before your earliest transaction ({csv_min}). Manual entries must fall within your CSV date range.",
            )
        if entry_date > debug_today():
            raise HTTPException(status_code=400, detail="Date cannot be in the future.")

    _manual_id_counter += 1
    record = ManualEntryRecord(
        id=_manual_id_counter,
        date=entry.date,
        symbol=entry.symbol.strip().upper(),
        side=entry.side,
        quantity=entry.quantity,
        price=entry.price,
        total_amount=_manual_entry_total_amount(entry.quantity, entry.price, entry.instrument_type),
        note=entry.note,
        instrument_type=entry.instrument_type,
    )
    _manual_entries.append(record)
    _rebuild_engine()

    return ManualEntriesResponse(entries=_manual_entries, count=len(_manual_entries))


@app.delete("/api/v1/manual-entries/{entry_id}", response_model=ManualEntriesResponse)
async def delete_manual_entry(entry_id: int):
    global _manual_entries
    before = len(_manual_entries)
    _manual_entries = [e for e in _manual_entries if e.id != entry_id]
    if len(_manual_entries) == before:
        raise HTTPException(status_code=404, detail="Entry not found.")
    _rebuild_engine()
    return ManualEntriesResponse(entries=_manual_entries, count=len(_manual_entries))


# --- Fund transfers ---

@app.get("/api/v1/fund-transfers", response_model=FundTransfersResponse)
async def get_fund_transfers():
    return FundTransfersResponse(transfers=_fund_transfers, count=len(_fund_transfers))


@app.post("/api/v1/fund-transfers", response_model=FundTransfersResponse)
async def add_fund_transfer(transfer: FundTransferRequest):
    global _fund_transfer_id_counter

    if transfer.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive.")
    try:
        datetime.strptime(transfer.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD format.")

    _fund_transfer_id_counter += 1
    record = FundTransferRecord(
        id=_fund_transfer_id_counter,
        date=transfer.date,
        type=transfer.type,
        amount=transfer.amount,
        note=transfer.note,
    )
    _fund_transfers.append(record)
    _rebuild_engine()
    return FundTransfersResponse(transfers=_fund_transfers, count=len(_fund_transfers))


@app.delete("/api/v1/fund-transfers/{transfer_id}", response_model=FundTransfersResponse)
async def delete_fund_transfer(transfer_id: int):
    global _fund_transfers
    before = len(_fund_transfers)
    _fund_transfers = [t for t in _fund_transfers if t.id != transfer_id]
    if len(_fund_transfers) == before:
        raise HTTPException(status_code=404, detail="Transfer not found.")
    _rebuild_engine()
    return FundTransfersResponse(transfers=_fund_transfers, count=len(_fund_transfers))


# --- Cash balance anchor ---

@app.get("/api/v1/cash-anchor", response_model=CashAnchorResponse)
async def get_cash_anchor():
    engine = _require_engine()
    return CashAnchorResponse(
        anchor=_cash_anchor,
        cash_timeline=engine.get_cash_timeline(),
    )


@app.post("/api/v1/cash-anchor", response_model=CashAnchorResponse)
async def set_cash_anchor(anchor: CashAnchorRequest):
    global _cash_anchor

    if anchor.balance < 0:
        raise HTTPException(status_code=400, detail="Balance cannot be negative.")
    try:
        datetime.strptime(anchor.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD format.")

    _cash_anchor = anchor
    _rebuild_engine()
    engine = _require_engine()
    return CashAnchorResponse(
        anchor=_cash_anchor,
        cash_timeline=engine.get_cash_timeline(),
    )


@app.delete("/api/v1/cash-anchor", response_model=CashAnchorResponse)
async def delete_cash_anchor():
    global _cash_anchor
    _cash_anchor = None
    _rebuild_engine()
    engine = _require_engine()
    return CashAnchorResponse(
        anchor=None,
        cash_timeline=engine.get_cash_timeline(),
    )


# --- Portfolio endpoints ---

@app.get("/api/v1/portfolio/summary", response_model=PortfolioSummary)
async def portfolio_summary(
    price_mode: Optional[str] = Query(None),
    live: Optional[bool] = Query(None),
):
    engine = _require_engine()
    with price_refresh_scope(_coerce_price_refresh_mode(price_mode, live)):
        return engine.get_summary()


@app.get("/api/v1/portfolio/history", response_model=PortfolioHistoryResponse)
async def portfolio_history(
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
):
    engine = _require_engine()
    return engine.get_history(start, end)


@app.get("/api/v1/portfolio/weights", response_model=PortfolioWeightsResponse)
async def portfolio_weights(
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
):
    engine = _require_engine()
    return engine.get_weights(start, end)


@app.get("/api/v1/portfolio/holdings", response_model=HoldingsResponse)
async def portfolio_holdings(
    price_mode: Optional[str] = Query(None),
    live: Optional[bool] = Query(None),
    as_of: Optional[date] = Query(None),
):
    engine = _require_engine()
    if as_of is not None:
        try:
            resp = engine.get_holdings_as_of(as_of)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    else:
        with price_refresh_scope(_coerce_price_refresh_mode(price_mode, live)):
            resp = engine.get_holdings()
    resp.earliest_date = engine.start_date.isoformat()
    return resp


@app.get(
    "/api/v1/portfolio/holdings/{symbol}/cost-ladder",
    response_model=CostBasisLadderResponse,
)
async def portfolio_cost_basis_ladder(
    symbol: str,
    price_mode: Optional[str] = Query(None),
    live: Optional[bool] = Query(None),
    as_of: Optional[date] = Query(None),
):
    engine = _require_engine()
    try:
        if as_of is not None:
            return engine.get_cost_basis_ladder(symbol, as_of=as_of)
        with price_refresh_scope(_coerce_price_refresh_mode(price_mode, live)):
            return engine.get_cost_basis_ladder(symbol)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.get("/api/v1/cashflow/timeline", response_model=CashflowTimelineResponse)
async def cashflow_timeline(
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
):
    engine = _require_engine()
    return engine.get_cashflow_timeline(start, end)


@app.get("/api/v1/risk/metrics", response_model=RiskMetricsResponse)
async def risk_metrics(
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
):
    risk = _require_risk()
    return risk.compute_metrics(start, end)


@app.get("/api/v1/risk/drawdown", response_model=DrawdownResponse)
async def risk_drawdown(
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
    benchmark: str = Query("SPY"),
):
    risk = _require_risk()
    return risk.get_drawdown_series(start, end, benchmark)


@app.get("/api/v1/risk/correlation", response_model=CorrelationResponse)
async def risk_correlation(
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
):
    risk = _require_risk()
    return risk.get_correlation_matrix(start, end)


@app.get("/api/v1/risk/sector", response_model=SectorExposureResponse)
async def risk_sector():
    risk = _require_risk()
    return risk.get_sector_exposure()


@app.get("/api/v1/benchmark/compare", response_model=BenchmarkCompareResponse)
async def benchmark_compare(
    benchmark: str = Query("SPY"),
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
):
    if _benchmark_svc is None:
        raise HTTPException(status_code=400, detail="No portfolio data. Upload a CSV first.")
    return _benchmark_svc.compare(benchmark, start, end)


@app.get("/api/v1/simulator/holdings", response_model=SimulatorResponse)
async def simulator_holdings(benchmark: str = Query("SPY")):
    engine = _require_engine()
    svc = SimulatorService(engine, market)
    return svc.get_holdings(benchmark)


@app.get("/api/v1/symbol/{symbol}/chart", response_model=SymbolChartResponse)
async def symbol_chart(
    symbol: str,
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
    timeframe: Optional[str] = Query(
        None,
        description="Charts tab preset e.g. 1D, 5D, 1M — 1D uses intraday bars",
    ),
):
    # Works even without portfolio data — returns OHLCV with no trade overlay
    svc = SymbolChartService(_engine, market)
    return svc.get_chart(symbol, start, end, timeframe)


@app.get("/api/v1/portfolio/attribution", response_model=AttributionResponse)
async def portfolio_attribution(
    price_mode: Optional[str] = Query(None),
    live: Optional[bool] = Query(None),
):
    engine = _require_engine()
    with price_refresh_scope(_coerce_price_refresh_mode(price_mode, live)):
        svc = AttributionService(engine, get_price_provider(market))
        return svc.compute()


@app.get("/api/v1/transactions", response_model=TransactionsResponse)
async def transactions(
    symbol: Optional[str] = None,
    side: Optional[str] = None,
    start: Optional[date] = Query(None, alias="from"),
    end: Optional[date] = Query(None, alias="to"),
):
    engine = _require_engine()
    return engine.get_transactions(symbol=symbol, side=side, start=start, end=end)
