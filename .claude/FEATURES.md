# Valboard — Feature Reference

A Bloomberg-style portfolio dashboard for retail investors. Upload a Webull CSV and get a full analytics suite — no account, no API keys, no database.

---

## Data Ingestion

- **Webull CSV upload** — Drag-and-drop or file-select. Parses transaction history including stocks and options. Supports multiple CSVs uploaded at once (merged and de-duplicated).
- **Manual entry** — Add individual transactions (buy/sell, symbol, qty, price, date) that aren't in the CSV. Validated against the existing date range to prevent corrupting metrics.
- **Fund transfers** — Log deposits and withdrawals separately from trades. Feeds into the Cash Flow timeline and net invested calculations.
- **Cash balance anchor** — Set a known cash balance on any date. The system derives a full cash timeline by walking forward and backward through all trades and transfers from that anchor point.

All state is in-memory per session. Re-uploading or refreshing resets to blank.

---

## Dashboard Views

### Overview
High-level snapshot of the portfolio at a glance.

- **Metric cards** — Portfolio value, total P&L (unrealized + realized), today's change, Sharpe ratio, max drawdown, beta vs SPY, cash balance, net account value.
- **Portfolio value chart** — Time-series of total market value with SPY overlay. Time range selector: 1W, 1M, 3M, 6M, YTD, 1Y, ALL.
- **Allocation donut** — Pie chart of current holdings by market value with a legend.
- **Top movers** — Holdings sorted by today's price change %.
- **Recent transactions** — Last 10 fills from the uploaded data.

### Holdings
Position-level breakdown of all open holdings.

- **Sortable table** — Sort by symbol, shares, avg cost, price, market value, P&L ($), P&L (%), weight, or today's change.
- **Search** — Filter by symbol or company name.
- **Expandable rows** — Click any row to reveal sector, total cost basis, unrealized P&L, and last activity date.
- **Options badge** — OPT label on option positions; price shown as "—" since live option pricing is unavailable via yfinance.
- **Footer totals** — Aggregate market value, P&L, and weight.

### Cash Flow
Capital deployment history and flow analysis.

- **Capital Flow Timeline chart** — Bar chart of daily inflows (buys + deposits) and outflows (sells + withdrawals). Overlay lines for cumulative net invested, realized P&L, and cash balance (if anchor is set). Each overlay is individually toggleable.
- **Hover expansion** — Hovering on a bar for 0.5s expands the tooltip to show per-ticker buy/sell breakdown for that day.
- **Monthly Cash Flow** — Bar chart aggregating inflow and outflow by month.
- **Cash Deployed by Symbol** — Horizontal bar showing net capital committed per ticker (buys minus sells).
- **Metric cards** — Net invested, current cash, largest buy, largest sell, avg transaction size.

### Risk
Risk analytics computed from daily equity return series.

- **Metric cards** — Sharpe ratio, Sortino ratio, beta (vs SPY), alpha (Jensen's), VaR 95%, max drawdown, annualized volatility.
- **Drawdown chart** — Peak-to-trough drawdown over time with a dashed line at the maximum drawdown level.
- **Rolling 30-day volatility** — Annualized vol over a sliding window.
- **Rolling 60-day beta** — Beta vs SPY computed over a 60-day rolling window.
- **Correlation matrix** — Pairwise Pearson correlation of daily returns for all currently-held equities.
- **Sector exposure** — Portfolio weight broken out by GICS sector (sourced from yfinance).

### Benchmark
Side-by-side comparison against a market index.

- **Benchmark selector** — SPY, QQQ, IWM, DIA.
- **Normalized performance chart** — Both portfolio and benchmark indexed to 100 at the start, so total return is directly comparable.
- **Relative performance chart** — Cumulative outperformance/underperformance vs the benchmark over time, with shaded green (above) and red (below) regions.
- **Comparison stats grid** — Portfolio and benchmark total return, annualized return, tracking error, information ratio, up capture, down capture, and correlation.

### Transactions
Full filterable log of every trade.

- **Table** — Date, symbol, side, qty, price, total. Sortable on all columns.
- **Filters** — Search by symbol or date substring; filter to buys-only or sells-only.
- **Metric cards** — Total count, buy count, sell count, avg buy size, avg sell size, most-traded symbol.
- **Options badge** — OPT label on option rows.

---

## UX Details

- **Metric tooltips** — Hovering any metric card or column header for 1 second shows a plain-language explanation of what the metric is and how it's calculated.
- **Dark theme** — Single theme, all colors via CSS custom properties. Green for positive, red for negative, everywhere.
- **Monospace numbers** — All financial values render in JetBrains Mono.
- **Animations** — 150ms hover transitions, 300ms page transitions via Framer Motion.
- **Responsive charts** — All Recharts charts use ResponsiveContainer; no fixed pixel widths.
- **Custom tooltips** — No default Recharts white tooltips; all chart tooltips are custom-styled to match the theme.

---

## Formulas (Authoritative)

| Metric | Formula |
|---|---|
| Sharpe | `(annualized_return − 0.05) / annualized_vol` |
| Sortino | `(annualized_return − 0.05) / downside_deviation` where `downside_deviation = sqrt(mean(min(r,0)²) × 252)` |
| Beta | `cov(portfolio_returns, SPY_returns) / var(SPY_returns)` |
| Alpha | `portfolio_return − (0.05 + beta × (SPY_return − 0.05))` |
| VaR 95% | 5th percentile of historical daily returns |
| Max Drawdown | Largest peak-to-trough decline in cumulative portfolio value |
| HHI | Sum of squared portfolio weights (concentration measure) |
| Annualized vol | `daily_std × sqrt(252)` |
| Annualized return | `(1 + cumulative_return)^(252/N) − 1` |
| Cost basis | Average cost method |

Risk-free rate: **5%**. All annualization uses **252 trading days**.

---

## Backlog

### High Priority
1. **Time filters across views** — Extend the Overview date range selector (1W/1M/3M/6M/YTD/1Y/ALL) to Holdings, Cash Flow, Risk, and Benchmark tabs.
2. **Clarify cashflow stat labels** — "Total Deployed" / "Total Withdrawn" are ambiguous. Rename to something clearer (e.g. "Total Bought" / "Total Sold"). Needs decision.

### Medium Priority
3. **Wash sale / tax columns in Holdings** — Toggleable overlay columns: adjusted cost basis and carried disallowed wash sale loss. P&L column stays on nominal cost basis; tax columns are informational only.
4. **Transaction timestamps with timezone** — Show full fill time (not just date) per transaction, in the original timezone from the CSV (EST/EDT).

### Future
5. **Options P&L and exposure** — Partially implemented (options parsed and shown in holdings). Full options analytics — greeks, expiry P&L, exposure by underlying — not yet built.
6. **Holdings time travel** — Date picker to rewind holdings to any past date. Backend replays transactions up to that date, fetches closing prices, and returns the portfolio state as of that moment. Ephemeral UI state — resets on tab switch or reload. Implementation: `?as_of=YYYY-MM-DD` param on `GET /portfolio/holdings`.

### Done
- ~~Cashflow hover detail breakdown~~ — Ticker-level buy/sell breakdown on 0.5s hold.
- ~~Manual fund transfer entry~~ — Deposits/withdrawals via the Manual Entries modal.
- ~~Cash balance anchor~~ — Known balance on a date, full cash timeline derived from it.
