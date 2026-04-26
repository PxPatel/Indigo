from pydantic import BaseModel
from typing import Literal, Optional
from datetime import datetime

PriceRefreshMode = Literal["live", "slow", "off"]


class Transaction(BaseModel):
    date: datetime
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float
    total_amount: float
    fees: float = 0.0
    instrument_type: Literal["stock", "option"] = "stock"


class UploadResponse(BaseModel):
    transaction_count: int
    symbols: list[str]
    date_range_start: str
    date_range_end: str
    total_invested: float


class HoldingDetail(BaseModel):
    symbol: str
    name: str
    shares: float
    avg_cost: float
    current_price: float
    market_value: float
    cost_basis: float
    pnl_dollars: float
    pnl_percent: float
    weight: float
    today_change_percent: float
    sector: str
    last_activity: str
    instrument_type: str


class PortfolioSummary(BaseModel):
    total_value: float
    total_cost_basis: float
    total_pnl_dollars: float
    total_pnl_percent: float
    today_change_dollars: float
    today_change_percent: float
    sharpe_ratio: float
    max_drawdown: float
    beta: float
    holdings_count: int
    total_invested: float
    realized_pnl: float
    unrealized_pnl: float
    cash_balance: Optional[float]       # None when no anchor set
    net_account_value: Optional[float]  # market value + cash
    live_prices_enabled: bool = True
    price_refresh_mode: PriceRefreshMode = "live"
    current_price_ttl_seconds: int = 60
    current_prices_cached_at: Optional[str] = None  # ISO-8601 UTC; oldest cur_* cache write in this summary


class PortfolioHistoryPoint(BaseModel):
    date: str
    value: float
    daily_return: float
    cumulative_return: float
    net_account_value: Optional[float] = None  # equity MTM + implied cash when anchor set
    equity_cost_basis: float = 0.0
    equity_unrealized_pnl: float = 0.0
    # EOD cumulative realized (closed trades); unrealized + this = total trading P&L
    cumulative_realized_pnl: float = 0.0
    equity_total_pnl: float = 0.0
    cash_balance: Optional[float] = None  # implied cash when cash anchor path; else None


class PortfolioHistoryResponse(BaseModel):
    history: list[PortfolioHistoryPoint]


class WeightPoint(BaseModel):
    date: str
    weights: dict[str, float]


class PortfolioWeightsResponse(BaseModel):
    weights: list[WeightPoint]
    symbols: list[str]


class HoldingsResponse(BaseModel):
    holdings: list[HoldingDetail]
    total_market_value: float
    total_pnl_dollars: float
    total_pnl_percent: float
    as_of: Optional[str] = None
    earliest_date: Optional[str] = None


class CostBasisMergedLevel(BaseModel):
    price: float
    shares: float
    date_start: str
    date_end: str


class FifoLotRow(BaseModel):
    date: str
    price: float
    shares: float
    current_value: float
    pnl_dollars: float
    pnl_percent: float


class CostBasisLadderResponse(BaseModel):
    symbol: str
    name: str
    current_price: float
    today_change_percent: float
    today_change_dollars: float
    unrealized_pnl_dollars: float
    unrealized_pnl_percent: float
    avg_days_between_buys: Optional[float]
    avg_interval_between_lot_prices: Optional[float]
    open_lot_count: int
    lots: list[FifoLotRow]
    merged_levels: list[CostBasisMergedLevel]
    as_of: Optional[str] = None
    ladder_intro: str = (
        "Each bar is open shares still held at a buy price after applying sells in FIFO order. "
    )
    footnote: str = "Partial closes applied FIFO. Lot-level close data not available from CSV."


class CashflowTrade(BaseModel):
    symbol: str
    side: Literal["BUY", "SELL"]
    amount: float


class CashflowPoint(BaseModel):
    date: str
    inflow: float
    outflow: float
    net_flow: float
    cumulative_invested: float
    cumulative_realized_pnl: float = 0.0
    trades: list[CashflowTrade] = []


class MonthlyCashflow(BaseModel):
    month: str
    inflow: float
    outflow: float


class SymbolDeployment(BaseModel):
    symbol: str
    net_deployed: float


class CashflowStats(BaseModel):
    total_deployed: float
    total_withdrawn: float
    net_invested: float
    largest_buy: float
    largest_sell: float
    avg_transaction_size: float


class CashflowTimelineResponse(BaseModel):
    timeline: list[CashflowPoint]
    monthly: list[MonthlyCashflow]
    by_symbol: list[SymbolDeployment]
    stats: CashflowStats


class RiskMetricsResponse(BaseModel):
    volatility_annualized: float
    volatility_30d: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    max_drawdown_start: Optional[str]
    max_drawdown_end: Optional[str]
    beta: float
    alpha: float
    var_95: float
    hhi: float


class DrawdownPoint(BaseModel):
    date: str
    drawdown: float


class DrawdownResponse(BaseModel):
    series: list[DrawdownPoint]
    max_drawdown: float
    max_drawdown_start: Optional[str]
    max_drawdown_end: Optional[str]
    rolling_volatility: list[dict]
    rolling_beta: list[dict]


class CorrelationResponse(BaseModel):
    symbols: list[str]
    matrix: list[list[float]]


class SectorWeight(BaseModel):
    sector: str
    weight: float


class SectorExposureResponse(BaseModel):
    sectors: list[SectorWeight]


class BenchmarkComparePoint(BaseModel):
    date: str
    portfolio_indexed: float
    benchmark_indexed: float
    relative: float


class BenchmarkStats(BaseModel):
    portfolio_total_return: float
    benchmark_total_return: float
    portfolio_annualized: float
    benchmark_annualized: float
    tracking_error: float
    information_ratio: float
    up_capture: float
    down_capture: float
    correlation: float


class BenchmarkCompareResponse(BaseModel):
    series: list[BenchmarkComparePoint]
    stats: BenchmarkStats
    benchmark_ticker: str


class SimulatorHolding(BaseModel):
    symbol: str
    instrument_type: str  # 'stock' | 'option'
    market_value: float
    current_price: float
    beta_1yr: Optional[float]  # None if excluded
    excluded: bool
    exclusion_reason: Optional[str]  # 'option' | 'no_beta' | None


class SimulatorResponse(BaseModel):
    holdings: list[SimulatorHolding]
    total_market_value: float
    benchmark: str


class TransactionRecord(BaseModel):
    date: str
    symbol: str
    side: str
    type: str
    quantity: float
    price: float
    total: float
    cumulative_invested: float
    instrument_type: str


class TransactionStats(BaseModel):
    total_count: int
    buy_count: int
    sell_count: int
    avg_buy_size: float
    avg_sell_size: float
    most_traded_symbol: str


class TransactionsResponse(BaseModel):
    transactions: list[TransactionRecord]
    stats: TransactionStats


class ManualEntryRequest(BaseModel):
    date: str  # YYYY-MM-DD
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float
    note: str = ""


class ManualEntryRecord(BaseModel):
    id: int
    date: str
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float
    total_amount: float
    note: str


class ManualEntriesResponse(BaseModel):
    entries: list[ManualEntryRecord]
    count: int


class FundTransferRequest(BaseModel):
    date: str  # YYYY-MM-DD
    type: Literal["DEPOSIT", "WITHDRAWAL"]
    amount: float
    note: str = ""


class FundTransferRecord(BaseModel):
    id: int
    date: str
    type: Literal["DEPOSIT", "WITHDRAWAL"]
    amount: float
    note: str


class FundTransfersResponse(BaseModel):
    transfers: list[FundTransferRecord]
    count: int


class CashAnchorRequest(BaseModel):
    date: str  # YYYY-MM-DD
    balance: float  # closing cash balance on that day


class CashAnchorResponse(BaseModel):
    anchor: CashAnchorRequest | None
    cash_timeline: list[dict]  # [{date, cash_balance}]


class OHLCVPoint(BaseModel):
    date: str
    """Session calendar day (YYYY-MM-DD)."""
    time: Optional[int] = None
    """Unix timestamp UTC seconds — set for intraday bars; daily charts use `date` only."""
    open: float
    high: float
    low: float
    close: float
    volume: float


class ClusteredTrade(BaseModel):
    date: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float            # weighted-average fill price for the cluster
    total_amount: float
    count: int              # number of individual fills in this cluster
    individual_trades: list[dict]
    unrealized_pnl: Optional[float]  # open buy positions, vs current price
    realized_pnl: Optional[float]    # sell trades only


class RoundTrip(BaseModel):
    buy_date: str
    sell_date: str
    buy_price: float
    sell_price: float
    quantity: float
    realized_pnl: float


class SymbolChartResponse(BaseModel):
    symbol: str
    ohlcv: list[OHLCVPoint]
    trades: list[ClusteredTrade]
    round_trips: list[RoundTrip]
    current_price: float
    shares_held: float
    avg_cost: float
    has_trade_data: bool   # False when symbol has no transactions in the portfolio


class HoldingContribution(BaseModel):
    symbol: str
    weight: float        # % of total account (0–100 scale)
    asset_return: float  # day's percentage return (e.g. +1.5 = +1.5%)
    contribution: float  # percentage-point contribution to portfolio return


class SectorContribution(BaseModel):
    sector: str
    contribution: float  # net percentage-point contribution


class AttributionResponse(BaseModel):
    date: str                               # trading date data corresponds to
    portfolio_return: float                 # sum of all holding contributions
    contributors: list[HoldingContribution]
    cash_weight: float                      # uninvested cash as % of total account
    cash_contribution: float               # always 0.0 — cash earns nothing
    top_sector: Optional[SectorContribution]
    sector_contributions: list[SectorContribution]
    is_estimated: bool   # True when today has no data and we fell back to a prior date
    data_date: str       # actual date data was pulled for
