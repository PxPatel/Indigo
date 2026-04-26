"""HMAC-SHA1 request signing per https://developer.webull.com/apis/docs/authentication/signature.md"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import urllib.parse
import uuid
from datetime import datetime, timezone


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


def utc_timestamp_header() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_nonce() -> str:
    return uuid.uuid4().hex


def compact_json_body(body: dict | None) -> str | None:
    if body is None:
        return None
    return json.dumps(body, separators=(",", ":"))
