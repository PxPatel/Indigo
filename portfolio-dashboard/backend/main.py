from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import date, datetime
from typing import Optional
import io

from services.csv_parser import parse_csv
from services.portfolio_engine import PortfolioEngine
from services.market_data import MarketDataService, live_prices_scope
from services.risk_engine import RiskEngine
from services.benchmark import BenchmarkService
from services.attribution import AttributionService
from services.price_provider import get_price_provider
from services.symbol_chart import SymbolChartService
from services.simulator import SimulatorService
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
        ))
    return txns


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
    transactions = _dedup_and_sort(all_txns)

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
    csv_start = min(t.date.date() for t in _csv_transactions) if _csv_transactions else None

    _engine = PortfolioEngine(transactions, market, fund_transfers=transfers, cash_anchor=anchor, csv_start=csv_start)
    _engine.build()
    _risk = RiskEngine(_engine, market)
    _benchmark_svc = BenchmarkService(_engine, market)


@app.get("/api/v1/status")
async def status():
    return {"has_data": _engine is not None}


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
        if entry_date > date.today():
            raise HTTPException(status_code=400, detail="Date cannot be in the future.")

    _manual_id_counter += 1
    record = ManualEntryRecord(
        id=_manual_id_counter,
        date=entry.date,
        symbol=entry.symbol.strip().upper(),
        side=entry.side,
        quantity=entry.quantity,
        price=entry.price,
        total_amount=round(entry.quantity * entry.price, 2),
        note=entry.note,
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
async def portfolio_summary(live: bool = Query(True)):
    engine = _require_engine()
    with live_prices_scope(live):
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
async def portfolio_holdings(live: bool = Query(True)):
    engine = _require_engine()
    with live_prices_scope(live):
        return engine.get_holdings()


@app.get(
    "/api/v1/portfolio/holdings/{symbol}/cost-ladder",
    response_model=CostBasisLadderResponse,
)
async def portfolio_cost_basis_ladder(symbol: str, live: bool = Query(True)):
    engine = _require_engine()
    try:
        with live_prices_scope(live):
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
):
    risk = _require_risk()
    return risk.get_drawdown_series(start, end)


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
async def portfolio_attribution(live: bool = Query(True)):
    engine = _require_engine()
    with live_prices_scope(live):
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
