"""Application settings loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables."""

    DATABASE_URL: str = "sqlite+aiosqlite:///./memo.db"
