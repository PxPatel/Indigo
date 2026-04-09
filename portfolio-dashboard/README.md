# Indigo — Portfolio Command Center

A Bloomberg-terminal-inspired portfolio management dashboard for retail investors. Upload your Webull CSV transaction export and get rich analytics: risk metrics, capital flow timelines, portfolio weight evolution, and benchmark comparisons.

## Prerequisites

- Python 3.11+
- Node 18+

## Backend Setup

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The API runs on `http://localhost:8000`.

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/api/*` to the backend.

## How to Export CSV from Webull

1. Open the Webull app or website
2. Go to **Account** > **History** > **Orders**
3. Set the date range you want
4. Click **Export** (top-right) and save as CSV

## Architecture

- **Backend**: FastAPI + yfinance for market data, pandas/numpy for financial computations
- **Frontend**: React + TypeScript, Recharts for charts, Zustand for state, Tailwind CSS for styling
- **Theme**: Dark, information-dense Bloomberg Terminal aesthetic

## Screenshots

*Coming soon*
