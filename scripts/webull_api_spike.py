#!/usr/bin/env python3
"""
Ad-hoc Webull OpenAPI spike: sign requests (HMAC-SHA1 per official docs) and demo a few GETs.

Setup:
  cd scripts
  cp env.local.example env.local   # then edit with your key/secret
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  python webull_api_spike.py
  python webull_api_spike.py --verify-signature   # run doc test vector only

References:
  - Signature: https://developer.webull.com/apis/docs/authentication/signature.md
  - Token (2FA): https://developer.webull.com/apis/docs/authentication/token.md
  - Account list example in signature.md (same signing code path)
  - Order history: https://developer.webull.com/apis/docs/reference/order-history
  - Account balance: https://developer.webull.com/apis/docs/reference/account-balance

Rate limit (docs): 2 requests / 2 seconds for these endpoints — we throttle between calls.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
except ImportError:
    print("Install dependencies: pip install -r requirements.txt", file=sys.stderr)
    raise

SCRIPT_DIR = Path(__file__).resolve().parent
load_dotenv(SCRIPT_DIR / "env.local")

# --- Official worked example from signature.md (verify implementation) ---
_DOC_APP_KEY = "776da210ab4a452795d74e726ebd74b6"
_DOC_APP_SECRET = "0f50a2e853334a9aae1a783bee120c1f"
_DOC_HOST = "api.webull.com"
_DOC_PATH = "/trade/place_order"
_DOC_TIMESTAMP = "2022-01-04T03:55:31Z"
_DOC_NONCE = "48ef5afed43d4d91ae514aaeafbc29ba"
_DOC_QUERY = {"a1": "webull", "a2": "123", "a3": "xxx", "q1": "yyy"}
_DOC_BODY_OBJ = {"k1": 123, "k2": "this is the api request body", "k3": True, "k4": {"foo": [1, 2]}}
_EXPECTED_SIGNATURE_B64 = "kvlS6opdZDhEBo5jq40nHYXaLvM="

RATE_LIMIT_SECONDS = 2.1


def generate_signature(
    path: str,
    query_params: dict[str, str],
    body_string: str | None,
    app_key: str,
    app_secret: str,
    host: str,
    timestamp: str,
    nonce: str,
) -> str:
    """Webull OpenAPI signature — matches Python sample in signature.md."""
    signing_headers = {
        "x-app-key": app_key,
        "x-timestamp": timestamp,
        "x-signature-algorithm": "HMAC-SHA1",
        "x-signature-version": "1.0",
        "x-signature-nonce": nonce,
        "host": host,
    }
    all_params: dict[str, str] = {}
    all_params.update({k: str(v) for k, v in query_params.items()})
    all_params.update(signing_headers)
    str1 = "&".join(f"{k}={all_params[k]}" for k in sorted(all_params.keys()))

    if body_string:
        str2 = hashlib.md5(body_string.encode("utf-8")).hexdigest().upper()
        str3 = f"{path}&{str1}&{str2}"
    else:
        str3 = f"{path}&{str1}"

    encoded_string = urllib.parse.quote(str3, safe="")
    signing_key = f"{app_secret}&"
    return base64.b64encode(
        hmac.new(signing_key.encode("utf-8"), encoded_string.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8")


def verify_signature_against_docs() -> None:
    body_string = json.dumps(_DOC_BODY_OBJ, separators=(",", ":"))
    sig = generate_signature(
        _DOC_PATH,
        {k: str(v) for k, v in _DOC_QUERY.items()},
        body_string,
        _DOC_APP_KEY,
        _DOC_APP_SECRET,
        _DOC_HOST,
        _DOC_TIMESTAMP,
        _DOC_NONCE,
    )
    if sig != _EXPECTED_SIGNATURE_B64:
        raise SystemExit(
            f"Signature self-test failed: got {sig!r}, expected {_EXPECTED_SIGNATURE_B64!r}"
        )
    print("OK: signature matches Webull docs worked example (HMAC-SHA1 + MD5 body).")


class WebullHttpClient:
    def __init__(
        self,
        app_key: str,
        app_secret: str,
        host: str,
        access_token: str | None = None,
    ) -> None:
        self.app_key = app_key
        self.app_secret = app_secret
        self.host = host.strip()
        self.access_token = access_token.strip() if access_token else None
        self.base_url = f"https://{self.host}"

    def request(
        self,
        method: str,
        path: str,
        query_params: dict[str, str] | None = None,
        body: dict | None = None,
    ) -> requests.Response:
        query_params = query_params or {}
        q_for_sign = {k: str(v) for k, v in query_params.items()}
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        nonce = uuid.uuid4().hex
        body_string = json.dumps(body, separators=(",", ":")) if body else None

        signature = generate_signature(
            path, q_for_sign, body_string, self.app_key, self.app_secret, self.host, timestamp, nonce
        )
        
        headers = {
            "x-app-key": self.app_key,
            "x-timestamp": timestamp,
            "x-signature": signature,
            "x-signature-algorithm": "HMAC-SHA1",
            "x-signature-version": "1.0",
            "x-signature-nonce": nonce,
            "x-version": "v2",
            "Accept": "application/json",
        }

        print(f"headers: {headers}")
        return
        # App secret is never sent on the wire (docs). Some OpenAPI reference tables list
        # x-app-secret — the official signing examples do not use it as a header.
        if self.access_token:
            headers["x-access-token"] = self.access_token

        url = f"{self.base_url}{path}"
        method_u = method.upper()
        if method_u == "GET":
            return requests.get(url, headers=headers, params=query_params, timeout=60)
        if method_u == "POST":
            headers["Content-Type"] = "application/json"
            return requests.post(url, headers=headers, data=body_string, timeout=60)
        raise ValueError(f"Unsupported method {method}")


def _print_response(label: str, resp: requests.Response, max_chars: int = 12000) -> None:
    print(f"\n=== {label} ===")
    print(f"HTTP {resp.status_code}")
    ct = resp.headers.get("content-type", "")
    if "application/json" in ct:
        try:
            data = resp.json()
            pretty = json.dumps(data, indent=2)
            if len(pretty) > max_chars:
                print(pretty[:max_chars] + f"\n... [{len(pretty) - max_chars} more chars]")
            else:
                print(pretty)
        except json.JSONDecodeError:
            print(resp.text[:max_chars])
    else:
        text = resp.text
        print(text[:max_chars] + (f"\n... [{len(text) - max_chars} more chars]" if len(text) > max_chars else ""))


def _pick_account_id(accounts_payload: object, configured: str | None) -> str | None:
    if configured:
        return configured.strip()
    if isinstance(accounts_payload, list) and accounts_payload:
        first = accounts_payload[0]
        if isinstance(first, dict) and "account_id" in first:
            return str(first["account_id"])
    if isinstance(accounts_payload, dict):
        for key in ("account_id", "accountId"):
            if key in accounts_payload:
                return str(accounts_payload[key])
    return None


def run_demos(client: WebullHttpClient, account_id: str | None) -> None:
    # 1) Account list — path from Webull signature.md example
    # r = client.request("GET", "/openapi/account/list")
    # _print_response("GET /openapi/account/list", r)
    # time.sleep(RATE_LIMIT_SECONDS)

    # aid = account_id or _pick_account_id(r.json() if r.ok else None, None)
    # if not aid:
    #     print("\nNo account_id: set WEBULL_ACCOUNT_ID in env.local or fix account list response.")
    #     return

    # print(f"\nUsing account_id={aid!r}")
    # 2) Order history — up to 2 years lookback per docs; demo: last 30 days
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=30)
    print(f"start: {start}")
    print(f"end: {end}")
    r2 = client.request(
        "GET",
        "/openapi/trade/order/history",
        query_params={
            "account_id": "LQI6PJ0M045RBBVAFFVHE3J3K8",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "page_size": "20",
        },
    )
    return
    _print_response(
        f"GET /openapi/trade/order/history (start={start}, end={end}, page_size=20)", r2
    )
    time.sleep(RATE_LIMIT_SECONDS)

    # 3) Account balance / NAV (docs: total_net_liquidation_value, cash, etc.)
    r3 = client.request(
        "GET",
        "/openapi/assets/balance",
        query_params={"account_id": aid},
    )
    _print_response("GET /openapi/assets/balance", r3)

    if not client.access_token and (r2.status_code >= 400 or r3.status_code >= 400):
        print(
            "\nNote: If you see auth errors, your app may require 2FA — set WEBULL_ACCESS_TOKEN "
            "after creating a token in the Webull app (see token.md)."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Webull OpenAPI signing spike")
    parser.add_argument(
        "--verify-signature",
        action="store_true",
        help="Only run the docs HMAC self-test (no network).",
    )
    args = parser.parse_args()

    if args.verify_signature:
        verify_signature_against_docs()
        return

    app_key = os.environ.get("WEBULL_APP_KEY", "").strip()
    app_secret = os.environ.get("WEBULL_APP_SECRET", "").strip()
    host = os.environ.get("WEBULL_API_HOST", "api.webull.com").strip()
    account_id = os.environ.get("WEBULL_ACCOUNT_ID", "").strip() or None
    token = os.environ.get("WEBULL_ACCESS_TOKEN", "").strip() or None

    if not app_key or not app_secret:
        print(
            "Set WEBULL_APP_KEY and WEBULL_APP_SECRET in scripts/env.local "
            "(copy from env.local.example).",
            file=sys.stderr,
        )
        sys.exit(1)

    verify_signature_against_docs()

    client = WebullHttpClient(app_key, app_secret, host, access_token=token)
    run_demos(client, account_id)


if __name__ == "__main__":
    main()
