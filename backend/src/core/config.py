"""Application settings loaded from environment variables."""

import os
from typing import Annotated
from urllib.parse import urlparse

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic_settings.sources import NoDecode


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables and .env files."""

    model_config = SettingsConfigDict(extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./memo.db"
    ENV: str = "development"
    PROJECT_NAME: str = "Memo Backend"
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
    ]
    LOG_LEVEL: str = "INFO"
    # GH #262 §3.4 — root of the ONLY file storage (avatars). Cwd-relative
    # like DATABASE_URL; public static serving roots at FILES_DIR/avatars.
    FILES_DIR: str = "./files"
    # Signs the sqladmin session cookie (GH #247 §2.8). API sessions are
    # random opaque tokens — no SECRET_KEY involved there.
    SECRET_KEY: str = ""
    # ── Notify subsystem (#482 part 1, spec §3.9; family #476 §4.5) ──────
    # Disabled by default: nothing boots until the stack opts in (the
    # dispatcher process arrives in part 2).
    NOTIFY_ENABLED: bool = False
    # Seconds; dispatcher journal-polling interval (spec §3.8).
    NOTIFY_POLL_INTERVAL: int = 1
    # CSV without spaces, case-insensitive; order = channel priority.
    NOTIFY_CHANNEL_PRIORITY: str = "telegram"
    # Seconds; a queued task older than this is re-enqueued (spec §3.8).
    NOTIFY_REENQUEUE_AFTER: int = 120
    # Transport endpoint for the notify queue — Redis Streams (part 2,
    # spec §3.3). Empty = transport not configured. SecretStr: the URL
    # carries credentials and must never surface in repr/logs/errors.
    REDIS_URL: SecretStr = ""
    # Wall-clock zone of the business — the single time interpretation
    # for the future/past predicate and message text (spec §3.2).
    # Explicit zone, never the server TZ (panel finding).
    BUSINESS_TIMEZONE: str = "Europe/Moscow"

    @model_validator(mode="after")
    def _force_notify_off_in_testing(self) -> "Settings":
        """The testing profile never runs the enabled notify subsystem
        (family #476 §3.3, US-7): a standard pytest pass must not require
        Redis. An accidental NOTIFY_ENABLED=true is forced off."""
        if self.ENV == "testing" and self.NOTIFY_ENABLED:
            self.NOTIFY_ENABLED = False
        return self

    @model_validator(mode="after")
    def _resolve_secret_key(self) -> "Settings":
        """Production fails fast on an empty SECRET_KEY; otherwise an empty
        value resolves to the fixed dev constant (stable across dev
        restarts — random-per-boot was rejected as a footgun, §2.8)."""
        if self.ENV == "production" and not self.SECRET_KEY:
            raise ValueError(
                "SECRET_KEY must be set when ENV=production "
                "(it signs the sqladmin session cookie)"
            )
        if not self.SECRET_KEY:
            self.SECRET_KEY = "dev-sqladmin-secret"
        return self

    @model_validator(mode="after")
    def _require_redis_url_in_production(self) -> "Settings":
        """An enabled production notify subsystem demands an authenticated
        TLS transport: ``rediss://`` with credentials (GH #483 spec §3.3 —
        unencrypted and unauthenticated are rejected alike). Error
        messages state the requirement only — never the URL value."""
        if self.ENV != "production" or not self.NOTIFY_ENABLED:
            return self
        url = self.REDIS_URL.get_secret_value()
        if not url:
            raise ValueError(
                "REDIS_URL must be set when ENV=production and "
                "NOTIFY_ENABLED=true (notify transport not configured)"
            )
        parsed = urlparse(url)
        if parsed.scheme != "rediss":
            raise ValueError(
                "REDIS_URL must use rediss:// (TLS) when ENV=production "
                "and NOTIFY_ENABLED=true"
            )
        if not (parsed.username or parsed.password):
            raise ValueError(
                "REDIS_URL must include credentials when ENV=production "
                "and NOTIFY_ENABLED=true"
            )
        return self

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: object) -> object:
        """Parse CORS_ORIGINS from a comma-separated string or ``"*"``."""
        if isinstance(v, str):
            if v == "*":
                return ["*"]
            return [origin.strip() for origin in v.split(",")]
        return v


_env_file = os.environ.get("ENV_FILE")
# ``_env_file`` is a real pydantic-settings constructor parameter (it picks
# the dotenv source at instantiation time; the class-level ``env_file`` in
# SettingsConfigDict would hard-code it), but mypy does not see it — the
# BaseSettings __init__ signature is invisible to the checker. Known
# upstream limitation; the runtime kwarg is documented by pydantic-settings.
settings = Settings(_env_file=_env_file)  # type: ignore[call-arg]
