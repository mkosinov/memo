"""Application settings loaded from environment variables."""

import os
from typing import Annotated

from pydantic import field_validator, model_validator
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
    # Signs the sqladmin session cookie (GH #247 §2.8). API sessions are
    # random opaque tokens — no SECRET_KEY involved there.
    SECRET_KEY: str = ""

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
settings = Settings(_env_file=_env_file)
