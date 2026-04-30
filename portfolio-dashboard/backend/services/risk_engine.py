import pandas as pd
import numpy as np
from datetime import date
from typing import Optional

from services.portfolio_engine import PortfolioEngine
from services.market_data import MarketDataService
from models.schemas import (
    RiskMetricsResponse,
    DrawdownResponse,
    DrawdownPoint,
    DrawdownContributor,
    CorrelationResponse,
    SectorExposureResponse,
    SectorWeight,
)
from utils.calculations import (
    annualized_volatility,
    sharpe_ratio,
    sortino_ratio,
    max_drawdown,
    beta_against,
    alpha_jensen,
    value_at_risk_historical,
    herfindahl_index,
    annualized_return,
    filter_date_range,
    TRADING_DAYS,
    RISK_FREE_RATE,
    wealth_series,
)


class RiskEngine:
    def __init__(self, engine: PortfolioEngine, market: MarketDataService):
        self.engine = engine
        self.market = market
        self._spy_returns: Optional[pd.Series] = None

    def _get_spy_returns(self) -> pd.Series:
        if self._spy_returns is not None:
            return self._spy_returns
        spy = self.market.get_benchmark_data("SPY", self.engine.start_date, self.engine.end_date)
        if spy.empty:
            self._spy_returns = pd.Series(dtype=float)
            return self._spy_returns
        ret = spy["Close"].pct_change().dropna()
        ret.index = pd.to_datetime(ret.index).tz_localize(None)
        self._spy_returns = ret
        return self._spy_returns

    def compute_metrics(self, start: date | None = None, end: date | None = None) -> RiskMetricsResponse:
        dr = filter_date_range(self.engine.daily_returns, start, end)
        dv = filter_date_range(wealth_series(self.engine.daily_values), start, end)
        spy_ret = filter_date_range(self._get_spy_returns(), start, end)

        if len(dr) == 0 or len(dv) == 0:
            return RiskMetricsResponse(
                volatility_annualized=0.0,
                volatility_30d=0.0,
                sharpe_ratio=0.0,
                sortino_ratio=0.0,
                max_drawdown=0.0,
                max_drawdown_start=None,
                max_drawdown_end=None,
                beta=0.0,
                alpha=0.0,
                var_95=0.0,
                hhi=0.0,
            )

        vol = annualized_volatility(dr)

        # 30-day rolling vol (latest value within the selected window)
        if len(dr) >= 30:
            vol_30d = float(dr.tail(30).std() * np.sqrt(TRADING_DAYS))
        else:
            vol_30d = vol

        sr = sharpe_ratio(dr)
        sort = sortino_ratio(dr)
        md_val, md_start, md_end = max_drawdown(dv)

        b = beta_against(dr, spy_ret)

        # Annualized returns for alpha
        port_cum = float((1 + dr).prod() - 1)
        port_ann = annualized_return(port_cum, len(dr))

        bench_cum = float((1 + spy_ret).prod() - 1) if len(spy_ret) > 0 else 0
        bench_ann = annualized_return(bench_cum, len(spy_ret)) if len(spy_ret) > 0 else 0

        a = alpha_jensen(port_ann, bench_ann, b)
        var = value_at_risk_historical(dr)

        # HHI from last weights in range (absolute — includes shorts)
        weights = filter_date_range(self.engine.daily_weights, start, end)
        if not weights.empty:
            last_weights = weights.iloc[-1].values
            last_weights = last_weights[np.abs(last_weights) > 0.001]
            hhi = herfindahl_index(np.abs(last_weights).tolist())
        else:
            hhi = 0.0

        return RiskMetricsResponse(
            volatility_annualized=round(vol * 100, 2),
            volatility_30d=round(vol_30d * 100, 2),
            sharpe_ratio=round(sr, 3),
            sortino_ratio=round(sort, 3),
            max_drawdown=round(md_val * 100, 2),
            max_drawdown_start=md_start.strftime("%Y-%m-%d") if md_start is not None else None,
            max_drawdown_end=md_end.strftime("%Y-%m-%d") if md_end is not None else None,
            beta=round(b, 3),
            alpha=round(a * 100, 2),
            var_95=round(var * 100, 2),
            hhi=round(hhi, 4),
        )

    def _benchmark_drawdown_map(
        self,
        benchmark: str,
        start: date | None,
        end: date | None,
    ) -> dict[pd.Timestamp, float]:
        benchmark = benchmark.upper()
        if benchmark not in {"SPY", "QQQ", "IWM", "DIA"}:
            benchmark = "SPY"

        s = start or self.engine.start_date
        e = end or self.engine.end_date
        try:
            bench = self.market.get_benchmark_data(benchmark, s, e)
        except Exception:
            return {}
        if bench.empty or "Close" not in bench.columns:
            return {}

        close = bench["Close"].copy()
        close.index = pd.to_datetime(close.index).tz_localize(None)
        close = filter_date_range(close, start, end).dropna()
        if close.empty:
            return {}

        running_max = close.cummax()
        safe = running_max > 1e-9
        dd = pd.Series(0.0, index=close.index)
        dd.loc[safe] = ((close - running_max) / running_max).loc[safe]
        dd = dd.replace([np.inf, -np.inf], np.nan).fillna(0).clip(-1.0, 0.0)
        return {dt: round(float(v) * 100, 2) for dt, v in dd.items()}

    def _trade_flows_by_symbol(
        self,
        peak_dt: pd.Timestamp,
        current_dt: pd.Timestamp,
    ) -> tuple[dict[str, float], dict[str, float]]:
        buys: dict[str, float] = {}
        sells: dict[str, float] = {}
        txns = getattr(self.engine, "_accounting_transactions", None) or getattr(
            self.engine, "transactions", []
        )

        peak_day = peak_dt.date()
        current_day = current_dt.date()
        for t in txns:
            t_day = t.date.date()
            if t_day <= peak_day or t_day > current_day:
                continue
            amount = float(t.total_amount)
            if t.side == "BUY":
                buys[t.symbol] = buys.get(t.symbol, 0.0) + amount
            elif t.side == "SELL":
                sells[t.symbol] = sells.get(t.symbol, 0.0) + amount
        return buys, sells

    def _drawdown_anatomy(
        self,
        values: pd.DataFrame,
        peak_dt: pd.Timestamp,
        current_dt: pd.Timestamp,
        peak_wealth: float,
        current_wealth: float,
    ) -> tuple[list[DrawdownContributor], DrawdownContributor | None]:
        if peak_wealth <= 1e-9 or current_dt == peak_dt or current_wealth >= peak_wealth:
            return [], None

        excluded = {"total", "cash", "net_account", "equity_cost_basis"}
        symbol_cols = [c for c in values.columns if c not in excluded]
        buys, sells = self._trade_flows_by_symbol(peak_dt, current_dt)

        contributors: list[DrawdownContributor] = []
        total_symbol_impact = 0.0
        for symbol in sorted(symbol_cols):
            mv_peak = float(values.at[peak_dt, symbol]) if symbol in values.columns else 0.0
            mv_current = float(values.at[current_dt, symbol]) if symbol in values.columns else 0.0
            impact = mv_current - mv_peak - buys.get(symbol, 0.0) + sells.get(symbol, 0.0)
            if abs(impact) < 0.005:
                continue
            total_symbol_impact += impact
            contributors.append(
                DrawdownContributor(
                    symbol=symbol,
                    impact_dollars=round(impact, 2),
                    impact_percent=round((impact / peak_wealth) * 100, 4),
                    kind="holding",
                )
            )

        contributors.sort(key=lambda c: abs(c.impact_percent), reverse=True)

        residual = (current_wealth - peak_wealth) - total_symbol_impact
        if abs(residual) < 0.005:
            return contributors, None

        uses_cash_anchor = "net_account" in values.columns
        return contributors, DrawdownContributor(
            symbol="Cash / external flow" if uses_cash_anchor else "Trading flow / cash not modeled",
            impact_dollars=round(residual, 2),
            impact_percent=round((residual / peak_wealth) * 100, 4),
            kind="cash_flow" if uses_cash_anchor else "other",
        )

    def get_drawdown_series(
        self,
        start: date | None = None,
        end: date | None = None,
        benchmark: str = "SPY",
    ) -> DrawdownResponse:
        dv = filter_date_range(wealth_series(self.engine.daily_values), start, end)

        eps = 1e-9
        running_max = dv.cummax()
        safe = running_max > eps
        dd = pd.Series(0.0, index=dv.index)
        if safe.any():
            dd.loc[safe] = ((dv - running_max) / running_max).loc[safe]
        dd = dd.replace([np.inf, -np.inf], np.nan).fillna(0).clip(-1.0, 0.0)

        md_val, md_start, md_end = max_drawdown(dv)

        values = filter_date_range(self.engine.daily_values, start, end)
        benchmark_dd = self._benchmark_drawdown_map(benchmark, start, end)
        uses_cash_anchor = "net_account" in self.engine.daily_values.columns

        series = []
        for dt, v in dd.items():
            peak_dt = dv.loc[:dt].idxmax() if running_max.loc[dt] > eps else None
            contributors: list[DrawdownContributor] = []
            residual = None
            peak_value = None
            current_value = float(dv.loc[dt])
            if peak_dt is not None:
                peak_value = float(dv.loc[peak_dt])
                contributors, residual = self._drawdown_anatomy(
                    values,
                    peak_dt,
                    dt,
                    peak_value,
                    current_value,
                )

            series.append(DrawdownPoint(
                date=dt.strftime("%Y-%m-%d"),
                drawdown=round(float(v) * 100, 2),
                benchmark_drawdown=benchmark_dd.get(dt),
                peak_date=peak_dt.strftime("%Y-%m-%d") if peak_dt is not None else None,
                peak_value=round(peak_value, 2) if peak_value is not None else None,
                current_value=round(current_value, 2),
                contributors=contributors,
                cash_or_flow_contribution=residual,
                uses_cash_anchor=uses_cash_anchor,
            ))

        # Rolling volatility (30d)
        dr = filter_date_range(self.engine.daily_returns, start, end)

        roll_vol = dr.rolling(30, min_periods=15).std() * np.sqrt(TRADING_DAYS)
        rolling_vol = [
            {"date": dt.strftime("%Y-%m-%d"), "value": round(float(v) * 100, 2)}
            for dt, v in roll_vol.dropna().items()
        ]

        # Rolling beta (60d)
        spy_ret = self._get_spy_returns()
        aligned = pd.DataFrame({"p": dr, "b": spy_ret}).dropna()
        if len(aligned) >= 60:
            cov_roll = aligned["p"].rolling(60, min_periods=30).cov(aligned["b"])
            var_roll = aligned["b"].rolling(60, min_periods=30).var()
            beta_roll = (cov_roll / var_roll).dropna()
            rolling_b = [
                {"date": dt.strftime("%Y-%m-%d"), "value": round(float(v), 3)}
                for dt, v in beta_roll.items()
            ]
        else:
            rolling_b = []

        return DrawdownResponse(
            series=series,
            max_drawdown=round(md_val * 100, 2),
            max_drawdown_start=md_start.strftime("%Y-%m-%d") if md_start is not None else None,
            max_drawdown_end=md_end.strftime("%Y-%m-%d") if md_end is not None else None,
            rolling_volatility=rolling_vol,
            rolling_beta=rolling_b,
        )

    def get_correlation_matrix(self, start: date | None = None, end: date | None = None) -> CorrelationResponse:
        # Only correlate current holdings, not all symbols ever traded
        symbols = sorted(s for s, qty in self.engine._shares_held.items() if qty != 0)
        if len(symbols) < 2:
            return CorrelationResponse(symbols=symbols, matrix=[[1.0]] if symbols else [])

        returns_df = pd.DataFrame()
        for symbol in symbols:
            if symbol in self.engine._prices:
                s = self.engine._prices[symbol][symbol].pct_change().dropna()
                returns_df[symbol] = s

        if returns_df.empty or len(returns_df.columns) < 2:
            return CorrelationResponse(symbols=symbols, matrix=[[1.0] * len(symbols)] * len(symbols))

        returns_df = filter_date_range(returns_df, start, end)
        if len(returns_df) < 2:
            return CorrelationResponse(symbols=symbols, matrix=[[1.0] * len(symbols)] * len(symbols))

        corr = returns_df.corr().fillna(0)
        matrix = [[round(float(corr.loc[a, b]), 3) for b in corr.columns] for a in corr.index]

        return CorrelationResponse(symbols=list(corr.columns), matrix=matrix)

    def get_sector_exposure(self) -> SectorExposureResponse:
        sector_weights: dict[str, float] = {}
        holdings = self.engine.get_holdings().holdings

        for h in holdings:
            sector = h.sector if h.sector != "Unknown" else "Other"
            sector_weights[sector] = sector_weights.get(sector, 0) + h.weight

        sectors = sorted(
            [SectorWeight(sector=s, weight=round(w, 2)) for s, w in sector_weights.items()],
            key=lambda x: x.weight,
            reverse=True,
        )
        return SectorExposureResponse(sectors=sectors)
