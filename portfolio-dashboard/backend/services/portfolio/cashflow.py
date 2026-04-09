"""
CashflowService — cashflow timeline and cash balance timeline.

Extracted from PortfolioEngine.get_cashflow_timeline() and get_cash_timeline().
All calculation logic is preserved exactly from the original methods.
"""

from collections import defaultdict
from datetime import date

from models.schemas import (
    Transaction,
    CashflowTimelineResponse,
    CashflowPoint,
    CashflowTrade,
    MonthlyCashflow,
    SymbolDeployment,
    CashflowStats,
)


class CashflowService:
    """Builds the cashflow timeline and cash balance timeline."""

    def __init__(
        self,
        processed_transactions: list[Transaction],
        original_transactions: list[Transaction],
        daily_cumulative_realized: dict[str, float],
        fund_transfers: list[dict],
        start_date: date,
        end_date: date,
        cash_anchor: dict | None,
    ) -> None:
        # processed_transactions: includes synthetic option-expiry closings (price=0, total=0)
        # original_transactions: user-visible trades only (no synthetics), used for stats
        self._processed = processed_transactions
        self._original = original_transactions
        self._daily_realized = daily_cumulative_realized
        self._fund_transfers = fund_transfers
        self._start_date = start_date
        self._end_date = end_date
        self._cash_anchor = cash_anchor

    def get_timeline(self, start: date | None = None, end: date | None = None) -> CashflowTimelineResponse:
        """Build the full cashflow timeline response with daily points, monthly rollups, and stats."""
        # Build per-date inflow/outflow from transactions + fund transfers.
        # Synthetic option-expiry entries (total_amount=0) contribute 0 to dollar flows
        # but correctly create date entries in the timeline.
        daily_flows: dict[str, dict] = {}
        daily_trades: dict[str, dict[tuple[str, str], float]] = {}

        for t in self._processed:
            d = t.date.date().isoformat()
            if d not in daily_flows:
                daily_flows[d] = {"inflow": 0, "outflow": 0, "deposit": 0, "withdrawal": 0}
            if t.side == "BUY":
                daily_flows[d]["inflow"] += t.total_amount
            else:
                daily_flows[d]["outflow"] += t.total_amount

            # Aggregate same-day same-ticker same-side amounts for the hover tooltip
            if d not in daily_trades:
                daily_trades[d] = {}
            key = (t.symbol, t.side)
            daily_trades[d][key] = daily_trades[d].get(key, 0.0) + t.total_amount

        for ft in self._fund_transfers:
            d = ft["date"]
            if d not in daily_flows:
                daily_flows[d] = {"inflow": 0, "outflow": 0, "deposit": 0, "withdrawal": 0}
            if ft["type"] == "DEPOSIT":
                daily_flows[d]["deposit"] += ft["amount"]
            else:
                daily_flows[d]["withdrawal"] += ft["amount"]

        # Build the timeline. cumulative tracks net invested (BUY outlays - SELL proceeds - withdrawals + deposits).
        # last_realized carries forward the last known cumulative realized P&L for dates without transactions.
        timeline = []
        cumulative = 0.0
        last_realized = 0.0
        for d in sorted(daily_flows.keys()):
            f = daily_flows[d]
            dt = date.fromisoformat(d)
            total_in = f["inflow"] + f["deposit"]
            total_out = f["outflow"] + f["withdrawal"]
            cumulative += total_in - total_out
            last_realized = self._daily_realized.get(d, last_realized)
            if start and dt < start:
                continue
            if end and dt > end:
                continue
            day_trades = daily_trades.get(d, {})
            trades = sorted(
                [
                    CashflowTrade(symbol=sym, side=side, amount=round(amt, 2))
                    for (sym, side), amt in day_trades.items()
                ],
                key=lambda x: (x.side != "BUY", x.symbol),
            )
            timeline.append(CashflowPoint(
                date=d,
                inflow=round(total_in, 2),
                outflow=round(total_out, 2),
                net_flow=round(total_in - total_out, 2),
                cumulative_invested=round(cumulative, 2),
                cumulative_realized_pnl=round(last_realized, 2),
                trades=trades,
            ))

        # Monthly aggregation (uses processed so option-expiry dates appear in correct month).
        # The 0-amount synthetic entries don't affect dollar totals.
        monthly: dict[str, dict] = {}
        for t in self._processed:
            m = t.date.strftime("%Y-%m")
            if m not in monthly:
                monthly[m] = {"inflow": 0, "outflow": 0}
            if t.side == "BUY":
                monthly[m]["inflow"] += t.total_amount
            else:
                monthly[m]["outflow"] += t.total_amount

        for ft in self._fund_transfers:
            m = ft["date"][:7]  # YYYY-MM
            if m not in monthly:
                monthly[m] = {"inflow": 0, "outflow": 0}
            if ft["type"] == "DEPOSIT":
                monthly[m]["inflow"] += ft["amount"]
            else:
                monthly[m]["outflow"] += ft["amount"]

        monthly_list = [
            MonthlyCashflow(month=m, inflow=round(v["inflow"], 2), outflow=round(v["outflow"], 2))
            for m, v in sorted(monthly.items())
        ]

        # Per-symbol net deployed uses original_transactions (no synthetics) so that
        # expired options don't skew user-visible per-symbol figures.
        symbol_flows: dict[str, float] = defaultdict(float)
        for t in self._original:
            if t.side == "BUY":
                symbol_flows[t.symbol] += t.total_amount
            else:
                symbol_flows[t.symbol] -= t.total_amount

        by_symbol = sorted(
            [SymbolDeployment(symbol=s, net_deployed=round(v, 2)) for s, v in symbol_flows.items()],
            key=lambda x: x.net_deployed,
            reverse=True,
        )

        # Stats use original_transactions to exclude synthetic 0-amount entries from
        # avg_transaction_size and trade counts.
        buys = [t for t in self._original if t.side == "BUY"]
        sells = [t for t in self._original if t.side == "SELL"]
        total_deposits = sum(ft["amount"] for ft in self._fund_transfers if ft["type"] == "DEPOSIT")
        total_withdrawals = sum(ft["amount"] for ft in self._fund_transfers if ft["type"] == "WITHDRAWAL")
        total_bought = sum(t.total_amount for t in buys)
        total_sold = sum(t.total_amount for t in sells)

        stats = CashflowStats(
            total_deployed=round(total_bought + total_deposits, 2),
            total_withdrawn=round(total_sold + total_withdrawals, 2),
            net_invested=round(
                (total_bought + total_deposits) - (total_sold + total_withdrawals), 2
            ),
            largest_buy=round(max((t.total_amount for t in buys), default=0), 2),
            largest_sell=round(max((t.total_amount for t in sells), default=0), 2),
            avg_transaction_size=round(
                sum(t.total_amount for t in self._original) / len(self._original), 2
            ) if self._original else 0,
        )

        return CashflowTimelineResponse(
            timeline=timeline, monthly=monthly_list, by_symbol=by_symbol, stats=stats
        )

    def get_cash_timeline(self) -> list[dict]:
        """Derive daily cash balance from an anchor point, walking forward and backward.

        From the anchor date:
        - BUY decreases cash (money leaves to buy stock)
        - SELL increases cash (proceeds return)
        - DEPOSIT increases cash
        - WITHDRAWAL decreases cash
        """
        if not self._cash_anchor:
            return []

        anchor_date = self._cash_anchor["date"]
        anchor_balance = self._cash_anchor["balance"]

        # Build daily cash deltas. Synthetic expiry closings have total_amount=0
        # so they add 0 to the deltas but ensure their date exists in the dict.
        deltas: dict[str, float] = {}
        for t in self._processed:
            d = t.date.date().isoformat()
            if d not in deltas:
                deltas[d] = 0.0
            if t.side == "BUY":
                deltas[d] -= t.total_amount   # cash leaves account
            else:
                deltas[d] += t.total_amount   # cash returns

        for ft in self._fund_transfers:
            d = ft["date"]
            if d not in deltas:
                deltas[d] = 0.0
            if ft["type"] == "DEPOSIT":
                deltas[d] += ft["amount"]
            else:
                deltas[d] -= ft["amount"]

        all_dates = sorted(set(
            [self._start_date.isoformat()]
            + list(deltas.keys())
            + [anchor_date]
            + [self._end_date.isoformat()]
        ))

        anchor_idx = None
        for i, d in enumerate(all_dates):
            if d == anchor_date:
                anchor_idx = i
                break

        if anchor_idx is None:
            all_dates.append(anchor_date)
            all_dates.sort()
            anchor_idx = all_dates.index(anchor_date)

        cash_by_date: dict[str, float] = {}
        cash_by_date[anchor_date] = anchor_balance

        # Walk forward from anchor
        running = anchor_balance
        for i in range(anchor_idx + 1, len(all_dates)):
            d = all_dates[i]
            running += deltas.get(d, 0)
            cash_by_date[d] = running

        # Walk backward from anchor — undo the delta of the *next* date to go back one step
        running = anchor_balance
        for i in range(anchor_idx - 1, -1, -1):
            d = all_dates[i]
            next_d = all_dates[i + 1]
            running -= deltas.get(next_d, 0)
            cash_by_date[d] = running

        return [
            {"date": d, "cash_balance": round(cash_by_date[d], 2)}
            for d in sorted(cash_by_date.keys())
        ]
