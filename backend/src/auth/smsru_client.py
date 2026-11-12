"""SmsRuClient — the only sms.ru-aware class (#593 Task 1).

Implements the :class:`CallcheckProvider` seam against
``https://sms.ru/callcheck/`` (research §Эндпоинты):

- ``add`` — ``api_id`` + ``phone`` (canonical ``+7…`` → bare ``7…``;
  the exact wire format is unverified live — risk №2) + the optional
  client ``ip`` (roaming 8-800 substitution) + ``json=1``; success =
  ``status_code`` 100 arrived as a string OR a number (the docs are
  inconsistent), the number to call arrives as ``call_phone`` OR
  ``call_number`` (PHP example vs JSON spec) and is normalized to the
  canonical client form with the leading ``+``;
- ``status`` — ``check_status`` 100/400 → waiting, 401 → confirmed,
  402 → expired (string or number tolerated alike);
- ANY failure — HTTP ≠ 2xx, ``status_code`` ≠ 100, unknown
  ``check_status``, timeout, network, malformed body — raises
  :class:`CallcheckProviderError`; the message carries numeric codes
  only, never the request body, the phone, the ip or the api key
  (§Клиент провайдера).

httpx ``AsyncClient`` is created PER CALL with a timeout (the #586
per-call pattern — no shared connection state; the dependency is
declared in ``pyproject.toml``, this is its first production use).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Клиент провайдера
Research: docs/research/2026-11-11-smsru-callcheck-api.md
"""

from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING, Any

import httpx

from src.auth.callcheck_provider import (
    CALLCHECK_WINDOW_SECONDS,
    CallcheckProviderError,
    CallcheckStatus,
    CheckCreated,
)
from src.auth.scope import mask_phone

if TYPE_CHECKING:
    from pydantic import SecretStr

logger = logging.getLogger("memo.auth.smsru_client")

_BASE_URL = "https://sms.ru/callcheck/"
_TIMEOUT = httpx.Timeout(10.0)

#: ``check_status`` → seam outcome (research §Коды check_status):
#: 100 accepted / 400 no call yet → waiting; 401 the caller id matched
#: → confirmed; 402 window elapsed / unknown check → expired. Keys are
#: strings — values arrive as string or number and go through ``str()``.
_CHECK_STATUS_MAP: dict[str, CallcheckStatus] = {
    "100": CallcheckStatus.WAITING,
    "400": CallcheckStatus.WAITING,
    "401": CallcheckStatus.CONFIRMED,
    "402": CallcheckStatus.EXPIRED,
}

_NON_DIGIT = re.compile(r"\D+")


def _to_api_phone(phone: str) -> str:
    """Canonical ``+7XXXXXXXXXX`` → the API form ``7XXXXXXXXXX``."""
    return phone[1:] if phone.startswith("+") else phone


def _client_call_phone(raw: str) -> str:
    """Provider digits → the canonical client form with the leading ``+``.

    sms.ru returns ``78005008275`` (or a pretty variant); the
    client-facing number MUST carry the ``+`` — some operators reject
    the bare form, especially callers from abroad (research «Факты
    провайдера для UI»). Non-digits are stripped, never guessed.
    """
    digits = _NON_DIGIT.sub("", raw)
    return f"+{digits}"


def _code(value: Any) -> int:
    """Tolerant numeric read of a provider code (string or number).

    Unreadable values collapse to ``-1`` — a safe sentinel that can
    never equal 100 and never carries request data into messages.
    """
    if isinstance(value, bool):  # bool is an int subclass — not a code
        return -1
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1


class SmsRuClient:
    """sms.ru callcheck API client — ``create`` (``add``) + ``status``."""

    def __init__(
        self,
        api_id: SecretStr,
        *,
        base_url: str = _BASE_URL,
        timeout: httpx.Timeout = _TIMEOUT,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_id = api_id
        self._base_url = base_url
        self._timeout = timeout
        self._transport = transport

    async def create(self, phone: str, ip: str | None) -> CheckCreated:
        """``callcheck/add`` — start a check, return the number to call."""
        data: dict[str, str] = {
            "api_id": self._api_id.get_secret_value(),
            "phone": _to_api_phone(phone),
            "json": "1",
        }
        if ip:
            data["ip"] = ip

        body = await self._post("add", data)
        check_id = body.get("check_id")
        if not isinstance(check_id, str) or not check_id:
            raise _fail("add", "response carries no check_id")
        # The docs disagree on the field name (JSON spec: call_phone;
        # PHP example: call_number) — tolerate both (research, risk №5).
        call_number = body.get("call_phone") or body.get("call_number")
        if not isinstance(call_number, str) or not call_number.strip():
            raise _fail("add", "response carries no call number")
        call_phone = _client_call_phone(call_number)
        if call_phone == "+":
            raise _fail("add", "response call number has no digits")

        logger.info(
            "sms.ru callcheck add ok: phone=%s check_id=%s call_phone=%s",
            mask_phone(phone),
            check_id,
            call_phone,
        )
        return CheckCreated(
            check_id=check_id,
            call_phone=call_phone,
            window_seconds=CALLCHECK_WINDOW_SECONDS,  # the client constant
        )

    async def status(self, check_id: str) -> CallcheckStatus:
        """``callcheck/status`` — poll the check outcome."""
        data = {
            "api_id": self._api_id.get_secret_value(),
            "check_id": check_id,
            "json": "1",
        }
        body = await self._post("status", data)
        raw = body.get("check_status")
        if not isinstance(raw, (str, int)) or isinstance(raw, bool):
            raise _fail("status", "response carries no check_status")
        mapped = _CHECK_STATUS_MAP.get(str(raw))
        if mapped is None:
            # Numeric code only in the message — never the provider's
            # free-form text (it may quote request data).
            raise _fail("status", f"unexpected check_status code {_code(raw)}")
        return mapped

    async def _post(self, path: str, data: dict[str, str]) -> dict[str, Any]:
        """POST form data, return the parsed JSON body of an OK answer.

        Every failure mode normalizes to :class:`CallcheckProviderError`
        with a secret-free message; success is logged with the masked
        phone key, the check id and the call duration (§Логирование).
        """
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                transport=self._transport,
            ) as client:
                response = await client.post(path, data=data)
        except httpx.HTTPError as exc:
            raise _fail(path, "request failed (network/timeout)") from exc

        if not (200 <= response.status_code < 300):
            raise _fail(path, f"HTTP {response.status_code}")
        try:
            body: Any = response.json()
        except ValueError as exc:
            raise _fail(path, "malformed JSON body") from exc
        if not isinstance(body, dict):
            raise _fail(path, "response is not a JSON object")

        code = _code(body.get("status_code"))
        if code != 100:
            # The overall provider code ≠ 100 — a refused request
            # (bad key, bad phone format, quota…). Numeric only.
            raise _fail(path, f"provider code {code} != 100")

        duration_ms = (time.monotonic() - started) * 1000
        logger.info(
            "sms.ru callcheck %s ok: duration_ms=%.0f", path, duration_ms
        )
        return body


def _fail(path: str, reason: str) -> CallcheckProviderError:
    """Build the normalized provider error — ``path`` + ``reason`` only.

    The single construction point keeps the no-secrets guarantee
    auditable: nothing from the request (api key, phone, ip, check_id)
    may be interpolated here (§Клиент провайдера, US-7).
    """
    return CallcheckProviderError(f"sms.ru callcheck {path} failed: {reason}")
