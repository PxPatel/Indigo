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

    def compute_metrics(self) -> RiskMetricsResponse:
        dr = self.engine.daily_returns
        dv = wealth_series(self.engine.daily_values)

        vol = annualized_volatility(dr)

        # 30-day rolling vol (latest value)
        if len(dr) >= 30:
            vol_30d = float(dr.tail(30).std() * np.sqrt(TRADING_DAYS))
        else:
            vol_30d = vol

        sr = sharpe_ratio(dr)
        sort = sortino_ratio(dr)
        md_val, md_start, md_end = max_drawdown(dv)

        spy_ret = self._get_spy_returns()
        b = beta_against(dr, spy_ret)

        # Annualized returns for alpha
        port_cum = float((1 + dr).prod() - 1)
        port_ann = annualized_return(port_cum, len(dr))

        bench_cum = float((1 + spy_ret).prod() - 1) if len(spy_ret) > 0 else 0
        bench_ann = annualized_return(bench_cum, len(spy_ret)) if len(spy_ret) > 0 else 0

        a = alpha_jensen(port_ann, bench_ann, b)
        var = value_at_risk_historical(dr)

        # HHI from current weights (absolute — includes shorts)
        weights = self.engine.daily_weights
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

    def get_drawdown_series(self, start: date | None = None, end: date | None = None) -> DrawdownResponse:
        dv = filter_date_range(wealth_series(self.engine.daily_values), start, end)

        eps = 1e-9
        running_max = dv.cummax()
        safe = running_max > eps
        dd = pd.Series(0.0, index=dv.index)
        if safe.any():
            dd.loc[safe] = ((dv - running_max) / running_max).loc[safe]
        dd = dd.replace([np.inf, -np.inf], np.nan).fillna(0).clip(-1.0, 0.0)

        md_val, md_start, md_end = max_drawdown(dv)

        series = [
            DrawdownPoint(date=dt.strftime("%Y-%m-%d"), drawdown=round(float(v) * 100, 2))
            for dt, v in dd.items()
        ]

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

    def get_correlation_matrix(self) -> CorrelationResponse:
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
