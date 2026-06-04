"""Application settings loaded from environment variables."""

import os
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic_settings.sources import NoDecode


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables and .env files."""

    model_config = SettingsConfigDict(extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./memo.db"
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
