"""
Daily portfolio return attribution.

Decomposes the portfolio-level move into per-holding contributions
(start-of-day weight × day return) and sector-level net contributions.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date

from models.schemas import (
    AttributionResponse,
    HoldingContribution,
    SectorContribution,
)
from services.price_provider import PriceProvider

logger = logging.getLogger(__name__)


class AttributionService:
    """Computes 'Why did my portfolio move today?' breakdown."""

    def __init__(self, engine, price_provider: PriceProvider) -> None:
        self._engine = engine
        self._provider = price_provider

    def compute(self, target_date: date | None = None) -> AttributionResponse:
        if target_date is None:
            target_date = date.today()

        # 1. Start-of-day weights = prior trading day's closing weights
        snap_date_str, weight_fractions = self._engine.get_snapshot_weights(target_date)

        # 2. Account wealth: net_account (equity MTM + implied cash) when built; else equity + timeline cash
        dv = self._engine.daily_values
        if not dv.empty:
            equity_value = float(dv["total"].iloc[-1])
            if "net_account" in dv.columns:
                total_account = float(dv["net_account"].iloc[-1])
                cash_balance = total_account - equity_value
            else:
                cash_balance = 0.0
                if self._engine.cash_anchor:
                    timeline = self._engine.get_cash_timeline()
                    if timeline:
                        cash_balance = max(0.0, timeline[-1]["cash_balance"])
                total_account = equity_value + cash_balance
        else:
            equity_value = 0.0
            cash_balance = 0.0
            total_account = 0.0
        cash_weight_pct = (cash_balance / total_account * 100) if total_account > 0 else 0.0

        # 3. Sector map
        sectors = self._engine.get_holding_sectors()

        # 4. Fetch today's returns for all held equities
        equity_symbols = [s for s, w in weight_fractions.items() if abs(w) > 0]
        actual_date, returns = self._provider.get_daily_returns(equity_symbols, target_date)

        # 5. Compute per-holding contributions
        contributors: list[HoldingContribution] = []
        sector_sums: dict[str, float] = defaultdict(float)
        portfolio_return = 0.0

        for symbol, weight_frac in weight_fractions.items():
            if abs(weight_frac) < 1e-12:
                continue
            # daily_weights are already account-level weights when cash is present.
            adj_weight_pct = weight_frac * 100
            ret_pct = returns.get(symbol, 0.0)
            # Contribution in percentage points: (weight / 100) × return
            contribution = (adj_weight_pct / 100) * ret_pct

            contributors.append(HoldingContribution(
                symbol=symbol,
                weight=round(adj_weight_pct, 2),
                asset_return=round(ret_pct, 2),
                contribution=round(contribution, 4),
            ))
            portfolio_return += contribution
            sector = sectors.get(symbol, "Unknown")
            sector_sums[sector] += contribution

        # Sort: largest positive contributors first
        contributors.sort(key=lambda x: x.contribution, reverse=True)

        sector_contributions = [
            SectorContribution(sector=s, contribution=round(c, 4))
            for s, c in sorted(sector_sums.items(), key=lambda kv: abs(kv[1]), reverse=True)
        ]
        top_sector = sector_contributions[0] if sector_contributions else None

        return AttributionResponse(
            date=actual_date.isoformat(),
            portfolio_return=round(portfolio_return, 4),
            contributors=contributors,
            cash_weight=round(cash_weight_pct, 2),
            cash_contribution=0.0,
            top_sector=top_sector,
            sector_contributions=sector_contributions,
            is_estimated=False,  # price_provider now uses fast_info; data is always current
            data_date=actual_date.isoformat(),
        )
