"""#593 Task 1 — the SmsRuClient contract (sms.ru callcheck) on MockTransport.

The provider-specific half of the ``CallcheckProvider`` seam (spec §Клиент
провайдера; research ``docs/research/2026-11-11-smsru-callcheck-api.md``):

- ``create`` — form body carries ``api_id``, ``phone`` WITHOUT the ``+``
  (canonical ``+7…`` → API ``7…``), the client ``ip`` (roaming 8-800
  substitution) and ``json=1``; the number to call arrives as
  ``call_phone`` OR ``call_number`` (PHP example vs JSON spec — the
  docs disagree) and is normalized to the canonical client form with
  the leading ``+`` (some operators reject the plus-less form,
  especially from abroad); ``window_seconds`` is the CLIENT constant
  (the ``add`` response carries no time field);
- ``status`` — ``check_status`` 100/400 → waiting, 401 → confirmed,
  402 → expired (string or number — the docs are inconsistent); any
  other code is a provider failure;
- ANY failure — HTTP ≠ 2xx, ``status_code`` ≠ 100, timeout, network,
  malformed body — raises ``CallcheckProviderError``; the message NEVER
  carries the request body or the api key (§Клиент провайдера).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Клиент провайдера
Research: docs/research/2026-11-11-smsru-callcheck-api.md
"""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
from pydantic import SecretStr

from src.auth.callcheck_provider import (
    CALLCHECK_WINDOW_SECONDS,
    CallcheckProviderError,
    CallcheckStatus,
    CheckCreated,
)
from src.auth.smsru_client import SmsRuClient

pytestmark = pytest.mark.pure_unit

API_KEY = "test-api-key-123"
PHONE = "+79995552233"
PHONE_API_FORM = "79995552233"  # canonical → the API form, no "+"
IP = "203.0.113.10"
CHECK_ID = "201737-542"

# The research-doc citation of a successful ``add`` response.
ADD_OK = {
    "status": "OK",
    "status_code": 100,
    "check_id": CHECK_ID,
    "call_phone": "78005008275",
    "call_phone_pretty": "+7 (800) 500-8275",
}


def _form_of(request: httpx.Request) -> dict[str, str]:
    """The form-encoded request body as a flat dict."""
    return {k: v[0] for k, v in parse_qs(request.read().decode()).items()}


def make_client(handler: httpx.MockTransport) -> SmsRuClient:
    return SmsRuClient(api_id=SecretStr(API_KEY), transport=handler)


def recording(responder: Any) -> tuple[list[httpx.Request], Any]:
    """A MockTransport handler that records requests it serves."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result = responder(request)
        if isinstance(result, Exception):
            raise result
        return result

    return seen, httpx.MockTransport(handler)


def json_response(payload: dict[str, Any], status_code: int = 200) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


# ─── create: the request side ──────────────────────────────────────────────────


class TestCreateRequest:
    async def test_form_body_carries_api_id_phone_ip_json(self) -> None:
        seen, transport = recording(lambda _req: json_response(ADD_OK))
        client = make_client(transport)

        created = await client.create(PHONE, IP)

        assert isinstance(created, CheckCreated)
        assert len(seen) == 1
        request = seen[0]
        assert request.url.scheme == "https"
        assert request.url.host == "sms.ru"
        assert str(request.url.path) == "/callcheck/add"
        assert _form_of(request) == {
            "api_id": API_KEY,
            "phone": PHONE_API_FORM,
            "ip": IP,
            "json": "1",
        }

    async def test_ip_omitted_when_none(self) -> None:
        seen, transport = recording(lambda _req: json_response(ADD_OK))
        client = make_client(transport)

        await client.create(PHONE, None)

        body = _form_of(seen[0])
        assert "ip" not in body
        assert body["phone"] == PHONE_API_FORM


# ─── create: the response side ─────────────────────────────────────────────────


class TestCreateResponse:
    async def test_ok_response(self) -> None:
        _, transport = recording(lambda _req: json_response(ADD_OK))
        created = await make_client(transport).create(PHONE, IP)

        assert created.check_id == CHECK_ID
        # The client-facing number is canonical WITH the "+" — the
        # provider returns bare digits.
        assert created.call_phone == "+78005008275"

    async def test_call_number_field_accepted(self) -> None:
        """The PHP example reads ``call_number`` — the client tolerates
        both field names (research: inconsistent docs)."""
        payload = {
            "status": "OK",
            "status_code": 100,
            "check_id": CHECK_ID,
            "call_number": "78005008275",
        }
        _, transport = recording(lambda _req: json_response(payload))
        created = await make_client(transport).create(PHONE, IP)

        assert created.call_phone == "+78005008275"
        assert created.check_id == CHECK_ID

    async def test_status_code_as_string_accepted(self) -> None:
        """Error/ok codes arrive as string or number — tolerate both."""
        payload = {**ADD_OK, "status_code": "100"}
        _, transport = recording(lambda _req: json_response(payload))
        created = await make_client(transport).create(PHONE, IP)

        assert created.check_id == CHECK_ID

    async def test_window_is_the_client_constant(self) -> None:
        """The ``add`` response carries NO time field — the window is
        the client-side constant, never parsed from the response."""
        assert "time" not in ADD_OK and "expires" not in ADD_OK
        _, transport = recording(lambda _req: json_response(ADD_OK))
        created = await make_client(transport).create(PHONE, IP)

        assert created.window_seconds == 300
        assert created.window_seconds == CALLCHECK_WINDOW_SECONDS


# ─── create: failures ──────────────────────────────────────────────────────────


class TestCreateFailures:
    async def test_error_code_202_raises(self) -> None:
        """202 = invalid phone format — an anomaly after our validation;
        any code ≠ 100 is a provider failure."""
        payload = {"status": "ERROR", "status_code": 202}
        _, transport = recording(lambda _req: json_response(payload))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)

    async def test_error_code_as_string_raises(self) -> None:
        payload = {"status": "ERROR", "status_code": "300"}
        _, transport = recording(lambda _req: json_response(payload))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)

    async def test_http_500_raises(self) -> None:
        _, transport = recording(lambda _req: json_response({}, status_code=500))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)

    async def test_garbage_body_raises(self) -> None:
        _, transport = recording(lambda _req: httpx.Response(200, text="not json"))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)

    async def test_missing_call_number_raises(self) -> None:
        payload = {"status": "OK", "status_code": 100, "check_id": CHECK_ID}
        _, transport = recording(lambda _req: json_response(payload))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)

    async def test_missing_check_id_raises(self) -> None:
        payload = {"status": "OK", "status_code": 100, "call_phone": "78005008275"}
        _, transport = recording(lambda _req: json_response(payload))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)

    async def test_timeout_raises(self) -> None:
        _, transport = recording(lambda _req: httpx.ConnectTimeout("timed out"))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)

    async def test_network_error_raises(self) -> None:
        _, transport = recording(lambda _req: httpx.ConnectError("refused"))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).create(PHONE, IP)


# ─── status: mapping + request side ────────────────────────────────────────────


class TestStatus:
    @pytest.mark.parametrize(
        ("check_status", "expected"),
        [
            ("100", CallcheckStatus.WAITING),
            ("400", CallcheckStatus.WAITING),
            ("401", CallcheckStatus.CONFIRMED),
            ("402", CallcheckStatus.EXPIRED),
            (100, CallcheckStatus.WAITING),
            (400, CallcheckStatus.WAITING),
            (401, CallcheckStatus.CONFIRMED),
            (402, CallcheckStatus.EXPIRED),
        ],
    )
    async def test_check_status_mapping(
        self, check_status: str | int, expected: CallcheckStatus
    ) -> None:
        payload = {"status": "OK", "status_code": 100, "check_status": check_status}
        _, transport = recording(lambda _req: json_response(payload))

        assert await make_client(transport).status(CHECK_ID) is expected

    async def test_form_body_carries_api_id_check_id_json(self) -> None:
        seen, transport = recording(
            lambda _req: json_response(
                {"status": "OK", "status_code": 100, "check_status": 400}
            )
        )
        await make_client(transport).status(CHECK_ID)

        request = seen[0]
        assert str(request.url.path) == "/callcheck/status"
        assert _form_of(request) == {
            "api_id": API_KEY,
            "check_id": CHECK_ID,
            "json": "1",
        }

    async def test_unknown_check_status_raises(self) -> None:
        payload = {"status": "OK", "status_code": 100, "check_status": 500}
        _, transport = recording(lambda _req: json_response(payload))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).status(CHECK_ID)

    async def test_overall_code_not_100_raises(self) -> None:
        payload = {"status": "ERROR", "status_code": 301}
        _, transport = recording(lambda _req: json_response(payload))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).status(CHECK_ID)

    async def test_http_error_raises(self) -> None:
        _, transport = recording(lambda _req: json_response({}, status_code=502))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).status(CHECK_ID)

    async def test_timeout_raises(self) -> None:
        _, transport = recording(lambda _req: httpx.ReadTimeout("timed out"))
        with pytest.raises(CallcheckProviderError):
            await make_client(transport).status(CHECK_ID)


# ─── error hygiene: no key, no request body in messages ───────────────────────


class TestErrorHygiene:
    @pytest.mark.parametrize(
        "responder",
        [
            lambda _req: json_response({"status": "ERROR", "status_code": 202}),
            lambda _req: json_response({"status": "ERROR", "status_code": "401"}),
            lambda _req: json_response({}, status_code=500),
            lambda _req: httpx.Response(200, text="<html>oops</html>"),
            lambda _req: httpx.ConnectTimeout("timed out"),
        ],
        ids=["code202", "code401-str", "http500", "garbage", "timeout"],
    )
    async def test_error_message_carries_no_key_or_request_body(
        self, responder: Any
    ) -> None:
        _, transport = recording(responder)
        client = make_client(transport)

        for call in (client.create(PHONE, IP), client.status(CHECK_ID)):
            with pytest.raises(CallcheckProviderError) as excinfo:
                await call
            text = str(excinfo.value)
            assert API_KEY not in text, f"api key leaked: {text}"
            assert PHONE_API_FORM not in text and PHONE not in text, (
                f"request phone leaked: {text}"
            )
            assert IP not in text, f"client ip leaked: {text}"
