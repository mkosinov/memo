"""#593 Task 1 — callcheck wiring matrix + the fail-fast settings validator.

``get_callcheck_transport`` mirrors ``get_otp_transport`` (#499 §4.2):
settings are read at call time; ``""``/unknown → ``None`` (the method
is honestly off), ``dev`` resolves only under the exact
``ENV == "development"``, ``smsru`` builds the REAL client with the
configured key — availability flows through client construction, never
a bare env-var check (US-3: «smsru реально доходит до клиента, а не
отвечает вхолую»).

The settings validator (spec §Конфигурация) is fail-fast at startup:
``smsru`` + empty ``SMSRU_CALLCHECK_API_KEY`` → boot error; ``dev`` at
``ENV=production`` → boot error (the demo-seed principle).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Конфигурация,
§Клиент провайдера
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

import src.auth.smsru_client as smsru_module
from src.auth.callcheck_provider import (
    DevCallcheckProvider,
    get_callcheck_transport,
)
from src.core.config import Settings
from src.core.config import settings as global_settings

pytestmark = pytest.mark.pure_unit

API_KEY = "smsru-key-42"


# ─── resolver matrix: CALLCHECK_TRANSPORT × ENV ────────────────────────────────


@pytest.mark.parametrize(
    ("transport", "env", "resolved"),
    [
        # empty (the default) — fail-closed in EVERY environment
        ("", "development", None),
        ("", "testing", None),
        ("", "production", None),
        # unknown selector — a misconfiguration fails closed like empty
        ("carrier-pigeon", "development", None),
        ("carrier-pigeon", "production", None),
        # dev — the exact-ENV gate (staging/preview never fake checks)
        ("dev", "development", DevCallcheckProvider),
        ("dev", "testing", None),
        ("dev", "production", None),
        # smsru — the real client, any environment (the key demand is
        # the STARTUP validator's business, not the resolver's)
        ("smsru", "development", "SmsRuClient"),
        ("smsru", "production", "SmsRuClient"),
    ],
)
def test_resolver_matrix(
    transport: str, env: str, resolved: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from src.auth.smsru_client import SmsRuClient

    monkeypatch.setattr(global_settings, "CALLCHECK_TRANSPORT", transport)
    monkeypatch.setattr(global_settings, "ENV", env)
    monkeypatch.setattr(global_settings, "SMSRU_CALLCHECK_API_KEY", SecretStr(API_KEY))

    provider = get_callcheck_transport()
    if resolved is None:
        assert provider is None, f"{transport!r} @ ENV={env} must fail closed"
    elif resolved == "SmsRuClient":
        assert isinstance(provider, SmsRuClient)
    else:
        assert isinstance(provider, DevCallcheckProvider)


def test_smsru_resolution_builds_real_client_with_settings_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """US-3 «не вхолую»: the smsru branch constructs the provider client
    with the configured key — a spy on the client class proves the
    resolution genuinely reaches it."""

    constructed: list[SecretStr] = []

    class SpyClient:
        def __init__(self, *, api_id: SecretStr) -> None:
            constructed.append(api_id)

    monkeypatch.setattr(global_settings, "CALLCHECK_TRANSPORT", "smsru")
    monkeypatch.setattr(global_settings, "SMSRU_CALLCHECK_API_KEY", SecretStr(API_KEY))
    monkeypatch.setattr(smsru_module, "SmsRuClient", SpyClient)

    provider = get_callcheck_transport()

    assert isinstance(provider, SpyClient)
    assert constructed == [SecretStr(API_KEY)]
    assert constructed[0].get_secret_value() == API_KEY


def test_dev_resolution_is_a_stable_singleton(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The dev provider resolves to ONE instance — the Task 4 dev-done
    imitator must flip the same registry the initiate path wrote to."""
    monkeypatch.setattr(global_settings, "CALLCHECK_TRANSPORT", "dev")
    monkeypatch.setattr(global_settings, "ENV", "development")

    assert get_callcheck_transport() is get_callcheck_transport()


# ─── the fail-fast settings validator (spec §Конфигурация) ────────────────────


def _settings(**overrides: object) -> Settings:
    """A Settings instance isolated from the ambient environment.

    ``SECRET_KEY``/``OTP_PEPPER`` are pinned so a production-ENV probe
    fails on THE callcheck validator under test, not on the unrelated
    production secrets demand.
    """
    base: dict[str, object] = {
        "SECRET_KEY": "unit-test-key",
        "OTP_PEPPER": "unit-test-pepper",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_validator_smsru_with_empty_key_fails_fast() -> None:
    with pytest.raises(ValidationError) as excinfo:
        _settings(CALLCHECK_TRANSPORT="smsru", SMSRU_CALLCHECK_API_KEY=SecretStr(""))
    assert "SMSRU_CALLCHECK_API_KEY" in str(excinfo.value)


def test_validator_smsru_without_key_field_fails_fast() -> None:
    with pytest.raises(ValidationError) as excinfo:
        _settings(CALLCHECK_TRANSPORT="smsru")
    assert "SMSRU_CALLCHECK_API_KEY" in str(excinfo.value)


def test_validator_dev_in_production_fails_fast() -> None:
    with pytest.raises(ValidationError) as excinfo:
        _settings(ENV="production", CALLCHECK_TRANSPORT="dev")
    assert "CALLCHECK_TRANSPORT" in str(excinfo.value)


def test_validator_accepts_enabled_configurations() -> None:
    # smsru + a real key — the production shape.
    ok = _settings(
        ENV="production",
        CALLCHECK_TRANSPORT="smsru",
        SMSRU_CALLCHECK_API_KEY=SecretStr(API_KEY),
    )
    assert ok.CALLCHECK_TRANSPORT == "smsru"

    # dev in development — the local/e2e shape.
    ok_dev = _settings(ENV="development", CALLCHECK_TRANSPORT="dev")
    assert ok_dev.CALLCHECK_TRANSPORT == "dev"


def test_validator_allows_empty_selector_in_production() -> None:
    """The default (fail-closed, method off) boots everywhere — an empty
    transport selector is a VALID disabled configuration, not an error."""
    ok = _settings(ENV="production", CALLCHECK_TRANSPORT="")
    assert ok.CALLCHECK_TRANSPORT == ""
