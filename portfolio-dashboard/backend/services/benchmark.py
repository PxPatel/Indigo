import pandas as pd
import numpy as np
from datetime import date
from typing import Optional

from services.portfolio_engine import PortfolioEngine
from services.market_data import MarketDataService
from models.schemas import (
    BenchmarkCompareResponse,
    BenchmarkComparePoint,
    BenchmarkStats,
)
from utils.calculations import annualized_return, filter_date_range, TRADING_DAYS, wealth_series

_WEALTH_EPS = 1e-6

SUPPORTED_BENCHMARKS = {"SPY", "QQQ", "IWM", "DIA"}


def _flow_date_key(d: object) -> str:
    """Normalize fund transfer date to YYYY-MM-DD for dict keys and lookups.

    Must use strftime, not Timestamp.isoformat(): the latter includes time and
    would not match plain 'YYYY-MM-DD' keys from the API.
    """
    if isinstance(d, str):
        return d[:10]
    return pd.Timestamp(d).strftime("%Y-%m-%d")


def _coherent_external_flow(F: float, delta: float) -> float:
    """Cap F so we never subtract more external flow than appears in ΔW (timing safety).

    If a deposit is recorded on day t but wealth does not increase until t+1,
    raw (ΔW - F) can imply a ~-100% day and zero the compounded index. Deposits
    are capped by max(ΔW, 0); withdrawals by min(ΔW, 0).
    """
    if F > 0:
        return min(F, max(delta, 0.0))
    if F < 0:
        return max(F, min(delta, 0.0))
    return 0.0


def _external_flow_by_date(engine: PortfolioEngine) -> dict[str, float]:
    """Net external cash per calendar day: deposits positive, withdrawals negative."""
    out: dict[str, float] = {}
    for ft in engine.fund_transfers:
        key = _flow_date_key(ft["date"])
        amt = float(ft["amount"])
        delta = amt if ft["type"] == "DEPOSIT" else -amt
        out[key] = out.get(key, 0.0) + delta
    return out


def _flow_adjusted_returns(w: pd.Series, flows: dict[str, float]) -> pd.Series:
    """Daily returns where dW is reduced by external flows: r_t ≈ (ΔW - F_t) / W_{t-1}."""
    r = pd.Series(0.0, index=w.index, dtype=float)
    for i in range(1, len(w)):
        dt = w.index[i]
        w_prev = float(w.iloc[i - 1])
        w_curr = float(w.iloc[i])
        f_raw = flows.get(_flow_date_key(dt), 0.0)
        delta = w_curr - w_prev
        f_day = _coherent_external_flow(f_raw, delta)
        if abs(w_prev) >= _WEALTH_EPS:
            ri = (delta - f_day) / w_prev
        else:
            ri = 0.0
        if not np.isfinite(ri):
            ri = 0.0
        r.iloc[i] = float(np.clip(ri, -1.0, 1.0))
    return r


def _compound_return_index(r: pd.Series) -> pd.Series:
    """Cumulative return index starting at 100."""
    # Cap below -100% so one pathological day cannot zero the entire product forever.
    r_safe = r.clip(lower=-0.999, upper=10.0)
    return 100.0 * (1.0 + r_safe).cumprod()


class BenchmarkService:
    def __init__(self, engine: PortfolioEngine, market: MarketDataService):
        self.engine = engine
        self.market = market

    def compare(
        self, benchmark: str = "SPY", start: Optional[date] = None, end: Optional[date] = None
    ) -> BenchmarkCompareResponse:
        benchmark = benchmark.upper()
        if benchmark not in SUPPORTED_BENCHMARKS:
            benchmark = "SPY"

        s = start or self.engine.start_date
        e = end or self.engine.end_date

        bench_data = self.market.get_benchmark_data(benchmark, s, e)
        if bench_data.empty:
            return BenchmarkCompareResponse(
                series=[],
                stats=BenchmarkStats(
                    portfolio_total_return=0, benchmark_total_return=0,
                    portfolio_annualized=0, benchmark_annualized=0,
                    tracking_error=0, information_ratio=0,
                    up_capture=0, down_capture=0, correlation=0,
                ),
                benchmark_ticker=benchmark,
            )

        bench_close = bench_data["Close"]
        bench_close.index = pd.to_datetime(bench_close.index).tz_localize(None)

        port_values = wealth_series(self.engine.daily_values)

        # Align date ranges
        common_idx = port_values.index.intersection(bench_close.index)
        if len(common_idx) < 2:
            return BenchmarkCompareResponse(
                series=[],
                stats=BenchmarkStats(
                    portfolio_total_return=0, benchmark_total_return=0,
                    portfolio_annualized=0, benchmark_annualized=0,
                    tracking_error=0, information_ratio=0,
                    up_capture=0, down_capture=0, correlation=0,
                ),
                benchmark_ticker=benchmark,
            )

        pv = port_values.loc[common_idx]
        bv = bench_close.loc[common_idx]

        # Drop leading days with no meaningful wealth (cash-only / flat / net-short ok)
        eps = 1e-9
        nonzero_mask = np.abs(pv) > eps
        if nonzero_mask.any():
            first_valid = nonzero_mask.idxmax()
            pv = pv.loc[first_valid:]
            bv = bv.loc[first_valid:]
        if len(pv) < 2 or abs(float(pv.iloc[0])) < eps or abs(float(bv.iloc[0])) < eps:
            return BenchmarkCompareResponse(
                series=[],
                stats=BenchmarkStats(
                    portfolio_total_return=0, benchmark_total_return=0,
                    portfolio_annualized=0, benchmark_annualized=0,
                    tracking_error=0, information_ratio=0,
                    up_capture=0, down_capture=0, correlation=0,
                ),
                benchmark_ticker=benchmark,
            )

        flows = _external_flow_by_date(self.engine)
        # Base daily returns match TimeSeriesBuilder (guarded pct_change on wealth), not
        # a hand-rolled series on pv — avoids pathological -100% days when net_account
        # briefly hits ~0 while prev is large, and matches risk metrics everywhere.
        r_base = self.engine.daily_returns.reindex(pv.index, fill_value=0.0).fillna(0.0)
        if not self.engine.fund_transfers:
            r_use = r_base
        else:
            r_flow = _flow_adjusted_returns(pv, flows)
            flow_days = {_flow_date_key(ft["date"]) for ft in self.engine.fund_transfers}
            use_flow = np.array(
                [_flow_date_key(d) in flow_days for d in pv.index], dtype=bool
            )
            r_use = pd.Series(
                np.where(use_flow, r_flow.to_numpy(dtype=float), r_base.to_numpy(dtype=float)),
                index=pv.index,
            )
        port_index_series = _compound_return_index(r_use)
        bench_price_index = (bv / float(bv.iloc[0])) * 100.0

        port_indexed = filter_date_range(port_index_series, start, end)
        bench_indexed = filter_date_range(bench_price_index, start, end)

        series = []
        for dt in port_indexed.index:
            if dt in bench_indexed.index:
                pi = float(port_indexed.loc[dt])
                bi = float(bench_indexed.loc[dt])
                if np.isfinite(pi) and np.isfinite(bi):
                    series.append(BenchmarkComparePoint(
                        date=dt.strftime("%Y-%m-%d"),
                        portfolio_indexed=round(pi, 2),
                        benchmark_indexed=round(bi, 2),
                        relative=round(pi - bi, 2),
                    ))

        bench_ret = bv.pct_change()
        aligned = pd.DataFrame({"p": r_use, "b": bench_ret})
        aligned = aligned.iloc[1:].replace([np.inf, -np.inf], np.nan).dropna()
        if start is not None:
            aligned = aligned[aligned.index >= pd.Timestamp(start)]
        if end is not None:
            aligned = aligned[aligned.index <= pd.Timestamp(end)]

        # Period totals from filtered cumulative indices (matches chart window)
        if len(port_indexed) >= 2:
            port_total = float(port_indexed.iloc[-1] / port_indexed.iloc[0] - 1.0)
        else:
            port_total = 0.0
        if len(bench_indexed) >= 2:
            bench_total = float(bench_indexed.iloc[-1] / bench_indexed.iloc[0] - 1.0)
        else:
            bench_total = 0.0

        n_days_window = max(len(port_indexed) - 1, 1)
        port_ann = annualized_return(port_total, n_days_window)
        bench_ann = annualized_return(bench_total, n_days_window)

        if len(aligned) > 0:
            excess = aligned["p"] - aligned["b"]
            tracking_error = float(excess.std() * np.sqrt(TRADING_DAYS)) if len(excess) > 1 else 0.0
            up_days = aligned[aligned["b"] > 0]
            down_days = aligned[aligned["b"] < 0]
            up_capture = (
                float(up_days["p"].mean() / up_days["b"].mean() * 100)
                if len(up_days) > 0 and abs(up_days["b"].mean()) > 1e-12
                else 0.0
            )
            down_capture = (
                float(down_days["p"].mean() / down_days["b"].mean() * 100)
                if len(down_days) > 0 and abs(down_days["b"].mean()) > 1e-12
                else 0.0
            )
            corr = float(aligned["p"].corr(aligned["b"])) if len(aligned) > 5 else 0.0
        else:
            tracking_error = 0.0
            up_capture = 0.0
            down_capture = 0.0
            corr = 0.0

        info_ratio = (port_ann - bench_ann) / tracking_error if tracking_error > 0 else 0.0

        def safe(v: float) -> float:
            """Replace NaN/inf with 0 to prevent JSON serialization issues."""
            return 0.0 if not np.isfinite(v) else v

        stats = BenchmarkStats(
            portfolio_total_return=round(safe(port_total * 100), 2),
            benchmark_total_return=round(safe(bench_total * 100), 2),
            portfolio_annualized=round(safe(port_ann * 100), 2),
            benchmark_annualized=round(safe(bench_ann * 100), 2),
            tracking_error=round(safe(tracking_error * 100), 2),
            information_ratio=round(safe(info_ratio), 3),
            up_capture=round(safe(up_capture), 1),
            down_capture=round(safe(down_capture), 1),
            correlation=round(safe(corr), 3),
        )

        return BenchmarkCompareResponse(
            series=series, stats=stats, benchmark_ticker=benchmark
        )
