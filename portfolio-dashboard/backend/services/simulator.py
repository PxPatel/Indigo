import logging
from datetime import date, timedelta
from typing import Optional

import pandas as pd

from models.schemas import SimulatorHolding, SimulatorResponse
from services.portfolio_engine import PortfolioEngine
from services.market_data import MarketDataService
from services.debug_context import today as debug_today

logger = logging.getLogger(__name__)

# Minimum overlapping data points required to produce a valid beta.
_MIN_BETA_PERIODS = 60

SUPPORTED_BENCHMARKS = {"SPY", "QQQ", "IWM", "DIA"}


class SimulatorService:
    def __init__(self, engine: PortfolioEngine, market: MarketDataService):
        self.engine = engine
        self.market = market

    def get_holdings(self, benchmark: str) -> SimulatorResponse:
        if benchmark not in SUPPORTED_BENCHMARKS:
            benchmark = "SPY"

        holdings_resp = self.engine.get_holdings()
        total_mv = holdings_resp.total_market_value

        end = debug_today()
        start = end - timedelta(days=365)

        # Fetch benchmark returns once; log and continue if unavailable.
        bench_df = self.market.get_benchmark_data(benchmark, start, end)
        if bench_df.empty:
            logger.warning("SimulatorService: could not fetch benchmark data for %s", benchmark)
            bench_ret: Optional[pd.Series] = None
        else:
            br = bench_df["Close"].pct_change().dropna()
            br.index = pd.to_datetime(br.index).tz_localize(None)
            bench_ret = br

        result: list[SimulatorHolding] = []

        for h in holdings_resp.holdings:
            if h.instrument_type == "option":
                result.append(SimulatorHolding(
                    symbol=h.symbol,
                    instrument_type="option",
                    market_value=h.market_value,
                    current_price=h.current_price,
                    beta_1yr=None,
                    excluded=True,
                    exclusion_reason="option",
                ))
                continue

            # Equity holding — try to compute 1-year beta
            if bench_ret is None:
                result.append(SimulatorHolding(
                    symbol=h.symbol,
                    instrument_type="stock",
                    market_value=h.market_value,
                    current_price=h.current_price,
                    beta_1yr=None,
                    excluded=True,
                    exclusion_reason="no_beta",
                ))
                continue

            try:
                sym_df = self.market.get_historical_prices(h.symbol, start, end)
            except Exception:
                sym_df = pd.DataFrame()

            if sym_df.empty or "Close" not in sym_df.columns:
                result.append(SimulatorHolding(
                    symbol=h.symbol,
                    instrument_type="stock",
                    market_value=h.market_value,
                    current_price=h.current_price,
                    beta_1yr=None,
                    excluded=True,
                    exclusion_reason="no_beta",
                ))
                continue

            sym_ret = sym_df["Close"].pct_change().dropna()
            sym_ret.index = pd.to_datetime(sym_ret.index).tz_localize(None)

            aligned = pd.DataFrame({"s": sym_ret, "b": bench_ret}).dropna()
            if len(aligned) < _MIN_BETA_PERIODS:
                result.append(SimulatorHolding(
                    symbol=h.symbol,
                    instrument_type="stock",
                    market_value=h.market_value,
                    current_price=h.current_price,
                    beta_1yr=None,
                    excluded=True,
                    exclusion_reason="no_beta",
                ))
                continue

            var = float(aligned["b"].var())
            if var == 0:
                beta = 0.0
            else:
                beta = round(float(aligned["s"].cov(aligned["b"])) / var, 3)

            result.append(SimulatorHolding(
                symbol=h.symbol,
                instrument_type="stock",
                market_value=h.market_value,
                current_price=h.current_price,
                beta_1yr=beta,
                excluded=False,
                exclusion_reason=None,
            ))

        return SimulatorResponse(
            holdings=result,
            total_market_value=total_mv,
            benchmark=benchmark,
        )
