# Indigo

A local portfolio dashbaord that that goes beyond a holdings list. Indigo turns a Webull CSV export into a full picture of how your account behaves: performance, risk, cash, benchmarks, and trade activity in one high visibility, Bloomberg inspired interface. Built for a single user on your machine, with no paid data feeds and no database to configure.

**Stack:** FastAPI and yfinance on the backend, React, Vite, and Recharts on the frontend.

## Features

- **Overview:** Net performance over time, optional live spot refresh, allocation view, and benchmark overlay (for example SPY).
- **Holdings:** Sortable positions, search, unrealized P&L, and cost basis ladder views where applicable.
- **Cash flow:** Deposits, withdrawals, and how cash moves through the account narrative.
- **Risk:** Drawdown, rolling volatility and beta, VaR style metrics, correlation and sector views.
- **Benchmark:** Compare the portfolio to major ETFs (SPY, QQQ, IWM, DIA) with relative performance over time.
- **Simulator:** Rough what if shocks using benchmark betas (linear approximation, good for intuition).
- **Charts:** Per symbol price charts with your buys and sells on the timeline.
- **Transactions:** Full transaction history from the reconstructed ledger.
- **Import and adjustments:** Webull CSV upload plus manual entries and cash anchors so the engine matches reality.

## Quick start

**Prerequisites:** Python 3.11+ and Node 20+ recommended.

**1. Backend**

```bash
cd portfolio-dashboard/backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**2. Frontend** (new terminal)

```bash
cd portfolio-dashboard/frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The dev server proxies API calls to `http://localhost:8000`.

**Optional:** From the repo root, after the backend venv exists and frontend dependencies are installed:

```bash
chmod +x start.sh
./start.sh
```

That starts both processes in the background. Use Ctrl+C to stop.

## Using it

1. Start backend and frontend as above.
2. Open the app and upload your Webull export CSV on the import screen.
3. Explore the sidebar: Overview, Holdings, Cash Flow, Risk, Benchmark, Simulator, Charts, and Transactions.

Data stays in memory on the backend for your session. Restart the server and you will need to upload again unless you add persistence yourself.
