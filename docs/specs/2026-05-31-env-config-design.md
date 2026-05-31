# Multi-Environment Configuration Design

> Date: 2026-05-31
> Status: Design (pre-implementation)
> Related: `backend/src/core/config.py`, `backend/tests/conftest.py`, `dev.sh`, `.gitignore`

## 1. Problem

Currently the backend (FastAPI) uses a `Settings` class with pydantic-settings, but without loading any `.env` files. Configuration is set only through `os.environ` or hardcoded defaults. This leads to:

- **No environment separation** — dev, test, and production share the same defaults
- **CORS issue** — `CORS_ORIGINS=*` must be set manually every time the dev environment starts
- **Tests use monkeypatch** instead of an isolated config
- **No documentation** — which env vars exist and what they do is unclear

## 2. Solution: ENV_FILE-based multi-env config

### 2.1. File structure

```
backend/
├── .env.example        ✅ committed — template with all variables
├── .env.dev            ✅ committed — dev configuration
├── .env.test           ✅ committed — test configuration
├── .env                ❌ gitignored — production
```

### 2.2. How it works

- The environment is selected via the `ENV_FILE` environment variable
- `Settings` reads `ENV_FILE` from `os.environ` when creating the singleton
- If `ENV_FILE` is not set — reads `.env` (production default)
- If the specified file is not found — no error, Settings falls back to `os.environ`

### 2.3. Priority order (lowest → highest)

1. Code defaults (`DATABASE_URL: str = "sqlite+aiosqlite:///./memo.db"`)
2. Values from `.env` / `.env.dev` / `.env.test` (depends on `ENV_FILE`)
3. `os.environ` (highest priority)

This means conftest can override `DATABASE_URL` via `os.environ`, and it will take precedence over the value from `.env.test`.

## 3. Code Changes

### 3.1. `backend/src/core/config.py`

```python
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
    ]
    LOG_LEVEL: str = "INFO"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: object) -> object:
        """Parse CORS_ORIGINS from a comma-separated string or ``\"*\"``."""
        if isinstance(v, str):
            if v == "*":
                return ["*"]
            return [origin.strip() for origin in v.split(",")]
        return v


_env_file = os.environ.get("ENV_FILE")
settings = Settings(_env_file=_env_file)
```

### 3.2. `backend/.env.example`

```bash
# ═══════════════════════════════════════════
# Memo Backend — Configuration Template
# ═══════════════════════════════════════════
# Copy to .env for production, or use
# .env.dev / .env.test for other environments.
# ───────────────────────────────────────────
# Usage:
#   ENV_FILE=.env.dev  uv run uvicorn ...
#   ENV_FILE=.env.test pytest

# String — SQLAlchemy async database URL
# Default: sqlite+aiosqlite:///./memo.db
# Example: postgresql+asyncpg://user:pass@host/db
DATABASE_URL=sqlite+aiosqlite:///./memo.db

# String — Application name (used in OpenAPI docs)
PROJECT_NAME=Memo Backend

# Comma-separated list or "*" — CORS allowed origins
# "*" allows all origins (dev only)
# Examples:
#   http://localhost:3000,http://127.0.0.1:3000
#   *
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# String — Logging level: DEBUG, INFO, WARNING, ERROR
LOG_LEVEL=INFO
```

### 3.3. `backend/.env.dev`

```bash
DATABASE_URL=sqlite+aiosqlite:///./memo.db
PROJECT_NAME=Memo Backend (Dev)
CORS_ORIGINS=*
LOG_LEVEL=DEBUG
```

### 3.4. `backend/.env.test`

```bash
DATABASE_URL=sqlite+aiosqlite:///./test_memo.db
PROJECT_NAME=Memo Backend (Test)
CORS_ORIGINS=*
LOG_LEVEL=DEBUG
```

### 3.5. `backend/tests/conftest.py`

Add:
```python
os.environ["ENV_FILE"] = ".env.test"
```

The existing `os.environ["DATABASE_URL"] = ...` line stays — it overrides the value from `.env.test`.

### 3.6. `dev.sh`

Add before starting the backend:
```bash
export ENV_FILE=.env.dev
```

Full fragment:
```bash
# Start backend (FastAPI) on :8000
export ENV_FILE=.env.dev
(cd "$BACKEND_DIR" && uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload) &
```

### 3.7. `.gitignore` (root)

Ensure that `.env.dev`, `.env.test`, `.env.example` are NOT ignored.
The current rules already handle this correctly — they only ignore `.env`, `.env.local`, `.env.production`, and `.env*.local`. The new files do not match these patterns.

No changes required.

## 4. Migration of Existing Code

### 4.1. What does NOT change (works without changes)

- All existing tests (including those using `monkeypatch`)
- `os.environ["DATABASE_URL"]` in conftest (highest priority)
- Manual startup via `DATABASE_URL=... CORS_ORIGINS=... uv run uvicorn ...`

### 4.2. Test refactoring (optional, can be done later)

The `test_cors_env_override` test in `tests/test_cors.py` can be simplified:
```python
def test_cors_env_override(self, monkeypatch):
    """CORS_ORIGINS from .env.test are loaded correctly."""
    # Before: monkeypatch.setenv + monkeypatch.setattr
    # After: Settings(_env_file=".env.test") directly
    from src.core.config import Settings
    s = Settings(_env_file=".env.test")
    assert s.CORS_ORIGINS == ["*"]
```

This is not required now — the old test continues to work.

## 5. Acceptance Criteria

- [ ] `Settings` class loads the `.env` file specified by the `ENV_FILE` env var
- [ ] `.env.dev` created, committed, contains dev settings (CORS=*, LOG_LEVEL=DEBUG)
- [ ] `.env.test` created, committed, contains test settings
- [ ] `.env.example` created, committed, contains documentation for all variables
- [ ] `conftest.py` sets `ENV_FILE=.env.test`
- [ ] `dev.sh` exports `ENV_FILE=.env.dev`
- [ ] All existing tests pass
- [ ] With `ENV_FILE=.env.dev curl -H "Origin: http://x.x.x.x:3000" ...` — 200 OK (CORS works)
- [ ] Without `ENV_FILE` — reads `.env` (production behavior)

## 6. Visual Compliance Checks

N/A — configuration has no UI.

## 7. Open Questions

- Should `.env.local` be added for personal overrides? **Resolved: not needed.**
- Should `.env.production` exist separately? **Resolved: no, `.env` = production.**
