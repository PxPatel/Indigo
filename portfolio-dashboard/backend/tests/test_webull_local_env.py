import os
from pathlib import Path

import pytest

from services.webull.local_env import merge_webull_env_from_paths, parse_webull_lines


def test_parse_export_and_quotes():
    text = """
# comment
export WEBULL_APP_KEY=abc
WEBULL_APP_SECRET="quoted"
WEBULL_ACCOUNT_ID = spaced
"""
    d = parse_webull_lines(text)
    assert d["WEBULL_APP_KEY"] == "abc"
    assert d["WEBULL_APP_SECRET"] == "quoted"
    assert d["WEBULL_ACCOUNT_ID"] == "spaced"


def test_parse_skips_empty_values():
    d = parse_webull_lines("WEBULL_APP_KEY=\nWEBULL_APP_SECRET= x \n")
    assert "WEBULL_APP_KEY" not in d
    assert d.get("WEBULL_APP_SECRET") == "x"


def test_merge_applies_to_environ(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    p = tmp_path / ".env.local"
    p.write_text("WEBULL_APP_KEY=k1\nWEBULL_APP_SECRET=s1\n", encoding="utf-8")
    monkeypatch.delenv("WEBULL_APP_KEY", raising=False)
    monkeypatch.delenv("WEBULL_APP_SECRET", raising=False)
    merge_webull_env_from_paths([p], override=True)
    assert os.environ["WEBULL_APP_KEY"] == "k1"
    assert os.environ["WEBULL_APP_SECRET"] == "s1"
