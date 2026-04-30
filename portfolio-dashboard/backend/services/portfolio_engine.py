"""
PortfolioEngine — facade that orchestrates build and delegates all queries.

Public attributes and method signatures are identical to before Phase 4.
All callers (main.py routes, risk_engine, attribution, benchmark, symbol_chart)
work without modification.

Sub-component responsibilities:
  TimeSeriesBuilder   → daily values / returns / weights
  CashflowService     → cashflow timeline + cash balance timeline
  QueryService        → transaction log + snapshot weights + sectors
  response_builders   → PortfolioSummary / History / Weights / Holdings
  walk_transactions_avg_cost (utils) → avg-cost accounting
"""

import logging
import pandas as pd
from collections import defaultdict
from datetime import date, datetime, timedelta

logger = logging.getLogger(__name__)

from models.schemas import (
    Transaction,
    PortfolioSummary,
    PortfolioHistoryResponse,
    PortfolioWeightsResponse,
    HoldingsResponse,
    CashflowTimelineResponse,
    TransactionsResponse,
    CostBasisLadderResponse,
    FifoLotRow,
    CostBasisMergedLevel,
)
from services.market_data import MarketDataService
from services.debug_context import today as debug_today
from services.parsers._utils import _parse_option_expiry
from services.portfolio.time_series import TimeSeriesBuilder
from services.portfolio.response_builders import (
    build_summary,
    build_history,
    build_weights,
    build_holdings,
    build_holdings_as_of,
)
from services.portfolio.cashflow import CashflowService
from services.portfolio.query import QueryService
from services.portfolio.as_of import close_at_or_before, prior_close
from utils.calculations import walk_transactions_avg_cost, MIN_SHARE_THRESHOLD
from utils.fifo_lots import (
    compute_fifo_open_lots,
    collect_buy_dates_for_symbol,
    avg_calendar_days_between_buys,
    merge_lots_by_price,
)
from utils.split_adjustment import adjust_stock_transactions_for_splits


class PortfolioEngine:
    """Orchestrates portfolio build and exposes the query surface.

    Call build() once after construction. All get_* methods and properties
    are safe to call after build() completes.
    """

    def __init__(
        self,
        transactions: list[Transaction],
        market: MarketDataService,
        fund_transfers: list[dict] | None = None,
        cash_anchor: dict | None = None,
        csv_start: date | None = None,
    ) -> None:
        self.transactions = transactions          # original input, never mutated
        self._accounting_transactions: list[Transaction] = []  # split-adjusted + option synthetics; set in build()
        self.market = market
        self.fund_transfers = fund_transfers or []
        self.cash_anchor = cash_anchor            # {"date": "YYYY-MM-DD", "balance": float} | None
        self.symbols: set[str] = set()
        # csv_start anchors the price-fetch window so manual entries with early dates
        # can't shift start_date backward and corrupt risk metrics.
        self.start_date: date = csv_start or transactions[0].date.date()
        self.end_date: date = debug_today()

        # Accounting state (set by build, exposed for backward compat)
        # risk_engine and symbol_chart read _shares_held / _avg_cost / _prices directly.
        self._shares_held: dict[str, float] = {}
        self._avg_cost: dict[str, float] = {}
        self._cost_basis: dict[str, float] = {}
        self._last_activity: dict[str, str] = {}
        self._realized_pnl: float = 0.0
        self.cumulative_invested: float = 0.0
        self._daily_cumulative_realized: dict[str, float] = {}

        # Market data (set by build, exposed for backward compat)
        self._prices: dict[str, pd.DataFrame] = {}
        self._stock_info: dict[str, dict] = {}

        # Sub-components (set by build)
        self._time_series: TimeSeriesBuilder | None = None
        self._cashflow_svc: CashflowService | None = None
        self._query_svc: QueryService | None = None

    # ------------------------------------------------------------------ #
    # Build                                                                #
    # ------------------------------------------------------------------ #

    def build(self) -> None:
        """Pre-compute all portfolio state. Must be called before any get_* or property access.

        self.transactions is never mutated. Internal processing uses
        _processed_transactions (option-expiry synthetics), then
        _accounting_transactions (split-adjusted stock fills for yfinance parity),
        then walk + time series + cashflow.
        """
        self._processed_transactions = self._inject_expiry_closings(self.transactions)
        self.symbols = {t.symbol for t in self._processed_transactions}
        self._equity_symbols = {
            t.symbol for t in self._processed_transactions if t.instrument_type == "stock"
        }
        self._option_symbols = {
            t.symbol for t in self._processed_transactions if t.instrument_type == "option"
        }

        # Fetch market data
        self._prices = self.market.get_historical_prices_batch(
            sorted(self._equity_symbols), self.start_date, self.end_date
        )
        self._stock_info = self.market.get_stock_info_batch(sorted(self._equity_symbols))
        splits: dict[str, pd.Series] = {}
        for symbol in self._equity_symbols:
            s = self.market.get_splits(symbol)
            if not s.empty:
                splits[symbol] = s

        self._accounting_transactions = adjust_stock_transactions_for_splits(
            self._processed_transactions, splits
        )

        # Accounting — single canonical walk (split-adjusted share units vs yfinance prices)
        result = walk_transactions_avg_cost(self._accounting_transactions)
        self._shares_held = result.shares_held
        self._avg_cost = result.avg_cost_per_share
        self._cost_basis = result.total_cost_basis
        self._last_activity = result.last_activity
        self._realized_pnl = result.realized_pnl
        self.cumulative_invested = result.cumulative_invested
        self._daily_cumulative_realized = result.daily_cumulative_realized

        # Cashflow before time series so implied cash aligns to the same business-day index.
        self._cashflow_svc = CashflowService(
            processed_transactions=self._accounting_transactions,
            original_transactions=self.transactions,
            daily_cumulative_realized=self._daily_cumulative_realized,
            fund_transfers=self.fund_transfers,
            start_date=self.start_date,
            end_date=self.end_date,
            cash_anchor=self.cash_anchor,
        )
        cash_timeline = self._cashflow_svc.get_cash_timeline()

        self._time_series = TimeSeriesBuilder(
            processed_transactions=self._accounting_transactions,
            equity_symbols=self._equity_symbols,
            all_symbols=self.symbols,
            prices=self._prices,
            start_date=self.start_date,
            end_date=self.end_date,
            cash_timeline=cash_timeline,
        )
        self._time_series.build()

        # Query service (needs daily_weights from time series, so comes last)
        self._query_svc = QueryService(
            original_transactions=self.transactions,
            daily_weights=self._time_series.daily_weights,
            stock_info=self._stock_info,
        )

    def _inject_expiry_closings(self, transactions: list[Transaction]) -> list[Transaction]:
        """Return a new transaction list with synthetic $0 closings for expired options.

        Brokers do not generate a transaction when an option expires worthless. Without this
        the engine would keep the position open forever. We detect the expiry date from the OCC
        symbol and add a synthetic SELL (long) or BUY (short) at price=0, total=0 on that date.

        Returns a new sorted list — does NOT mutate the input. build() is therefore safe to
        call multiple times without accumulating duplicate synthetic entries.
        """
        net: dict[str, float] = defaultdict(float)
        for t in transactions:
            if t.instrument_type != "option":
                continue
            net[t.symbol] += t.quantity if t.side == "BUY" else -t.quantity

        today = debug_today()
        injected: list[Transaction] = []
        for symbol, qty in net.items():
            if abs(qty) < MIN_SHARE_THRESHOLD:
                continue  # position already closed by an explicit transaction
            expiry = _parse_option_expiry(symbol)
            if expiry is None or expiry >= today:
                continue  # not yet expired (or unparseable symbol)

            close_side = "SELL" if qty > 0 else "BUY"
            injected.append(Transaction(
                date=datetime.combine(expiry, datetime.min.time()),
                symbol=symbol,
                side=close_side,
                quantity=abs(qty),
                price=0.0,
                total_amount=0.0,
                instrument_type="option",
            ))

        if not injected:
            return transactions
        return sorted(transactions + injected, key=lambda t: t.date)

    # ------------------------------------------------------------------ #
    # Public query methods — delegate to sub-components                   #
    # ------------------------------------------------------------------ #

    def get_summary(self) -> PortfolioSummary:
        # Gross invested = sum of all BUY amounts ever (denominator for total P&L %).
        # Uses original transactions (no synthetic option-expiry closings at price=0).
        gross_invested = sum(
            t.total_amount for t in self.transactions if t.side == "BUY"
        )
        return build_summary(
            shares_held=self._shares_held,
            cost_basis=self._cost_basis,
            avg_cost=self._avg_cost,
            realized_pnl=self._realized_pnl,
            cumulative_invested=self.cumulative_invested,
            gross_invested=gross_invested,
            daily_returns=self.daily_returns,
            daily_values=self.daily_values,
            market=self.market,
            start_date=self.start_date,
            end_date=self.end_date,
            cash_anchor=self.cash_anchor,
            get_cash_timeline=self.get_cash_timeline,
            option_symbols=self._option_symbols,
        )

    def get_history(self, start: date | None = None, end: date | None = None) -> PortfolioHistoryResponse:
        return build_history(
            self.daily_values,
            start,
            end,
            daily_cumulative_realized=self._daily_cumulative_realized,
        )

    def get_weights(self, start: date | None = None, end: date | None = None) -> PortfolioWeightsResponse:
        return build_weights(self.daily_weights, self.symbols, start, end)

    def get_holdings(self) -> HoldingsResponse:
        return build_holdings(
            shares_held=self._shares_held,
            avg_cost=self._avg_cost,
            cost_basis=self._cost_basis,
            last_activity=self._last_activity,
            processed_transactions=self._accounting_transactions,
            prices=self._prices,
            stock_info=self._stock_info,
            market=self.market,
        )

    def get_holdings_as_of(self, as_of: date) -> HoldingsResponse:
        """Replay transactions up to and including `as_of` and return historical holdings.

        Uses the engine's already-cached `_prices` for close-price lookups (no yfinance calls).
        Option-expiry synthetics live at their expiry date, so slicing by `as_of` naturally
        excludes synthetics whose expiry is after `as_of` — options that were open on that
        date remain open.
        """
        if as_of < self.start_date:
            raise ValueError(
                f"as_of ({as_of.isoformat()}) is before the earliest transaction date "
                f"({self.start_date.isoformat()})"
            )
        if as_of > debug_today():
            raise ValueError("as_of cannot be in the future")

        sliced = [t for t in self._accounting_transactions if t.date.date() <= as_of]
        result = walk_transactions_avg_cost(sliced)

        def lookup(symbol: str) -> tuple[float | None, float | None]:
            close, _ = close_at_or_before(self._prices, symbol, as_of)
            prev = prior_close(self._prices, symbol, as_of)
            return close, prev

        return build_holdings_as_of(
            shares_held=result.shares_held,
            avg_cost=result.avg_cost_per_share,
            cost_basis=result.total_cost_basis,
            last_activity=result.last_activity,
            processed_transactions=sliced,
            close_lookup=lookup,
            stock_info=self._stock_info,
            as_of=as_of,
        )

    def get_cost_basis_ladder(
        self,
        symbol: str,
        as_of: date | None = None,
    ) -> CostBasisLadderResponse:
        sym = symbol.strip().upper()
        # Slice transactions to as_of if provided; otherwise use the full engine state.
        if as_of is not None:
            if as_of < self.start_date:
                raise ValueError(
                    f"as_of ({as_of.isoformat()}) is before the earliest transaction date "
                    f"({self.start_date.isoformat()})"
                )
            if as_of > debug_today():
                raise ValueError("as_of cannot be in the future")
            txns_for_walk = [
                t for t in self._accounting_transactions if t.date.date() <= as_of
            ]
            walk = walk_transactions_avg_cost(txns_for_walk)
            shares_held_map = walk.shares_held
            cost_basis_map = walk.total_cost_basis
            option_syms = {
                t.symbol for t in txns_for_walk if t.instrument_type == "option"
            }
        else:
            txns_for_walk = self._accounting_transactions
            shares_held_map = self._shares_held
            cost_basis_map = self._cost_basis
            option_syms = self._option_symbols

        if sym not in shares_held_map:
            raise ValueError("Symbol not in portfolio holdings")
        shares = shares_held_map[sym]
        if shares <= MIN_SHARE_THRESHOLD:
            raise ValueError("Cost basis ladder is only available for long equity positions")
        if sym in option_syms:
            raise ValueError("Cost basis ladder is not available for options")

        lots_int = compute_fifo_open_lots(txns_for_walk, sym)
        if not lots_int:
            raise ValueError("Could not reconstruct open lots for this symbol")

        info = self._stock_info.get(sym, {})
        name = info.get("name", sym)

        today_pct = 0.0
        prev_close: float | None = None

        if as_of is not None:
            # Historical close + prior trading day from cached _prices.
            close_val, _ = close_at_or_before(self._prices, sym, as_of)
            price = float(close_val) if close_val is not None else 0.0
            prev_close = prior_close(self._prices, sym, as_of)
            if prev_close is not None and prev_close > 0 and price > 0:
                today_pct = (price / prev_close - 1) * 100
        else:
            price = self.market.get_current_price(sym)
            # Prior close from a fresh 7d window (same as holdings / summary), not engine _prices.
            today = debug_today()
            day_start = today - timedelta(days=7)
            recent = self.market.get_historical_prices_batch([sym], day_start, today)
            ohlc_df = recent.get(sym)
            if ohlc_df is None or ohlc_df.empty:
                ohlc_df = self._prices.get(sym)
            if ohlc_df is not None and not ohlc_df.empty and sym in ohlc_df.columns:
                p = ohlc_df[sym].dropna()
                today_ts = pd.Timestamp(today)
                prior = p[p.index < today_ts]
                if prior.empty:
                    prior = p
                if not prior.empty:
                    prev_close = float(prior.iloc[-1])
                    if prev_close > 0:
                        today_pct = (price / prev_close - 1) * 100

        if prev_close is not None and prev_close > 0:
            today_dollars = abs(shares) * (price - prev_close)
        else:
            today_dollars = abs(shares) * price * (today_pct / 100) if today_pct else 0.0

        # Match Holdings unrealized P&L (average-cost basis), not a FIFO-only rollup.
        cb = cost_basis_map.get(sym, 0.0)
        mv = abs(shares) * price
        unrealized = mv - cb
        unrealized_pct = (unrealized / cb * 100) if cb > 1e-10 else 0.0

        distinct_lot_prices = sorted({round(l.price, 2) for l in lots_int})
        if len(distinct_lot_prices) >= 2:
            gaps = [
                distinct_lot_prices[i + 1] - distinct_lot_prices[i]
                for i in range(len(distinct_lot_prices) - 1)
            ]
            avg_interval_between_lot_prices = sum(gaps) / len(gaps)
        else:
            avg_interval_between_lot_prices = None

        buy_dates = collect_buy_dates_for_symbol(txns_for_walk, sym)
        avg_days = avg_calendar_days_between_buys(buy_dates)

        lot_rows: list[FifoLotRow] = []
        for lot in sorted(lots_int, key=lambda x: x.acquisition_date, reverse=True):
            cv = price * lot.quantity
            pnl = (price - lot.price) * lot.quantity
            pnl_p = ((price - lot.price) / lot.price * 100) if lot.price > 1e-10 else 0.0
            lot_rows.append(
                FifoLotRow(
                    date=lot.acquisition_date.strftime("%Y-%m-%d"),
                    price=round(lot.price, 2),
                    shares=round(lot.quantity, 4),
                    current_value=round(cv, 2),
                    pnl_dollars=round(pnl, 2),
                    pnl_percent=round(pnl_p, 2),
                )
            )

        merged_raw = merge_lots_by_price(lots_int)
        merged_levels = [
            CostBasisMergedLevel(
                price=round(m["price"], 2),
                shares=round(m["shares"], 4),
                date_start=m["date_min"].strftime("%Y-%m-%d"),
                date_end=m["date_max"].strftime("%Y-%m-%d"),
            )
            for m in merged_raw
        ]

        return CostBasisLadderResponse(
            symbol=sym,
            name=name,
            current_price=round(price, 2),
            today_change_percent=round(today_pct, 2),
            today_change_dollars=round(today_dollars, 2),
            unrealized_pnl_dollars=round(unrealized, 2),
            unrealized_pnl_percent=round(unrealized_pct, 2),
            avg_days_between_buys=round(avg_days, 2) if avg_days is not None else None,
            avg_interval_between_lot_prices=(
                round(avg_interval_between_lot_prices, 4)
                if avg_interval_between_lot_prices is not None
                else None
            ),
            open_lot_count=len(lots_int),
            lots=lot_rows,
            merged_levels=merged_levels,
            as_of=as_of.isoformat() if as_of is not None else None,
        )

    @property
    def accounting_transactions(self) -> list[Transaction]:
        """Processed transactions in split-adjusted units (for chart replay vs engine)."""
        return self._accounting_transactions

    def get_cashflow_timeline(
        self, start: date | None = None, end: date | None = None
    ) -> CashflowTimelineResponse:
        return self._cashflow_svc.get_timeline(start, end)

    def get_cash_timeline(self) -> list[dict]:
        return self._cashflow_svc.get_cash_timeline()

    def get_transactions(
        self,
        symbol: str | None = None,
        side: str | None = None,
        start: date | None = None,
        end: date | None = None,
    ) -> TransactionsResponse:
        return self._query_svc.get_transactions(symbol, side, start, end)

    def get_snapshot_weights(self, target_date: date) -> tuple[str, dict[str, float]]:
        return self._query_svc.get_snapshot_weights(target_date)

    def get_holding_sectors(self) -> dict[str, str]:
        return self._query_svc.get_holding_sectors()

    # ------------------------------------------------------------------ #
    # Properties — backward compat for risk_engine / attribution / benchmark
    # ------------------------------------------------------------------ #

    @property
    def daily_returns(self) -> pd.Series:
        return self._time_series.daily_returns if self._time_series else pd.Series(dtype=float)

    @property
    def daily_values(self) -> pd.DataFrame:
        return self._time_series.daily_values if self._time_series else pd.DataFrame()

    @property
    def daily_weights(self) -> pd.DataFrame:
        return self._time_series.daily_weights if self._time_series else pd.DataFrame()
