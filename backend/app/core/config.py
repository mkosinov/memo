"""Application settings loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables."""

    DATABASE_URL: str = "sqlite+aiosqlite:///./memo.db"
    PROJECT_NAME: str = "Memo Backend"
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    LOG_LEVEL: str = "INFO"


settings = Settings()
