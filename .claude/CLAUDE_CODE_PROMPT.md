# Portfolio Command Center — Claude Code Build Prompt

## Project Overview

Build a **premium portfolio management dashboard** — a Bloomberg-terminal-inspired tool for retail investors. The app ingests a Webull CSV of transactions and transforms it into a rich, analytical experience with risk management, capital flow timelines, portfolio weight evolution, and benchmark comparisons.

**Stack:** Python backend (FastAPI) + React frontend (Vite + TypeScript)
**Data:** yfinance (free, no key required) for market data. No paid APIs.
**Theme:** Dark, sleek, information-dense — think Bloomberg Terminal meets a modern design system. Not generic fintech pastel. Serious, dense, but readable.

---

## Phase 1: Project Scaffolding

Create the following project structure:

```
portfolio-dashboard/
├── backend/
│   ├── main.py                  # FastAPI entry point
│   ├── requirements.txt
│   ├── services/
│   │   ├── csv_parser.py        # Webull CSV ingestion + normalization
│   │   ├── portfolio_engine.py  # Core portfolio state reconstruction
│   │   ├── market_data.py       # yfinance wrapper with caching
│   │   ├── risk_engine.py       # Risk metrics computation
│   │   └── benchmark.py         # Benchmark comparison logic
│   ├── models/
│   │   └── schemas.py           # Pydantic models for all API responses
│   └── utils/
│       └── calculations.py      # Shared financial math helpers
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── api/                 # API client layer
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Dashboard views
│   │   ├── hooks/               # Custom React hooks
│   │   ├── stores/              # State management (Zustand)
│   │   ├── utils/               # Frontend helpers
│   │   └── styles/              # Global styles + theme tokens
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
└── README.md
```

Initialize the backend with FastAPI and these dependencies in `requirements.txt`:
```
fastapi
uvicorn
yfinance
pandas
numpy
scipy
python-multipart
pydantic
```

Initialize the React frontend with Vite + TypeScript. Install:
```
recharts zustand @tanstack/react-query lucide-react tailwindcss framer-motion clsx date-fns
```

Set up Vite proxy to forward `/api/*` to the FastAPI backend on port 8000.

---

## Phase 2: Backend — CSV Parsing & Portfolio Engine

### 2A: Webull CSV Parser (`csv_parser.py`)

Parse a Webull transaction CSV. Webull CSVs typically contain these columns (handle variations):
- `Date`, `Symbol`, `Side` (Buy/Sell), `Qty`, `Price`, `Amount`, `Status` (Filled), `Type` (e.g., Market, Limit)

Normalize into a clean internal transaction model:
```python
class Transaction(BaseModel):
    date: datetime
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float
    total_amount: float  # quantity * price
    fees: float = 0.0
```

Filter only `Filled` transactions. Handle edge cases: fractional shares, stock splits if detectable, dividends if present. Sort chronologically.

### 2B: Portfolio Engine (`portfolio_engine.py`)

This is the core brain. Given a sorted list of transactions, reconstruct the **full portfolio state over time**:

1. **Daily Holdings Snapshot**: For every calendar day from first transaction to today, compute:
   - Shares held per symbol
   - Cost basis per symbol (use average cost method)
   - Cash deployed per symbol (cumulative buys minus cumulative sells)

2. **Daily Portfolio Valuation**: Using yfinance historical prices, compute:
   - Market value per holding per day
   - Total portfolio market value per day
   - Daily portfolio return (%) — both simple and log returns
   - Cumulative portfolio return from inception

3. **Portfolio Weights Over Time**: For each day, compute each holding's weight as a percentage of total portfolio value.

4. **Capital Flow Timeline**: For each transaction date, record:
   - Inflow (buy amount in USD)
   - Outflow (sell amount in USD)
   - Net flow
   - Cumulative net invested capital

5. **Realized vs Unrealized P&L**:
   - Realized: profit/loss from completed sell transactions (vs average cost basis at time of sale)
   - Unrealized: current market value minus cost basis for open positions

Expose these as structured endpoints.

### 2C: Market Data Service (`market_data.py`)

Wrapper around yfinance with in-memory caching (use a dict with TTL logic or `functools.lru_cache`):

- `get_historical_prices(symbol, start, end)` → DataFrame with OHLCV
- `get_current_price(symbol)` → float
- `get_benchmark_data(ticker, start, end)` → DataFrame (support SPY, QQQ, IWM, DIA)
- `get_stock_info(symbol)` → dict with name, sector, market cap, etc.

Batch requests where possible. Handle yfinance failures gracefully with retries (max 2).

### 2D: Risk Engine (`risk_engine.py`)

Compute the following portfolio-level risk metrics:

- **Volatility**: Annualized standard deviation of daily returns (rolling 30d and full history)
- **Sharpe Ratio**: (annualized return - risk free rate) / annualized volatility. Use 5.0% as risk-free rate proxy.
- **Sortino Ratio**: Like Sharpe but only downside deviation
- **Max Drawdown**: Largest peak-to-trough decline and its date range
- **Beta**: Portfolio beta vs selected benchmark (SPY default), using rolling 60-day window
- **Alpha**: Jensen's alpha = portfolio return - (risk_free + beta * (benchmark_return - risk_free))
- **Value at Risk (VaR)**: 95% confidence, 1-day, using historical simulation method
- **Correlation Matrix**: Pairwise correlation between all holdings using daily returns
- **Concentration Risk**: Herfindahl-Hirschman Index (HHI) of portfolio weights
- **Sector Exposure**: Aggregate weights by GICS sector (pull sector from yfinance stock info)

### 2E: Benchmark Service (`benchmark.py`)

- Normalize benchmark returns to the same start date as the portfolio
- Compute relative performance (portfolio return minus benchmark return) over time
- Compute rolling alpha and tracking error vs benchmark

---

## Phase 3: Backend API Endpoints

All endpoints under `/api/v1/`. Return JSON using Pydantic models.

```
POST   /api/v1/upload              — Upload Webull CSV, parse, return summary
GET    /api/v1/portfolio/summary    — Current holdings, values, total P&L
GET    /api/v1/portfolio/history    — Daily portfolio value time series
GET    /api/v1/portfolio/weights    — Portfolio weight evolution over time
GET    /api/v1/portfolio/holdings   — Detailed per-holding breakdown
GET    /api/v1/cashflow/timeline    — Capital inflows/outflows over time
GET    /api/v1/risk/metrics         — All risk metrics snapshot
GET    /api/v1/risk/drawdown        — Drawdown time series
GET    /api/v1/risk/correlation     — Correlation matrix data
GET    /api/v1/risk/sector          — Sector exposure breakdown
GET    /api/v1/benchmark/compare    — Portfolio vs benchmark comparison
                                      ?benchmark=SPY (default) | QQQ | IWM | DIA
GET    /api/v1/transactions         — All parsed transactions with filters
                                      ?symbol=AAPL&side=BUY&from=2023-01-01&to=2024-01-01
```

Use query parameters for date range filtering on all time-series endpoints: `?from=YYYY-MM-DD&to=YYYY-MM-DD`

---

## Phase 4: Frontend — Design System & Theme

### Design Direction

**Aesthetic**: Bloomberg Terminal modernized — information-dense, serious, dark. Think: matte black surfaces, sharp edges, monospace data, glowing accent colors on critical metrics. Not a consumer fintech app. A *command center*.

**Color Tokens** (CSS variables):
```css
--bg-primary: #0a0a0f;        /* Near-black base */
--bg-secondary: #12121a;      /* Card/panel surfaces */
--bg-tertiary: #1a1a28;       /* Elevated surfaces, hover states */
--border: #1e1e2e;            /* Subtle borders */
--border-active: #2a2a40;     /* Active/focused borders */

--text-primary: #e8e8ed;      /* Primary text — high contrast */
--text-secondary: #8888a0;    /* Labels, secondary info */
--text-muted: #555566;        /* Disabled, tertiary text */

--accent-green: #00dc82;      /* Positive / gains / bullish */
--accent-red: #ff4757;        /* Negative / losses / bearish */
--accent-blue: #3b82f6;       /* Interactive / links / primary actions */
--accent-amber: #f59e0b;      /* Warnings / alerts */
--accent-cyan: #06b6d4;       /* Benchmark / secondary charts */
--accent-purple: #8b5cf6;     /* Portfolio line / primary data */

--chart-grid: #1a1a28;        /* Chart gridlines — very subtle */
--chart-crosshair: #3a3a50;   /* Crosshair color */
```

**Typography**:
- Data / numbers: `"JetBrains Mono", "Fira Code", monospace` — financial data must feel precise
- Headings: `"DM Sans", "General Sans", sans-serif` — clean, modern, geometric
- Body / labels: `"Inter", "DM Sans", sans-serif`
- Load from Google Fonts

**Component Style Rules**:
- Cards: `bg-secondary` background, 1px `border` border, `border-radius: 6px`, no shadows (Bloomberg doesn't do drop shadows — it does borders and density)
- Hover states: border brightens to `border-active`, subtle background shift
- Metric displays: Large monospace numbers, small muted labels above, color-coded by positive/negative
- Charts: No chart backgrounds — transparent on card. Grid lines ultra-subtle. Thick data lines (2-3px). Glowing effect on hover via `filter: drop-shadow(0 0 6px var(--accent-green))`
- Tables: Alternating row backgrounds between `bg-secondary` and `bg-tertiary`. Monospace data cells.
- Scrollbars: Custom thin dark scrollbars matching theme
- Transitions: 150ms ease for hovers. 300ms for page transitions. Use Framer Motion for mount/unmount animations.

### Layout

Sidebar navigation (fixed left, ~220px wide, collapsible) + main content area.

Sidebar items:
1. **Overview** (home icon) — the main dashboard
2. **Holdings** (grid icon) — detailed table of all positions
3. **Cash Flow** (arrow-right-left icon) — inflow/outflow timeline
4. **Risk** (shield icon) — risk metrics and analysis
5. **Benchmark** (trending-up icon) — benchmark comparison
6. **Transactions** (list icon) — transaction log

Use `lucide-react` for icons. Active sidebar item has a left accent bar (3px wide, `accent-blue`) and brighter text.

---

## Phase 5: Frontend — Dashboard Views

### 5A: Overview Dashboard (Home)

This is the flagship view. Dense, informative, at-a-glance.

**Top Row — Key Metrics Bar** (horizontal strip, 5-6 metric cards):
- Total Portfolio Value (large, prominent)
- Total P&L ($ and %, color-coded green/red)
- Today's Change ($ and %, color-coded)
- Sharpe Ratio (number, muted label)
- Max Drawdown (% in red)
- Beta vs SPY

Each metric card: monospace number, small label above, subtle card background.

**Middle Row — Portfolio Value Chart** (takes ~60% width):
- Large area/line chart showing portfolio value over time
- Overlay benchmark (SPY) as a dashed line, normalized to same start value
- Tooltip on hover showing date, portfolio value, benchmark value, daily return
- Time range selector: 1W, 1M, 3M, 6M, YTD, 1Y, ALL (pill buttons)
- Crosshair that follows mouse

**Middle Row — Allocation Donut** (~40% width, beside the chart):
- Donut chart showing current portfolio allocation by holding
- Center text: number of holdings
- Legend below with symbol, weight %, current value
- On hover, segment expands slightly, center text updates to that holding's info

**Bottom Row — Two panels side by side**:

Left: **Recent Transactions** — last 10 transactions, compact table: Date | Symbol | Side (BUY green, SELL red badge) | Qty | Price | Amount

Right: **Top Movers** — holdings sorted by today's % change. Show symbol, change %, small sparkline (last 5 days). Top 3 gainers green, top 3 losers red.

### 5B: Holdings View

Full-width sortable data table of all current positions:

| Symbol | Name | Shares | Avg Cost | Current Price | Market Value | P&L ($) | P&L (%) | Weight (%) | Today (%) |
|--------|------|--------|----------|---------------|-------------|---------|---------|------------|-----------|

- Sortable by any column (click header)
- P&L columns color-coded green/red
- Click a row to expand inline detail: mini price chart (90d), cost basis visualization, transaction history for that symbol
- Search/filter bar at top
- Summary footer row: totals for Market Value, P&L, Weight

### 5C: Cash Flow Timeline View

**Primary Chart — Capital Flow Timeline**:
- Dual-axis or stacked bar chart:
  - Green bars (pointing up) = inflows (buys)
  - Red bars (pointing down) = outflows (sells)
  - Overlaid line: cumulative net invested capital
- X-axis: time (auto-scale based on data density — daily, weekly, or monthly buckets)
- Benchmark index price overlaid as a faint dashed line on a secondary y-axis (normalized)
- This shows the user WHEN they were putting money in/taking money out relative to market conditions

**Secondary Charts (below, two side-by-side)**:

Left: **Monthly Cash Flow Summary** — grouped bar chart, month by month, showing total inflows vs outflows per month

Right: **Cash Deployment by Symbol** — horizontal bar chart showing total capital deployed per symbol (net buys minus sells), sorted descending

**Stat Cards above charts**:
- Total Capital Deployed
- Total Capital Withdrawn
- Net Invested
- Largest Single Buy
- Largest Single Sell
- Average Transaction Size

### 5D: Risk Dashboard View

**Top Row — Risk Metric Cards** (similar to overview but more metrics):
- Sharpe Ratio | Sortino Ratio | Beta | Alpha | VaR (95%) | Max Drawdown | Volatility (annualized)

**Main Panel — Drawdown Chart**:
- Area chart (filled red/orange gradient, inverted) showing drawdown from peak over time
- Annotate the maximum drawdown period with start/end markers
- Horizontal dashed line at the max drawdown level

**Left Column Below**:
- **Rolling Volatility Chart**: 30-day rolling annualized volatility line chart
- **Rolling Beta Chart**: 60-day rolling beta vs benchmark

**Right Column Below**:
- **Correlation Heatmap**: Matrix of pairwise correlations between holdings. Use color scale from deep blue (-1) through gray (0) to deep red (+1). Monospace labels. Show correlation value on hover.
- **Sector Exposure**: Horizontal stacked bar or donut showing portfolio weight by GICS sector

### 5E: Benchmark Comparison View

**Benchmark Selector** (top, pill buttons): SPY | QQQ | IWM | DIA

**Primary Chart — Normalized Performance Comparison**:
- Both portfolio and benchmark indexed to 100 at portfolio start date
- Portfolio: solid line, `accent-purple`
- Benchmark: solid line, `accent-cyan`
- Fill the area between them: green when portfolio outperforms, red when underperforms
- Tooltip: date, portfolio value (indexed), benchmark value (indexed), spread

**Secondary Chart — Relative Performance (Alpha)**:
- Line chart of cumulative outperformance/underperformance vs benchmark
- Zero line prominent
- Green fill above zero, red fill below zero

**Stats Panel (sidebar or bottom)**:
- Portfolio Total Return vs Benchmark Total Return
- Portfolio Annualized Return vs Benchmark
- Tracking Error
- Information Ratio
- Up Capture / Down Capture ratios (what % of up days and down days does the portfolio capture vs benchmark)
- Correlation to benchmark

### 5F: Transactions Log View

Full searchable, filterable, sortable transaction table:

| Date | Symbol | Side | Type | Qty | Price | Total | Cumulative Invested |
|------|--------|------|------|-----|-------|-------|---------------------|

Filters:
- Date range picker
- Symbol dropdown (multi-select)
- Side: All / Buy / Sell
- Search box

Summary stats at top:
- Total Transactions | Total Buys | Total Sells | Avg Buy Size | Avg Sell Size | Most Traded Symbol

---

## Phase 6: Frontend — Interaction & Polish

### CSV Upload Flow
- On first load (no data), show a centered upload panel:
  - Drag-and-drop zone with dashed border animation
  - "Upload your Webull CSV" heading
  - "Drop your transaction export here" subtext
  - Browse button as fallback
  - While processing: skeleton loading state with shimmer animation on all dashboard panels
- After upload, data persists in Zustand store (in-memory for session). Show a small "Re-upload" button in the sidebar footer to replace data.

### State Management (Zustand)
- Store: `usePortfolioStore`
  - `transactions`, `holdings`, `portfolioHistory`, `riskMetrics`, `cashflows`, `benchmarkData`
  - `isLoading`, `error`, `uploadStatus`
  - `dateRange` filter (global)
  - `selectedBenchmark`
- Use `@tanstack/react-query` for API calls with caching and automatic refetching

### Responsive Behavior
- Primary target: desktop (1280px+)
- At smaller widths, stack grid columns vertically
- Sidebar collapses to icon-only mode below 1024px
- Charts maintain aspect ratio with `ResponsiveContainer` from Recharts

### Animations (Framer Motion)
- Page transitions: fade + slight Y-translate (20px)
- Cards: staggered mount animation (each card delays 50ms after previous)
- Numbers: count-up animation on first load for key metrics
- Chart lines: draw-in animation on mount

### Error States
- API errors: toast notification (bottom-right, auto-dismiss 5s)
- Empty states: illustrated placeholder with message
- Loading: skeleton screens matching card layout, shimmer effect

---

## Phase 7: Final Integration & Quality

### Backend CORS
Configure CORS in FastAPI to allow the Vite dev server origin.

### Data Flow
1. User uploads CSV → `POST /upload` → backend parses, fetches all historical prices via yfinance, computes all derived data, caches in memory
2. Frontend queries individual endpoints as each dashboard view loads
3. Benchmark data fetched on-demand when benchmark ticker changes

### Performance
- Backend: Cache yfinance calls aggressively. Pre-compute all derived data on upload rather than on each request.
- Frontend: Lazy-load views with `React.lazy` + `Suspense`. Memoize heavy chart computations with `useMemo`. Virtualize the transactions table if > 500 rows.

### README.md
Include:
- Project description
- Prerequisites (Python 3.11+, Node 18+)
- Setup instructions for backend (`pip install -r requirements.txt`, `uvicorn main:app --reload`)
- Setup instructions for frontend (`npm install`, `npm run dev`)
- How to export CSV from Webull
- Screenshots section (placeholder)

---

## Key Constraints & Reminders

- **No paid APIs.** yfinance is the data source. It's free and doesn't need a key. It can be flaky — add retry logic and graceful error handling.
- **All financial calculations must be correct.** Double-check return calculations, cost basis logic, and risk formulas. Use numpy/pandas vectorized operations, not Python loops, for performance.
- **Chart library: Recharts.** Use `ResponsiveContainer`, `ComposedChart`, `Area`, `Line`, `Bar`, `Tooltip`, `XAxis`, `YAxis`. Custom tooltip components for the Bloomberg feel.
- **Do not use any AI-generated placeholder data.** All data flows from the uploaded CSV through the backend.
- **Dark theme only.** No light mode toggle needed. Commit fully to the dark aesthetic.
- **Monospace numbers everywhere.** Every financial figure must render in the monospace font.
- **Color-code everything.** Green = positive, red = negative, everywhere, always. Use `accent-amber` for neutral/warning states.
- **Dense but not cluttered.** Bloomberg is dense because every pixel has purpose. Don't add whitespace padding everywhere like a consumer app. Tight spacing, clear hierarchy, borders over shadows.

---

## Stretch Goals (implement if time allows)

1. **Portfolio Weights Stacked Area Chart**: Show how portfolio composition has changed over time as a 100% stacked area chart (each band is a holding's weight)
2. **What-If Analysis**: "What if I had invested the same capital in SPY instead?" — show the comparison
3. **Tax Lot Tracking**: FIFO-based realized gains computation for tax reporting
4. **Export to PDF**: One-page portfolio summary report
5. **Keyboard Shortcuts**: `1-6` to switch views, `/` to focus search, `b` to toggle benchmark overlay