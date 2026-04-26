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


def build_occ_option_symbol(
    underlying: str,
    expire_yyyy_mm_dd: str,
    put_or_call: str,
    strike: str | float,
) -> str:
    """Build OCC-style option ticker: {root}{YYMMDD}{P|C}{strike×1000:08d}.

    Matches Webull CSV / yfinance style (e.g. ORCL260417P00155000).
    """
    root = underlying.strip().upper()
    if not root:
        raise ValueError("underlying required")
    d = datetime.strptime(expire_yyyy_mm_dd.strip()[:10], "%Y-%m-%d").date()
    yymmdd = d.strftime("%y%m%d")
    pc = put_or_call.strip().upper()
    if pc in ("PUT", "P"):
        oc = "P"
    elif pc in ("CALL", "C"):
        oc = "C"
    else:
        oc = "P" if pc.startswith("P") else "C"
    strike_f = float(str(strike).strip().replace(",", ""))
    strike_int = int(round(Decimal(str(strike_f)) * Decimal(1000)))
    strike8 = f"{strike_int:08d}"
    return f"{root}{yymmdd}{oc}{strike8}"


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
