"""Load WEBULL_* variables from .env.local without relying solely on python-dotenv.

Handles UTF-8 BOM, CRLF, optional ``export `` prefix, and quoted values — common reasons
``load_dotenv`` / the process still see empty keys even when the file exists.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_WEBULL_LINE = re.compile(
    r"^(?:export\s+)?(WEBULL_[A-Z0-9_]+)\s*=\s*(.*)\s*$",
    re.IGNORECASE,
)


def parse_webull_lines(text: str) -> dict[str, str]:
    """Parse KEY=value lines for WEBULL_* only; later lines override earlier ones."""
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _WEBULL_LINE.match(line)
        if not m:
            continue
        key = m.group(1).upper()
        if not key.startswith("WEBULL_"):
            continue
        val = m.group(2).strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        val = val.strip()
        if val:
            out[key] = val
    return out


def parse_webull_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return {}
    return parse_webull_lines(text)


def merge_webull_env_from_paths(paths: list[Path], *, override: bool = True) -> None:
    """Apply WEBULL_* from files in order; later files override earlier when override=True."""
    merged: dict[str, str] = {}
    for path in paths:
        merged.update(parse_webull_env_file(path))
    for key, val in merged.items():
        if not val:
            continue
        if override or key not in os.environ or not (os.environ.get(key) or "").strip():
            os.environ[key] = val


def standard_webull_env_paths(backend_dir: Path, portfolio_dir: Path) -> list[Path]:
    return [
        portfolio_dir / ".env",
        portfolio_dir / ".env.local",
        portfolio_dir / "env.local",
        backend_dir / ".env",
        backend_dir / ".env.local",
        backend_dir / "env.local",
        Path.cwd() / ".env.local",
        Path.cwd() / "env.local",
    ]


def webull_env_diagnostics(backend_dir: Path) -> str:
    """Safe one-line hints when credentials are missing (no secret values)."""
    p = backend_dir / ".env.local"
    if not p.is_file():
        return ""
    try:
        raw = p.read_text(encoding="utf-8-sig", errors="replace")
    except OSError as e:
        return f"Could not read .env.local: {e}"
    parsed = parse_webull_env_file(p)
    k_len = len(parsed.get("WEBULL_APP_KEY", ""))
    s_len = len(parsed.get("WEBULL_APP_SECRET", ""))
    mentions_key = "WEBULL_APP_KEY" in raw
    mentions_secret = "WEBULL_APP_SECRET" in raw
    env_k_len = len((os.environ.get("WEBULL_APP_KEY") or "").strip())
    env_s_len = len((os.environ.get("WEBULL_APP_SECRET") or "").strip())
    return (
        f"Diagnostics: file mentions KEY line={mentions_key}, SECRET line={mentions_secret}; "
        f"parsed key_len={k_len} secret_len={s_len}; "
        f"os.environ key_len={env_k_len} secret_len={env_s_len}. "
        f"If parsed > 0 but os.environ is 0, something cleared env after startup."
    )
