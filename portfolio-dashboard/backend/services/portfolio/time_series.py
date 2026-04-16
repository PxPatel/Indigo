"""
TimeSeriesBuilder — constructs daily portfolio value, return, and weight DataFrames.

Equity MTM is signed (shorts negative). When a cash anchor is set, `net_account`
adds implied cash from the same cash timeline as CashflowService so returns and
risk align with NAV-style wealth.
"""

import logging
import numpy as np
import pandas as pd
from datetime import date

from models.schemas import Transaction
from utils.calculations import daily_equity_cost_basis_eod_series

logger = logging.getLogger(__name__)

_WEALTH_EPS = 1e-6
_POS_EPS = 1e-9


def _cash_series_from_timeline(
    cash_timeline: list[dict],
    date_range: pd.DatetimeIndex,
) -> pd.Series:
    """Align cash_balance from get_cash_timeline() to business days (ffill, then bfill leading)."""
    data: dict[pd.Timestamp, float] = {}
    for r in cash_timeline:
        data[pd.Timestamp(r["date"])] = float(r["cash_balance"])
    s = pd.Series(data, dtype=float).sort_index()
    aligned = s.reindex(date_range)
    aligned = aligned.ffill()
    aligned = aligned.bfill()
    return aligned.fillna(0.0)


class TimeSeriesBuilder:
    """Builds daily_values, daily_returns, and daily_weights from prices and transactions.

    Pure computation after construction — no I/O.
    Call build() once, then read the three properties.
    """

    def __init__(
        self,
        processed_transactions: list[Transaction],
        equity_symbols: set[str],
        all_symbols: set[str],
        prices: dict[str, pd.DataFrame],
        start_date: date,
        end_date: date,
        cash_timeline: list[dict] | None = None,
    ) -> None:
        # processed_transactions must already be split-adjusted to match auto_adjust prices
        # (see utils.split_adjustment.adjust_stock_transactions_for_splits).
        self._transactions = processed_transactions
        self._equity_symbols = equity_symbols
        self._all_symbols = all_symbols   # includes options; filtered out by column check
        self._prices = prices
        self._start_date = start_date
        self._end_date = end_date
        self._cash_timeline = cash_timeline or []

        self._daily_values: pd.DataFrame = pd.DataFrame()
        self._daily_returns: pd.Series = pd.Series(dtype=float)
        self._daily_weights: pd.DataFrame = pd.DataFrame()

    def build(self) -> None:
        """Compute time series from prices and transactions. Must be called before properties."""
        date_range = pd.date_range(self._start_date, self._end_date, freq="B")

        # Build daily shares held per equity symbol over time.
        # Options are excluded — no yfinance pricing available for historical valuation.
        shares_ts: dict[str, pd.Series] = {}
        for symbol in self._equity_symbols:
            sym_txns = [t for t in self._transactions if t.symbol == symbol]
            events: dict[pd.Timestamp, float] = {}
            running = 0.0
            for t in sym_txns:
                d = pd.Timestamp(t.date.date())
                if t.side == "BUY":
                    running += t.quantity
                else:
                    running -= t.quantity
                events[d] = running
            if events:
                s = pd.Series(events).sort_index()
                s = s.reindex(date_range, method="ffill").fillna(0)
                shares_ts[symbol] = s

        # Compute daily market values per equity symbol.
        # Build all columns first then concat to avoid DataFrame fragmentation.
        value_columns: dict[str, pd.Series] = {}
        for symbol in self._equity_symbols:
            if symbol not in self._prices or symbol not in shares_ts:
                continue
            price_col = self._prices[symbol].reindex(date_range, method="ffill")
            if price_col.empty:
                continue
            value_columns[symbol] = shares_ts[symbol] * price_col[symbol].ffill()

        if value_columns:
            daily_values = pd.DataFrame(value_columns, index=date_range).fillna(0)
        else:
            daily_values = pd.DataFrame(index=date_range)
            if self._equity_symbols:
                logger.warning(
                    f"No price data could be fetched for any equity symbol "
                    f"({sorted(self._equity_symbols)}). All return-based risk metrics "
                    f"(Sharpe, Sortino, vol) will be zero. Check yfinance connectivity."
                )
        daily_values["total"] = daily_values.sum(axis=1)

        equity_cols = [c for c in daily_values.columns if c != "total"]
        if self._cash_timeline:
            daily_values["cash"] = _cash_series_from_timeline(self._cash_timeline, date_range)
            daily_values["net_account"] = daily_values["total"] + daily_values["cash"]

        neg_count = int((daily_values["total"] < 0).sum())
        if neg_count > 0:
            logger.warning(
                f"Signed equity MTM is negative on {neg_count} day(s) (e.g. net short). "
                f"Totals are not clamped; returns use wealth with safe pct_change guards."
            )

        equity_cost_basis_full = daily_equity_cost_basis_eod_series(
            self._transactions,
            self._equity_symbols,
            date_range,
        )

        # Leading trim: first day with equity exposure, implied cash, or net wealth.
        if equity_cols:
            equity_gross = daily_values[equity_cols].abs().sum(axis=1)
        else:
            equity_gross = pd.Series(0.0, index=daily_values.index)
        if "net_account" in daily_values.columns:
            wealth_mag = daily_values["net_account"].abs()
        else:
            wealth_mag = daily_values["total"].abs()
        active_leading = (equity_gross > _POS_EPS) | (wealth_mag > _WEALTH_EPS)
        if active_leading.any():
            first_idx = active_leading[active_leading].index[0]
            daily_values = daily_values.loc[first_idx:]

        daily_values["equity_cost_basis"] = equity_cost_basis_full.reindex(
            daily_values.index
        ).fillna(0.0)

        self._daily_values = daily_values

        # Trailing trim for returns: last day with equity or meaningful wealth.
        equity_cols2 = [c for c in self._daily_values.columns if c not in ("total", "cash", "net_account")]
        if equity_cols2:
            eg = self._daily_values[equity_cols2].abs().sum(axis=1)
        else:
            eg = pd.Series(0.0, index=self._daily_values.index)
        if "net_account" in self._daily_values.columns:
            wm = self._daily_values["net_account"].abs()
        else:
            wm = self._daily_values["total"].abs()
        still = (eg > _POS_EPS) | (wm > _WEALTH_EPS)
        wealth = (
            self._daily_values["net_account"]
            if "net_account" in self._daily_values.columns
            else self._daily_values["total"]
        )
        if still.any():
            last_active = still[still].index[-1]
            w_series = wealth.loc[:last_active]
        else:
            w_series = wealth

        prev = w_series.shift(1)
        chg = w_series.pct_change()
        chg = chg.where(prev.abs() >= _WEALTH_EPS, 0)
        self._daily_returns = chg.replace([np.inf, -np.inf], 0).fillna(0).clip(-1, 1)

        # Weights: MV_i / net_account when |net| large; else gross |MV| weights.
        symbols = [s for s in self._all_symbols if s in self._daily_values.columns]
        mvs = self._daily_values[symbols]
        if "net_account" in self._daily_values.columns:
            na = self._daily_values["net_account"]
            gross = mvs.abs().sum(axis=1).replace(0, np.nan)
            denom = na.where(na.abs() > _WEALTH_EPS, gross)
            self._daily_weights = mvs.div(denom, axis=0).fillna(0)
        else:
            denom = self._daily_values["total"].replace(0, np.nan)
            gross = mvs.abs().sum(axis=1).replace(0, np.nan)
            d2 = denom.where(denom.abs() > _WEALTH_EPS, gross)
            self._daily_weights = mvs.div(d2, axis=0).fillna(0)

    @property
    def daily_values(self) -> pd.DataFrame:
        return self._daily_values

    @property
    def daily_returns(self) -> pd.Series:
        return self._daily_returns

    @property
    def daily_weights(self) -> pd.DataFrame:
        return self._daily_weights
