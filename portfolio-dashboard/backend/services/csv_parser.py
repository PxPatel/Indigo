import csv
import io
from models.schemas import Transaction
from services.parsers.webull import WebullParser

# Registry — add new brokerage parsers here as they are implemented
_PARSERS = [WebullParser]


def parse_csv(file: io.StringIO) -> list[Transaction]:
    """Detect brokerage from CSV headers and dispatch to the appropriate parser."""
    content = file.read().strip().lstrip("\ufeff")
    headers = list(csv.DictReader(io.StringIO(content)).fieldnames or [])
    parser = next((p for p in _PARSERS if p.can_parse(headers)), None)
    if parser is None:
        raise ValueError(
            f"Unrecognised brokerage CSV format. Headers found: {headers}. "
            "Supported brokerages: Webull."
        )
    # Pass a fresh StringIO so the parser always starts from position 0
    return parser.parse(io.StringIO(content))
