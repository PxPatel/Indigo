import pytest

from services.parsers._utils import build_occ_option_symbol, _is_option
from services.webull.mapper import map_order_group_to_rows


def test_build_occ_matches_webull_style():
    assert build_occ_option_symbol("ORCL", "2026-04-17", "PUT", "155.00") == "ORCL260417P00155000"
    # 609.00 strike → 609000 → 8-digit width 00609000 (matches existing OCC examples in repo)
    assert build_occ_option_symbol("QQQ", "2026-01-20", "CALL", 609) == "QQQ260120C00609000"
    assert _is_option("ORCL260417P00155000")


def test_mapper_option_single_leg_occ():
    group = {
        "client_order_id": "c1",
        "combo_type": "NORMAL",
        "orders": [
            {
                "symbol": "ORCL",
                "side": "SELL",
                "status": "FILLED",
                "legs": [
                    {
                        "symbol": "ORCL",
                        "quantity": "1",
                        "side": "SELL",
                        "option_type": "PUT",
                        "option_expire_date": "2026-04-17",
                        "strike_price": "155.00",
                    }
                ],
                "instrument_type": "OPTION",
                "filled_quantity": "1.00",
                "filled_time_at": "2026-04-14T15:27:23.830Z",
                "filled_price": "1.29",
                "order_id": "o1",
            }
        ],
    }
    rows = map_order_group_to_rows(group)
    assert len(rows) == 1
    r = rows[0]
    assert r.symbol == "ORCL260417P00155000"
    assert r.side == "SELL"
    assert r.quantity == 1.0
    assert r.price == 1.29
    assert r.instrument_type == "option"
    assert r.total_amount == 129.0  # 1 * 1.29 * 100


def test_position_intent_short_option_close():
    """BUY_TO_CLOSE closes a short option → BUY for ledger."""
    group = {
        "combo_type": "NORMAL",
        "orders": [
            {
                "symbol": "ORCL",
                "side": "BUY",
                "status": "FILLED",
                "position_intent": "BUY_TO_CLOSE",
                "legs": [
                    {
                        "symbol": "ORCL",
                        "quantity": "1",
                        "side": "BUY",
                        "option_type": "PUT",
                        "option_expire_date": "2026-04-17",
                        "strike_price": "155.00",
                    }
                ],
                "instrument_type": "OPTION",
                "filled_quantity": "1.00",
                "filled_time_at": "2026-04-14T15:30:00.000Z",
                "filled_price": "0.50",
                "order_id": "o2",
            }
        ],
    }
    rows = map_order_group_to_rows(group)
    assert len(rows) == 1
    assert rows[0].side == "BUY"


def test_position_intent_sell_to_open_overrides():
    group = {
        "combo_type": "NORMAL",
        "orders": [
            {
                "symbol": "ORCL",
                "side": "SELL",
                "status": "FILLED",
                "position_intent": "SELL_TO_OPEN",
                "instrument_type": "EQUITY",
                "filled_quantity": "10",
                "filled_time_at": "2026-04-14T16:00:00.000Z",
                "filled_price": "100",
                "order_id": "e2",
            }
        ],
    }
    rows = map_order_group_to_rows(group)
    assert rows[0].side == "SELL"


def test_mapper_equity_unchanged():
    group = {
        "combo_type": "NORMAL",
        "orders": [
            {
                "symbol": "HOOD",
                "side": "BUY",
                "status": "FILLED",
                "instrument_type": "EQUITY",
                "filled_quantity": "1.00",
                "filled_time_at": "2026-04-15T01:27:33.550Z",
                "filled_price": "84.74",
                "order_id": "e1",
            }
        ],
    }
    rows = map_order_group_to_rows(group)
    assert len(rows) == 1
    assert rows[0].symbol == "HOOD"
    assert rows[0].instrument_type == "stock"
