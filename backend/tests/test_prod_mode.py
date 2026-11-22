"""GH #616 Task 1 — prod-mode app hardening unit tests.

Spec (docs/specs/2026-11-21-prod-deploy-616-design.md):

§3.3 — ``ENV`` is a closed set ``Literal["development","testing",
 "production"]``: an unknown value (a typo like ``prod``, a stray space)
 must refuse STARTUP instead of silently disabling every production
 guard that compares ``ENV == "production"``. Pydantic validation of the
 module-level ``Settings`` instantiation is that refusal.

§3.2 — the SQLite engine setup pins ``journal_mode=WAL`` and
 ``busy_timeout`` on every new DBAPI connection (the class-level Engine
 ``connect`` listener in ``src/db/database.py``), so the pragmas hold on
 the prod volume. These tests PIN the already-implemented behavior —
 a regression here must fail the suite.
"""

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, text

from src.core.config import Settings

pytestmark = pytest.mark.misc

# Secrets are pinned so the ONLY failure mode under test is the ENV
# literal validation, never the production SECRET_KEY/OTP_PEPPER
# fail-fast validators.
_PROD_SECRETS = {"SECRET_KEY": "k", "OTP_PEPPER": "p"}


class TestEnvLiteralValidation:
    """§3.3 — the ENV contract is a closed Literal, not a free string."""

    @pytest.mark.parametrize("env", ["development", "testing", "production"])
    def test_known_env_values_accepted(self, env: str) -> None:
        s = Settings(_env_file=None, ENV=env, **_PROD_SECRETS)
        assert env == s.ENV

    @pytest.mark.parametrize(
        "env",
        [
            "prod",  # the typo from the spec — silently disabled all guards
            " production ",  # stray whitespace
            "Production",  # case drift
            "staging",  # not a mode; staging deploys set ENV=production
            "",  # empty
        ],
    )
    def test_unknown_env_value_refuses_startup(self, env: str) -> None:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, ENV=env, **_PROD_SECRETS)


class TestProdSecretsFailFast:
    """§3.3 / §7 scenario 4 — ENV=production demands explicit secrets.

    The prod smoke (scripts/prod-smoke.sh --no-secrets) asserts the IMAGE
    refuses to boot without them; these are the unit-level twin of that
    container-level refusal.
    """

    def test_prod_without_secret_key_refuses_startup(self) -> None:
        with pytest.raises(
            ValidationError, match="SECRET_KEY must be set when ENV=production"
        ):
            Settings(_env_file=None, ENV="production", OTP_PEPPER="p")

    def test_prod_without_otp_pepper_refuses_startup(self) -> None:
        with pytest.raises(
            ValidationError, match="OTP_PEPPER must be set when ENV=production"
        ):
            Settings(_env_file=None, ENV="production", SECRET_KEY="k")

    def test_prod_with_both_secrets_accepted(self) -> None:
        s = Settings(_env_file=None, ENV="production", **_PROD_SECRETS)
        assert s.SECRET_KEY == "k"
        assert s.OTP_PEPPER == "p"

    @pytest.mark.parametrize("env", ["development", "testing"])
    def test_non_prod_envs_keep_dev_defaults(self, env: str) -> None:
        """No DX change outside production: unset secrets resolve to the
        fixed dev constants, not a validation error."""
        s = Settings(_env_file=None, ENV=env)
        assert s.SECRET_KEY == "dev-sqladmin-secret"
        assert s.OTP_PEPPER == "dev-otp-pepper"


class TestSqlitePragmas:
    """§3.2 — regression pins for the WAL + busy_timeout engine setup."""

    def test_sync_engine_pins_wal_and_busy_timeout(self, tmp_path) -> None:
        """Every new SQLite connection through SQLAlchemy carries the
        pragmas (covers Alembic's and sqladmin's sync engines)."""
        engine = create_engine(f"sqlite:///{tmp_path / 'pragma_sync.db'}")
        try:
            with engine.connect() as conn:
                journal = conn.execute(text("PRAGMA journal_mode")).scalar_one()
                timeout = conn.execute(text("PRAGMA busy_timeout")).scalar_one()
        finally:
            engine.dispose()
        assert journal == "wal"
        assert timeout == 5000

    async def test_async_engine_pins_wal_and_busy_timeout(self, tmp_path) -> None:
        """The app's real engine type (aiosqlite) goes through the same
        class-level connect listener — pinned separately."""
        from sqlalchemy.ext.asyncio import create_async_engine

        engine = create_async_engine(
            f"sqlite+aiosqlite:///{tmp_path / 'pragma_async.db'}"
        )
        try:
            async with engine.connect() as conn:
                journal = (await conn.execute(text("PRAGMA journal_mode"))).scalar_one()
                timeout = (await conn.execute(text("PRAGMA busy_timeout"))).scalar_one()
        finally:
            await engine.dispose()
        assert journal == "wal"
        assert timeout == 5000
