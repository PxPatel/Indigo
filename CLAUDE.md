# Portfolio Command Center (Valboard)

Bloomberg-style portfolio dashboard. Upload a Webull CSV → backend reconstructs history → frontend renders analytics across seven views. Personal tool, single user, no auth.

**Stack**: FastAPI + yfinance (backend), React + Vite + Recharts + Zustand + react-query (frontend). No paid APIs, no database, no deployment target.

## Critical Backend Patterns

**State lives in `main.py` module-level globals** (`_engine`, `_risk`, `_csv_transactions`, `_manual_entries`, `_fund_transfers`, `_cash_anchor`). Every mutation calls `_rebuild_engine()`, which merges CSV + manual entries, deduplicates, and rebuilds all derived services. Don't bypass this.

**`csv_start` anchors the engine start date** to the earliest CSV transaction. Manual entries must not predate it — extending the window backward fills returns with dead-period zeros and breaks all risk metrics. The validation is in the `/manual-entries` POST handler.

**yfinance is flaky.** All calls go through `market_data.py` (never call yfinance elsewhere). Wrap in try/except with one retry. Log failures and return partial data — missing one symbol must not crash the whole response.

**Cost basis**: average cost method throughout. Document clearly if ever changed.

**Returns**: always `(end / start) - 1`. Risk-free rate: **5%** everywhere.

## Financial Formulas
- **Sharpe**: `(annualized_return - 0.05) / annualized_vol`
- **Sortino**: same but denominator = downside deviation only
- **Beta**: `cov(portfolio, benchmark) / var(benchmark)`, rolling 60d
- **Alpha**: `portfolio_return - (0.05 + beta * (benchmark_return - 0.05))`
- **VaR 95%**: 5th percentile of daily returns × portfolio value
- **Annualize**: vol × `sqrt(252)`, return × `252`

## Frontend Rules
- All data fetching via react-query. No `useEffect` + `fetch`.
- All API calls through `src/api/client.ts`. One typed function per endpoint.
- Zustand (`portfolioStore`) for cross-view state only. `useState` for UI-only concerns.
- `isUploaded` persists to localStorage. On mount, the app pings `GET /status` to verify the backend still has data — if not, it resets. Don't remove this check.

## Styling Constraints
- Dark theme only. Colors via CSS custom properties in `src/styles/theme.css`.
- Green `#00dc82` / Red `#ff4757` for positive/negative values. Everywhere, always.
- Financial numbers in `JetBrains Mono`. Custom Recharts tooltips only — never the default.
- No component libraries (no MUI, no Chakra). Tailwind + hand-styled.
