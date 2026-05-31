# Multi-Environment Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.env`-based multi-environment configuration to the backend (FastAPI), so dev, test, and prod each use their own config file selected via `ENV_FILE` env var.

**Architecture:** The `Settings` class (pydantic-settings) loads no `env_file` by default; the caller provides `_env_file` based on `ENV_FILE` env var. Three `.env.*` files are committed (`.env.dev`, `.env.test`, `.env.example`), `.env` is production and gitignored.

**Tech Stack:** Python 3.13, FastAPI, pydantic-settings >= 2.6

---
## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/.env.example` | **Create** | Template documenting all env vars |
| `backend/.env.dev` | **Create** | Dev defaults (CORS=*, DEBUG logging) |
| `backend/.env.test` | **Create** | Test defaults (CORS=*, isolated DB) |
| `backend/src/core/config.py` | **Modify** | Add model_config + ENV_FILE loading |
| `backend/tests/conftest.py` | **Modify** | Set ENV_FILE=.env.test |
| `dev.sh` | **Modify** | Export ENV_FILE=.env.dev |

## Task 1: Create .env files

**Classification:** Small (3 files, simple content)

**Files to create:**
- `backend/.env.example`
- `backend/.env.dev`
- `backend/.env.test`

**Steps:**

- [ ] Create `backend/.env.example`:
  ```
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

- [ ] Create `backend/.env.dev`:
  ```
  DATABASE_URL=sqlite+aiosqlite:///./memo.db
  PROJECT_NAME=Memo Backend (Dev)
  CORS_ORIGINS=*
  LOG_LEVEL=DEBUG
  ```

- [ ] Create `backend/.env.test`:
  ```
  DATABASE_URL=sqlite+aiosqlite:///./test_memo.db
  PROJECT_NAME=Memo Backend (Test)
  CORS_ORIGINS=*
  LOG_LEVEL=DEBUG
  ```

- [ ] Verify git status — all 3 files are tracked (not ignored)

## Task 2: Update config.py — add ENV_FILE loading

**Classification:** Small (1 file, <20 lines changed)

**File:** `backend/src/core/config.py`

- [ ] Add `import os` at the top
- [ ] Add `from pydantic_settings import SettingsConfigDict` (replacing `BaseSettings`)
- [ ] Add `model_config = SettingsConfigDict(extra="ignore")` inside the `Settings` class
- [ ] Change the module-level singleton from:
  ```python
  settings = Settings()
  ```
  to:
  ```python
  _env_file = os.environ.get("ENV_FILE")
  settings = Settings(_env_file=_env_file)
  ```

- [ ] Run test to verify: `cd backend && uv run pytest tests/test_cors.py tests/test_main.py -v`
- [ ] Expected: 5 tests pass (4 CORS + 1 test_main)

## Task 3: Update conftest.py — set ENV_FILE for tests

**Classification:** Trivial (1 file, 1 line added)

**File:** `backend/tests/conftest.py`

- [ ] Add the following at module level, right after existing env var setup:
  ```python
  os.environ["ENV_FILE"] = ".env.test"
  ```

  Full context of the affected section:
  ```python
  _db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
  _db_file.close()
  _TEST_DB_URL = f"sqlite+aiosqlite:///{_db_file.name}"

  os.environ["DATABASE_URL"] = _TEST_DB_URL
  os.environ["ENV_FILE"] = ".env.test"  # <-- this line
  ```

- [ ] Run full test suite: `cd backend && uv run pytest -v`
- [ ] Expected: all tests pass

## Task 4: Update dev.sh — export ENV_FILE

**Classification:** Trivial (1 file, 1 line added)

**File:** `dev.sh` (at project root)

- [ ] Add before the backend startup line:
  ```bash
  # Start backend (FastAPI) on :8000
  export ENV_FILE=.env.dev
  (cd "$BACKEND_DIR" && uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload) &
  ```

## Task 5: Verify the full flow

**Classification:** Small (validation only, no code changes)

- [ ] Start backend with env:
  ```bash
  cd backend && ENV_FILE=.env.dev uv run uvicorn src.main:app --host 0.0.0.0 --port 8000
  ```

- [ ] Test CORS with external origin:
  ```bash
  curl -s -D- -X OPTIONS \
    -H "Origin: http://172.65.90.23:3000" \
    -H "Access-Control-Request-Method: GET" \
    http://localhost:8000/api/v1/activities
  ```
  Expected: `HTTP/1.1 200 OK` with `access-control-allow-origin: http://172.65.90.23:3000`

- [ ] Test production behavior (no ENV_FILE):
  ```bash
  uv run python -c "from src.core.config import Settings; s=Settings(); print(s.CORS_ORIGINS)"
  ```
  Expected: `['http://localhost:3000', 'http://127.0.0.1:3000']` (defaults, no .env loaded)

- [ ] Run full test suite one final time:
  ```bash
  cd backend && uv run pytest -v
  ```
  Expected: all tests pass

- [ ] Git commit all changes:
  ```bash
  git add backend/.env.example backend/.env.dev backend/.env.test \
         backend/src/core/config.py backend/tests/conftest.py dev.sh
  git commit -m "feat: multi-env config via ENV_FILE env var"
  ```
