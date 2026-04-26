"""Minimal signed HTTP client with Webull rate limiting (2 req / 2s per docs)."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import requests

from services.webull.signing import compact_json_body, generate_signature, new_nonce, utc_timestamp_header

logger = logging.getLogger(__name__)

# Order history / account endpoints: 2 requests every 2 seconds (docs).
RATE_LIMIT_SECONDS = 2.1

# HTTP 417 "Expectation Failed" often means the server/proxy rejected ``Expect: 100-continue``.
# Disabling trust in system proxy env by default avoids middleboxes that inject broken Expect.
# Set WEBULL_HTTP_USE_SYSTEM_PROXY=1 to use HTTP_PROXY/HTTPS_PROXY from the environment.
_USE_SYSTEM_PROXY = os.environ.get("WEBULL_HTTP_USE_SYSTEM_PROXY", "").lower() in ("1", "true", "yes")


class WebullOpenApiClient:
    def __init__(
        self,
        app_key: str,
        app_secret: str,
        host: str,
        access_token: str | None = None,
    ) -> None:
        self.app_key = app_key.strip()
        self.app_secret = app_secret.strip()
        self.host = host.strip()
        self.access_token = (access_token or "").strip() or None
        self.base_url = f"https://{self.host}"
        self._last_request_mono: float = 0.0
        self._session = requests.Session()
        self._session.trust_env = _USE_SYSTEM_PROXY

    def _throttle(self) -> None:
        now = time.monotonic()
        wait = RATE_LIMIT_SECONDS - (now - self._last_request_mono)
        if wait > 0:
            time.sleep(wait)
        self._last_request_mono = time.monotonic()

    def request(
        self,
        method: str,
        path: str,
        query_params: dict[str, str] | None = None,
        body: dict | None = None,
        timeout: int = 120,
    ) -> requests.Response:
        self._throttle()
        query_params = query_params or {}
        q_for_sign = {k: str(v) for k, v in query_params.items()}
        timestamp = utc_timestamp_header()
        nonce = new_nonce()
        body_string = compact_json_body(body)

        signature = generate_signature(
            path,
            q_for_sign,
            body_string,
            self.app_key,
            self.app_secret,
            self.host,
            timestamp,
            nonce,
        )
        headers: dict[str, str] = {
            "x-app-key": self.app_key,
            "x-timestamp": timestamp,
            "x-signature": signature,
            "x-signature-algorithm": "HMAC-SHA1",
            "x-signature-version": "1.0",
            "x-signature-nonce": nonce,
            "x-version": "v2",
            "Accept": "application/json",
        }
        if self.access_token:
            headers["x-access-token"] = self.access_token

        url = f"{self.base_url}{path}"
        method_u = method.upper()
        if method_u == "GET":
            return self._session.get(url, headers=headers, params=query_params, timeout=timeout)
        if method_u == "POST":
            headers["Content-Type"] = "application/json"
            return self._session.post(url, headers=headers, data=body_string, timeout=timeout)
        raise ValueError(f"Unsupported method {method}")

    def get_json(self, path: str, query_params: dict[str, str] | None = None) -> Any:
        resp = self.request("GET", path, query_params=query_params)
        if resp.status_code >= 400:
            snippet = (resp.text or "")[:1200].replace("\n", " ")
            logger.warning("Webull API error %s: %s", resp.status_code, snippet)
            raise requests.HTTPError(
                f"{resp.status_code} {resp.reason} for {resp.url}: {snippet}",
                response=resp,
            )
        return resp.json()
