import csv
import io
from models.schemas import Transaction
from services.parsers._utils import (
    _parse_date, _parse_float, _round_currency, _is_option, _normalize_side, OPTIONS_MULTIPLIER,
)

# Webull CSVs are identified by the presence of these column headers
_WEBULL_SIGNATURE = {"Filled Time", "Avg Price", "Filled"}

# Webull CSV column name variations
_COL_MAP = {
    "date": ["Filled Time", "Date", "date", "Trade Date", "trade_date", "Fill Date", "Placed Time"],
    "symbol": ["Symbol", "symbol", "Ticker", "ticker", "Stock"],
    "side": ["Side", "side", "Action", "action", "Direction"],
    "quantity": ["Filled", "Qty", "qty", "Quantity", "quantity", "Shares", "shares", "Filled Qty", "Total Qty"],
    "price": ["Avg Price", "Price", "price", "avg_price", "Fill Price", "Average Price"],
    "amount": ["Amount", "amount", "Total", "total", "Net Amount"],
    "status": ["Status", "status", "Order Status"],
}


def _find_col(headers: list[str], key: str) -> str | None:
    candidates = _COL_MAP.get(key, [])
    header_lower = {h.strip().lower(): h.strip() for h in headers}
    for c in candidates:
        if c.lower() in header_lower:
            return header_lower[c.lower()]
    return None


class WebullParser:
    @staticmethod
    def can_parse(headers: list[str]) -> bool:
        return bool({h.strip() for h in headers} & _WEBULL_SIGNATURE)

    @staticmethod
    def parse(file: io.StringIO) -> list[Transaction]:
        content = file.read()
        reader = csv.DictReader(io.StringIO(content))
        headers = reader.fieldnames or []

        col_date = _find_col(headers, "date")
        col_symbol = _find_col(headers, "symbol")
        col_side = _find_col(headers, "side")
        col_qty = _find_col(headers, "quantity")
        col_price = _find_col(headers, "price")
        col_amount = _find_col(headers, "amount")
        col_status = _find_col(headers, "status")

        if not all([col_date, col_symbol, col_side, col_qty, col_price]):
            raise ValueError(
                f"CSV missing required columns. Found: {headers}. "
                "Need at least: Date, Symbol, Side, Qty, Price"
            )

        transactions: list[Transaction] = []
        for row in reader:
            # Filter to filled orders only.
            # Webull quirk: partially-filled orders can appear with Status="cancelled"
            # but a non-zero Filled quantity — the qty is the ground truth, accept them.
            if col_status:
                status = row.get(col_status, "").strip().lower()
                try:
                    filled_qty = abs(_parse_float(row.get(col_qty, "0").strip()))
                except ValueError:
                    filled_qty = 0.0

                if status == "cancelled" and filled_qty > 0:
                    pass  # partial fill reported as cancelled — qty is the ground truth
                elif status and status not in (
                    "filled", "executed", "complete", "completed",
                    "partial filled", "partially filled", "partial fill", "partial",
                ):
                    continue

            side = _normalize_side(row[col_side])
            if side is None:
                continue

            try:
                qty = abs(_parse_float(row[col_qty]))
                price = abs(_parse_float(row[col_price]))
            except (ValueError, KeyError):
                continue

            if qty == 0 or price == 0:
                continue

            symbol = row[col_symbol].strip().upper()
            is_opt = _is_option(symbol)

            # Compute amount: prefer explicit Amount column, fall back to qty * price.
            # For options, multiply by 100 (1 contract = 100 shares).
            amount: float
            if col_amount:
                try:
                    raw_amount = abs(_parse_float(row[col_amount]))
                    if raw_amount > 0:
                        # Webull options Amount column reports actual dollar value (already * 100).
                        amount = raw_amount
                    else:
                        amount = qty * price * (OPTIONS_MULTIPLIER if is_opt else 1)
                except (ValueError, KeyError):
                    amount = qty * price * (OPTIONS_MULTIPLIER if is_opt else 1)
            else:
                amount = qty * price * (OPTIONS_MULTIPLIER if is_opt else 1)

            amount = _round_currency(amount)
            price = round(price, 6)  # keep enough precision for avg cost calc

            transactions.append(
                Transaction(
                    date=_parse_date(row[col_date]),
                    symbol=symbol,
                    side=side,
                    quantity=qty,
                    price=price,
                    total_amount=amount,
                    instrument_type="option" if is_opt else "stock",
                )
            )

        transactions.sort(key=lambda t: t.date)
        return transactions
