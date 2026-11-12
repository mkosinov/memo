"""GH #593 Task 4 — ``POST /api/v1/auth/call/dev-done``: the dev imitation.

The ``dev_code`` analog for the call method (spec §Эндпоинты, дев-режим):
a route that fakes the client's call by flipping the check on the RESOLVED
dev transport (the Task 1 singleton — the imitation lives IN the transport,
never behind a separate flag). The double gate is the RESOLVER: the route
answers 404 unless ``get_callcheck_transport()`` returned the dev transport
(``CALLCHECK_TRANSPORT=dev`` AND the exact ``ENV == "development"`` — one
ENV gate is not enough, the ENV default IS development). Plus
``verify_origin``, the OTP-route posture.

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Эндпоинты (дев-режим)
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

import pytest

from src.core.config import settings
from tests.conftest import query_db

pytestmark = pytest.mark.api

PHONE = "+79995552255"
INITIATE_URL = "/api/v1/auth/call/initiate"
STATUS_URL = "/api/v1/auth/call/status"
DEV_DONE_URL = "/api/v1/auth/call/dev-done"

SET_COOKIE = "set-cookie"


@pytest.fixture(autouse=True)
def _clear_call_flow_state():
    """Isolate the module-level in-memory gate + debounce state between tests."""
    from src.auth import callcheck_gates as gates

    gates._COUNTERS.clear()
    gates._PHONES_PER_IP.clear()
    gates._GLOBAL = None
    gates._STATUS_DEBOUNCE.clear()
    yield
    gates._COUNTERS.clear()
    gates._PHONES_PER_IP.clear()
    gates._GLOBAL = None
    gates._STATUS_DEBOUNCE.clear()


@pytest.fixture
def dev_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    """The dev transport: exact ``ENV == "development"`` +
    ``CALLCHECK_TRANSPORT=dev`` — the resolver then hands out the REAL
    module-level dev singleton (no stub: dev-done must flip the same
    instance the initiate path wrote to)."""
    monkeypatch.setattr(settings, "ENV", "development")
    monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "dev")


@pytest.fixture
def pinned_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    """A concrete CORS list (the .env.test default is ``*`` — allow-all)."""
    monkeypatch.setattr(settings, "CORS_ORIGINS", ["http://localhost:3000"])


def _rewind_debounce(phone: str = PHONE) -> None:
    """Age the debounce entry out (see the status suite — production polls
    come every ~4 s, tests chain two provider polls inside 3 s)."""
    from datetime import timedelta

    from src.auth import callcheck_gates as gates

    last = gates._STATUS_DEBOUNCE.get(phone)
    if last is not None:
        gates._STATUS_DEBOUNCE[phone] = last - timedelta(seconds=3)


def _initiated_handle(client) -> str:
    resp = client.post(INITIATE_URL, json={"phone": PHONE})
    assert resp.status_code == 202, resp.text
    return resp.json()["handle"]


# ─── the double gate: 404 unless the RESOLVER returned the dev transport ──────


class TestDevDoneGate:
    def test_default_development_env_without_dev_selector_404(self, api_client) -> None:
        """The DoD case: settings defaults are ``ENV=development`` (the
        config default) with NO ``CALLCHECK_TRANSPORT=dev`` — the resolver
        returns None, the route answers 404."""
        assert settings.ENV == "development"  # the default, not a fixture
        assert settings.CALLCHECK_TRANSPORT == ""

        resp = api_client.post(DEV_DONE_URL, json={"handle": "deadbeef" * 4})

        assert resp.status_code == 404

    def test_dev_selector_outside_development_404(self, api_client, monkeypatch) -> None:
        monkeypatch.setattr(settings, "ENV", "testing")
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "dev")
        assert api_client.post(DEV_DONE_URL, json={"handle": "deadbeef" * 4}).status_code == 404

    def test_smsru_transport_404(self, api_client, monkeypatch) -> None:
        """A REAL (non-dev) transport is not an imitation surface — only
        the dev transport unlocks the route."""
        from pydantic import SecretStr

        monkeypatch.setattr(settings, "ENV", "development")
        monkeypatch.setattr(settings, "CALLCHECK_TRANSPORT", "smsru")
        monkeypatch.setattr(settings, "SMSRU_CALLCHECK_API_KEY", SecretStr("k"))
        assert api_client.post(DEV_DONE_URL, json={"handle": "deadbeef" * 4}).status_code == 404

    def test_unknown_handle_404(self, api_client, dev_transport) -> None:
        assert api_client.post(DEV_DONE_URL, json={"handle": "deadbeef" * 4}).status_code == 404


# ─── the imitation flow (US-1 shape, backend-level) ───────────────────────────


class TestDevDoneFlow:
    def test_initiate_dev_done_poll_confirmed(self, api_client, dev_transport) -> None:
        handle = _initiated_handle(api_client)

        # Before the call: the check is waiting.
        assert api_client.post(STATUS_URL, json={"handle": handle}).json() == {"status": "waiting"}

        _rewind_debounce()
        done = api_client.post(DEV_DONE_URL, json={"handle": handle})
        assert done.status_code == 204, done.text

        poll = api_client.post(STATUS_URL, json={"handle": handle})
        assert poll.status_code == 200, poll.text
        assert poll.json() == {"status": "confirmed"}
        assert SET_COOKIE in poll.headers
        assert api_client.get("/api/v1/my/client").status_code == 200

        rows = query_db(f"SELECT * FROM auth_calls WHERE phone = '{PHONE}'")
        assert rows[0]["status"] == "consumed"

    def test_extra_body_key_422(self, api_client, dev_transport) -> None:
        resp = api_client.post(DEV_DONE_URL, json={"handle": "deadbeef" * 4, "x": 1})
        assert resp.status_code == 422

    def test_empty_handle_422(self, api_client, dev_transport) -> None:
        assert api_client.post(DEV_DONE_URL, json={"handle": ""}).status_code == 422

    def test_foreign_origin_403(self, api_client, dev_transport, pinned_origins) -> None:
        handle = _initiated_handle(api_client)
        resp = api_client.post(
            DEV_DONE_URL,
            json={"handle": handle},
            headers={"Origin": "https://evil.example"},
        )
        assert resp.status_code == 403
