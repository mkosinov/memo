"""Settings.SECRET_KEY resolution (GH #247 spec §2.8).

Production must fail fast without an explicit SECRET_KEY; development and
testing fall back to the dev constant; an explicit key is never overridden.
"""

import pytest
from pydantic import ValidationError

from src.core.config import Settings

pytestmark = pytest.mark.misc


class TestSecretKeySettings:
    def test_production_empty_secret_key_fails_fast(self) -> None:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, ENV="production", SECRET_KEY="")

    @pytest.mark.parametrize("env", ["development", "testing"])
    def test_non_production_empty_secret_key_resolves_to_dev_constant(
        self, env: str
    ) -> None:
        s = Settings(_env_file=None, ENV=env, SECRET_KEY="")
        assert s.SECRET_KEY == "dev-sqladmin-secret"

    def test_explicit_secret_key_is_kept(self) -> None:
        # OTP_PEPPER is explicit only to satisfy the #499 fail-fast —
        # this test targets the SECRET_KEY validator, not the pepper.
        s = Settings(
            _env_file=None, ENV="production",
            SECRET_KEY="real-key", OTP_PEPPER="real-pepper",
        )
        assert s.SECRET_KEY == "real-key"
