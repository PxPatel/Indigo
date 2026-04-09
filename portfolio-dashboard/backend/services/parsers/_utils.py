import re
from decimal import Decimal, ROUND_HALF_UP
from datetime import date, datetime

# OCC options symbol: underlying + 6-digit date + P/C + 8-digit strike
# e.g. QQQ260120P00609000
_OPTION_RE = re.compile(r'^.+\d{6}[PC]\d{8}$')

# Options contracts represent 100 shares of the underlying
OPTIONS_MULTIPLIER = 100


def _parse_date(val: str) -> datetime:
    # Strip timezone abbreviations like EDT, EST, PST, etc.
    cleaned = re.sub(r'\s+[A-Z]{2,5}$', '', val.strip())
    for fmt in (
        "%m/%d/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y",
        "%Y-%m-%d",
        "%m-%d-%Y",
    ):
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {val}")


def _parse_float(val: str) -> float:
    """Parse a float from a string, stripping currency symbols, commas, and the @ prefix Webull uses."""
    return float(val.strip().replace(",", "").replace("$", "").replace("@", ""))


def _round_currency(amount: float) -> float:
    """Round to 2 decimal places using standard ROUND_HALF_UP (not Python's banker's rounding).

    Python's built-in round() uses round-half-to-even, so round(78.565, 2) can give 78.56
    instead of the expected 78.57. Financial amounts should always round .5 up.
    Converting through Decimal(str(...)) avoids binary float representation drift.
    """
    return float(Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _is_option(symbol: str) -> bool:
    return bool(_OPTION_RE.match(symbol))


def _parse_option_expiry(symbol: str) -> date | None:
    """Extract the expiration date from an OCC option symbol.

    OCC format: {underlying}{YYMMDD}{P|C}{8-digit strike}
    e.g. QQQ260120P00609000 → 2026-01-20
    Returns None if the symbol is not a recognised option format.
    """
    m = re.search(r'(\d{6})[PC]\d{8}$', symbol)
    if not m:
        return None
    try:
        return datetime.strptime("20" + m.group(1), "%Y%m%d").date()
    except ValueError:
        return None


def _normalize_side(val: str) -> str | None:
    v = val.strip().upper()
    if v in ("BUY", "B", "BOUGHT", "BUY - MARKET", "BUY - LIMIT", "BUY TO COVER", "COVER"):
        return "BUY"
    if v in ("SELL", "S", "SOLD", "SELL - MARKET", "SELL - LIMIT", "SHORT", "SELL SHORT", "SHORT SELL"):
        return "SELL"
    if "BUY" in v or "COVER" in v:
        return "BUY"
    if "SELL" in v or "SHORT" in v:
        return "SELL"
    return None
