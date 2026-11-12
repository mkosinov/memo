"""#593 Task 1 — the client-auth method registry: ``GET /api/v1/auth/methods``.

The PUBLIC registry endpoint (spec §Реестр, US-3 backend half): the one
source the frontend picker builds from. ``available`` = the transport
RESOLVER returned an object — never «the env var is non-empty»: a
method whose transport is off, environment-gated (``dev`` outside
development) or misconfigured (unknown selector) is honestly listed as
unavailable, so the picker never offers a method whose endpoints would
answer 503.

The matrix: ``OTP_TRANSPORT`` × ``CALLCHECK_TRANSPORT`` × ``ENV``
(``sms_otp`` follows the #499/#586 seam — when #586 lands a production
transport the flag starts answering true through the same resolver,
with no registry change).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Реестр
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

import pytest
from pydantic import SecretStr

import src.auth.smsru_client as smsru_module
from src.core.config import settings

pytestmark = pytest.mark.api

METHODS_URL = "/api/v1/auth/methods"


def _methods(client) -> dict[str, bool]:
    resp = client.get(METHODS_URL)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list)
    return {entry["id"]: entry["available"] for entry in body}


@pytest.fixture(autouse=True)
def _callcheck_defaults(monkeypatch: pytest.MonkeyPatch):
    """Pin both selectors to the disabled default — .env.test drift or a
    monkeypatched sibling test must not leak into the matrix."""
    monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "")
    monkeypatch.setattr(settings, "SMSRU_CALLCHECK_API_KEY", SecretStr(""))
    monkeypatch.setattr(settings, "OTP_TRANSPORT", "")
    monkeypatch.setattr(settings, "ENV", "development")


class TestMethodsShape:
    def test_both_methods_listed_with_availability_flags(self, api_client) -> None:
        resp = api_client.get(METHODS_URL)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [(e["id"], e["available"]) for e in body] == [
            ("sms_otp", False),
            ("call", False),
        ], "every entry carries exactly id + available"


class TestRegistryMatrix:
    def test_both_off_by_default(self, api_client) -> None:
        assert _methods(api_client) == {"sms_otp": False, "call": False}

    def test_sms_otp_dev_in_development(self, api_client, monkeypatch) -> None:
        monkeypatch.setattr(settings, "OTP_TRANSPORT", "dev")
        monkeypatch.setattr(settings, "ENV", "development")
        assert _methods(api_client) == {"sms_otp": True, "call": False}

    def test_sms_otp_dev_outside_development_is_off(
        self, api_client, monkeypatch
    ) -> None:
        """US-3: ``dev`` outside development resolves to None → the flag
        is honest false, the picker hides the method."""
        monkeypatch.setattr(settings, "OTP_TRANSPORT", "dev")
        monkeypatch.setattr(settings, "ENV", "testing")
        assert _methods(api_client) == {"sms_otp": False, "call": False}

    def test_call_dev_in_development(self, api_client, monkeypatch) -> None:
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "dev")
        monkeypatch.setattr(settings, "ENV", "development")
        assert _methods(api_client) == {"sms_otp": False, "call": True}

    def test_call_dev_outside_development_is_off(
        self, api_client, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "dev")
        monkeypatch.setattr(settings, "ENV", "testing")
        assert _methods(api_client) == {"sms_otp": False, "call": False}

    def test_call_unknown_selector_is_off(self, api_client, monkeypatch) -> None:
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "carrier-pigeon")
        assert _methods(api_client) == {"sms_otp": False, "call": False}

    def test_call_smsru_with_key(self, api_client, monkeypatch) -> None:
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "smsru")
        monkeypatch.setattr(
            settings, "SMSRU_CALLCHECK_API_KEY", SecretStr("registry-key")
        )
        assert _methods(api_client) == {"sms_otp": False, "call": True}

    def test_both_transports_dev_development(self, api_client, monkeypatch) -> None:
        monkeypatch.setattr(settings, "OTP_TRANSPORT", "dev")
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "dev")
        monkeypatch.setattr(settings, "ENV", "development")
        assert _methods(api_client) == {"sms_otp": True, "call": True}


class TestSmsruNotHollow:
    def test_call_availability_flows_through_real_client_construction(
        self, api_client, monkeypatch
    ) -> None:
        """US-3 «smsru реально доходит до клиента, а не отвечает вхолую»:
        under the ``smsru`` selector the flag is true BECAUSE the
        resolver constructed the provider client — a spy proves the
        endpoint's availability answer rides on that construction."""

        constructed: list[SecretStr] = []

        class SpyClient:
            def __init__(self, *, api_id: SecretStr) -> None:
                constructed.append(api_id)

        monkeypatch.setattr(smsru_module, "SmsRuClient", SpyClient)
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "smsru")
        monkeypatch.setattr(
            settings, "SMSRU_CALLCHECK_API_KEY", SecretStr("registry-key")
        )

        assert _methods(api_client) == {"sms_otp": False, "call": True}
        assert len(constructed) == 1, (
            "availability must come from the resolver building the client"
        )
