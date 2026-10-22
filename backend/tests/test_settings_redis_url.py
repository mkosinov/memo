"""Settings.REDIS_URL (GH #483 spec §3.3).

Empty by default (transport not configured). The production gate
(ENV=production + NOTIFY_ENABLED=true) demands a ``rediss://`` URL with
credentials — unencrypted and unauthenticated transports are rejected
alike. The URL is an application secret: the field is SecretStr, so the
value never shows up in ``repr()`` or in validation-error texts.
"""

import pytest
from pydantic import ValidationError

from src.core.config import Settings

pytestmark = pytest.mark.pure_unit

_SECRET = "s3cret-redis-pass"  # probe value for non-disclosure checks


class TestRedisUrlDefault:
    def test_default_is_empty(self) -> None:
        s = Settings(_env_file=None)
        assert s.REDIS_URL.get_secret_value() == ""


class TestProductionGate:
    """Spec §3.3: enabled production runs require authenticated TLS."""

    def test_empty_url_fails(self) -> None:
        with pytest.raises(ValidationError):
            Settings(
                _env_file=None,
                ENV="production",
                SECRET_KEY="test-secret-key",
                OTP_PEPPER="test-otp-pepper",
                NOTIFY_ENABLED=True,
                REDIS_URL="",
            )

    def test_unencrypted_url_with_credentials_fails(self) -> None:
        with pytest.raises(ValidationError):
            Settings(
                _env_file=None,
                ENV="production",
                SECRET_KEY="test-secret-key",
                OTP_PEPPER="test-otp-pepper",
                NOTIFY_ENABLED=True,
                REDIS_URL=f"redis://default:{_SECRET}@localhost:6379/0",
            )

    def test_tls_url_without_credentials_fails(self) -> None:
        with pytest.raises(ValidationError):
            Settings(
                _env_file=None,
                ENV="production",
                SECRET_KEY="test-secret-key",
                OTP_PEPPER="test-otp-pepper",
                NOTIFY_ENABLED=True,
                REDIS_URL="rediss://localhost:6379/0",
            )

    def test_tls_url_with_credentials_passes(self) -> None:
        url = f"rediss://default:{_SECRET}@localhost:6379/0"
        s = Settings(
            _env_file=None,
            ENV="production",
            SECRET_KEY="test-secret-key",
            OTP_PEPPER="test-otp-pepper",
            NOTIFY_ENABLED=True,
            REDIS_URL=url,
        )
        assert s.REDIS_URL.get_secret_value() == url

    def test_gate_applies_only_when_notify_enabled(self) -> None:
        s = Settings(
            _env_file=None,
            ENV="production",
            SECRET_KEY="test-secret-key",
            OTP_PEPPER="test-otp-pepper",
            NOTIFY_ENABLED=False,
            REDIS_URL="",
        )
        assert s.REDIS_URL.get_secret_value() == ""


class TestSecretNotDisclosed:
    """Spec §3.3: the URL never leaks through repr or validation errors."""

    def test_repr_does_not_contain_url_value(self) -> None:
        s = Settings(
            _env_file=None,
            REDIS_URL=f"rediss://default:{_SECRET}@localhost:6379/0",
        )
        assert _SECRET not in repr(s)

    def test_validation_error_does_not_reveal_input(self) -> None:
        with pytest.raises(ValidationError) as excinfo:
            Settings(
                _env_file=None,
                ENV="production",
                SECRET_KEY="test-secret-key",
                OTP_PEPPER="test-otp-pepper",
                NOTIFY_ENABLED=True,
                REDIS_URL=f"redis://default:{_SECRET}@localhost:6379/0",
            )
        assert _SECRET not in str(excinfo.value)
