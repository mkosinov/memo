# Backend Issues Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 3 backend issues in one PR: fix #60 (channel validation), #61 (custom_price migration), and close #47 as wontfix.

**Architecture:** 
- #60: Split `channel` typing between input schemas (keep `Channel` enum) and response schemas (use `str`)
- #61: Add alembic startup hook in `lifespan` that idempotently stamps/upgrade the existing `memo.db`
- #47: Close as wontfix (schema already correct)

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy 2.0 async, Alembic, pytest

**Branch:** `fix/backend-issues`

---

## Task 1: Add RED test for #60 — channel response tolerance

### Classification: small
### Required Docs
- `docs/specs/2026-06-18-backend-issues-batch-design.md` — full context
- `docs/domain-rules/clients.md` — entity rules, channel field (read if exists)
- `backend/tests/conftest.py` — `create_client` factory, `query_db` helper
- `backend/src/schemas/client.py` — current schema

### Task Description

**Goal:** Write a failing test that reproduces issue #60 — `GET /api/v1/clients` returns 500 when DB contains a client with `channel='instagram'` (not in the `Channel` enum).

**Why:** TDD — RED test must fail BEFORE we change the schema. After fix, it must pass.

### Files

- **Modify:** `backend/tests/test_api_clients.py` — add new test class

### Steps

- [ ] **Read context first:**
  - `cat backend/src/schemas/client.py` (current schema)
  - `cat backend/src/models/enums.py` (Channel enum values)
  - `grep -n "def query_db\|query_db(" backend/tests/conftest.py` (helper signature)

- [ ] **Add test to `backend/tests/test_api_clients.py`:**

```python
class TestClientChannelTolerance:
    """Issue #60: GET /api/v1/clients must tolerate any channel value in DB.

    Channel enum has telegram/max/whatsapp, but DB has instagram/vk/website.
    Response schema must accept any string from DB.
    """

    def test_get_clients_with_unknown_channel_returns_200(
        self, api_client, query_db
    ) -> None:
        """Insert client with channel='instagram' via SQL, GET must return 200."""
        import uuid as _uuid
        client_id = str(_uuid.uuid4())
        # Bypass API validation by inserting directly via SQL
        query_db(
            f"INSERT INTO clients (id, name, phone, email, channel, "
            f"created_at, updated_at, is_active) VALUES "
            f"('{client_id}', 'Instagram User', '+79990000001', NULL, 'instagram', "
            f"datetime('now'), datetime('now'), 1)"
        )

        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200, f"GET failed: {resp.text}"
        body = resp.json()
        # Find the client with the unknown channel
        matching = [c for c in body["items"] if c["id"] == client_id]
        assert len(matching) == 1
        assert matching[0]["channel"] == "instagram"

    def test_post_client_with_unknown_channel_returns_422(
        self, api_client
    ) -> None:
        """POST must still REJECT unknown channel — input schema keeps enum."""
        import uuid as _uuid
        resp = api_client.post("/api/v1/clients", json={
            "name": "Bad Channel",
            "phone": f"+7999{_uuid.uuid4().hex[:7]}",
            "channel": "instagram",
        })
        assert resp.status_code == 422, (
            f"Expected 422 for unknown channel, got {resp.status_code}: {resp.text}"
        )
```

- [ ] **Run the test — confirm RED:**
  ```bash
  cd backend
  uv run pytest tests/test_api_clients.py::TestClientChannelTolerance -v
  ```
  - Expected: `test_get_clients_with_unknown_channel_returns_200` **FAILS** with `ValidationError` on `channel`
  - Expected: `test_post_client_with_unknown_channel_returns_422` **PASSES** (input already rejects)

- [ ] **Verify error message** in test output mentions `channel` and `Input should be 'telegram', 'max' or 'whatsapp'` — confirms bug.

- [ ] **Report status: DONE with the failing test name and exact error message.**

---

## Task 2: GREEN #60 — fix client schema to tolerate any channel on response

### Classification: small
### Required Docs
- `backend/src/schemas/client.py` (current state — has `channel: Channel | None` in `ClientBase`)
- Task 1's RED test (must pass after this change)

### Task Description

Split the `channel` field type:
- Input schemas (`ClientCreate`, `ClientUpdate`, `ClientPatch`): keep `Channel | None` — reject unknown values on write
- Response schemas (`ClientResponse`, `ClientWithStats`): use `str | None` — tolerate any DB value

### Files

- **Modify:** `backend/src/schemas/client.py`

### Steps

- [ ] **Read current schema:**
  ```bash
  cat backend/src/schemas/client.py
  ```

- [ ] **Refactor `backend/src/schemas/client.py`:**

```python
"""Pydantic schemas for the clients domain."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from src.models.enums import Channel


class ClientBase(BaseModel):
    """Shared fields for client creation and updates.

    `channel` uses the Channel enum here so typos are caught on input.
    Response schemas override this with `str | None` to tolerate legacy DB values.
    """

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None


class ClientCreate(ClientBase):
    """Request schema for creating a new client."""

    pass


class ClientUpdate(ClientBase):
    """Request schema for updating a client (full replacement via PUT)."""

    pass


class ClientPatch(BaseModel):
    """Request schema for partial updates (PATCH). All fields optional."""

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None


class ClientResponse(BaseModel):
    """Response schema with all client fields.

    Uses `str | None` for `channel` (not the Channel enum) to tolerate
    any string already stored in the DB (e.g. 'instagram', 'vk', 'website'
    from before the enum was tightened). See issue #60.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: str | None = None
    created_at: datetime
    updated_at: datetime
    is_active: bool


class ClientWithStats(ClientResponse):
    """Response schema extending ClientResponse with aggregated metrics."""

    visits_count: int = 0
    last_visit: str | None = None
    total_paid: int = 0
    missed_visits: int = 0


class ClientListParams(BaseModel):
    """Query parameters for GET /api/v1/clients with filtering, pagination, sorting."""

    page: int = 1
    per_page: int = Field(default=20, le=100)
    search: str | None = None
    is_active: bool | None = None
    created_from: date | None = None
    created_to: date | None = None
    updated_from: date | None = None
    updated_to: date | None = None
    min_visits: int = Field(default=0, ge=0)
    max_visits: int | None = None
    min_paid: int = Field(default=0, ge=0)
    max_paid: int | None = None
    missed_from: int = Field(default=0, ge=0)
    missed_to: int | None = None
    sort_by: str = "name"
    sort_order: str = "asc"


class ClientListResponse(BaseModel):
    """Paginated response for client listing with stats."""

    items: list[ClientWithStats]
    total: int
    page: int
    per_page: int
```

- [ ] **Run the RED test from Task 1 — confirm GREEN:**
  ```bash
  cd backend
  uv run pytest tests/test_api_clients.py::TestClientChannelTolerance -v
  ```
  - Expected: BOTH tests pass

- [ ] **Run all client tests — confirm no regression:**
  ```bash
  cd backend
  uv run pytest tests/test_api_clients.py tests/test_schemas_client.py -v
  ```

- [ ] **Report status: DONE.**

---

## Task 3: Add alembic migration helper for #61

### Classification: standard
### Required Docs
- `backend/alembic/versions/c2d4ed6da43f_add_custom_price_to_records.py` — existing migration
- `backend/src/core/config.py` — DATABASE_URL
- `backend/alembic/env.py` — alembic env config
- `backend/alembic.ini` — alembic config

### Task Description

Create a helper function that:
1. Checks if `alembic_version` table exists in the DB
2. If not — stamps the current `head` (DB is at head via `create_all`)
3. If yes — runs `alembic upgrade head` to apply pending migrations
4. Idempotent (can be called multiple times)

Then add a RED test that verifies idempotency.

### Files

- **Create:** `backend/src/db/migrate.py` — migration helper
- **Create:** `backend/tests/test_migrate.py` — migration tests

### Steps

- [ ] **Read context first:**
  - `cat backend/alembic.ini | head -40` (alembic config)
  - `cat backend/alembic/env.py` (async env config)
  - `cat backend/src/core/config.py` (DATABASE_URL location)
  - `ls backend/alembic/versions/` (migration files)

- [ ] **Write RED test first — `backend/tests/test_migrate.py`:**

```python
"""Tests for the alembic migration helper (issue #61)."""

import pytest
from sqlalchemy import text


pytestmark = pytest.mark.db


def test_run_migrations_stamps_when_alembic_version_missing(
    db_manager, tmp_path
) -> None:
    """If alembic_version doesn't exist, stamp to head (no-op for schema)."""
    import asyncio
    from src.db.migrate import run_migrations

    # Use a fresh DB file
    test_db = tmp_path / "test_stamp.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"
    from src.db.database import DBManager
    from src.db.base import Base

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        # alembic_version does NOT exist
        async with mgr.engine.connect() as conn:
            tables = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            )
            names = {row[0] for row in tables}
            assert "alembic_version" not in names

        await run_migrations(test_url)

        # After run, alembic_version exists and is at head
        async with mgr.engine.connect() as conn:
            rows = await conn.execute(
                text("SELECT version_num FROM alembic_version")
            )
            version = rows.scalar()
            assert version is not None
            # Head is 275ba490cab8 (last migration)
            assert version == "275ba490cab8"

        await mgr.engine.dispose()

    asyncio.run(scenario())


def test_run_migrations_is_idempotent(db_manager, tmp_path) -> None:
    """Calling run_migrations twice must not raise."""
    import asyncio
    from src.db.migrate import run_migrations
    from src.db.database import DBManager
    from src.db.base import Base

    test_db = tmp_path / "test_idempotent.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await run_migrations(test_url)
        # Second call must be a no-op (already at head)
        await run_migrations(test_url)
        await mgr.engine.dispose()

    asyncio.run(scenario())
```

- [ ] **Run the test — confirm RED (import error):**
  ```bash
  cd backend
  uv run pytest tests/test_migrate.py -v
  ```
  - Expected: `ModuleNotFoundError: No module named 'src.db.migrate'`

- [ ] **Implement the helper — `backend/src/db/migrate.py`:**

```python
"""Alembic migration runner (issue #61).

Runs pending migrations on app startup, handling the case where the DB
was originally created via SQLAlchemy's `create_all` (no alembic_version
table) and may be missing columns added by later migrations.

Behavior:
- If `alembic_version` table does NOT exist → stamp to head (DB is at
  head via `create_all` using current model definitions)
- If `alembic_version` exists → run `alembic upgrade head` to apply
  any pending migrations

Idempotent — safe to call on every startup.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

logger = logging.getLogger(__name__)


async def run_migrations(database_url: str) -> None:
    """Apply pending migrations. Idempotent.

    Args:
        database_url: SQLAlchemy async URL (e.g. 'sqlite+aiosqlite:///memo.db').
    """
    # Check if alembic_version exists
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name='alembic_version'"
                )
            )
            has_alembic = result.scalar() is not None
    finally:
        await engine.dispose()

    # Build alembic Config
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", database_url)

    if not has_alembic:
        logger.info("alembic_version not found — stamping to head")
        # Override script_location to absolute path
        cfg.set_main_option(
            "script_location", str(backend_dir / "alembic")
        )
        command.stamp(cfg, "head")
    else:
        logger.info("alembic_version exists — running upgrade head")
        cfg.set_main_option(
            "script_location", str(backend_dir / "alembic")
        )
        command.upgrade(cfg, "head")
```

- [ ] **Run the test — confirm GREEN:**
  ```bash
  cd backend
  uv run pytest tests/test_migrate.py -v
  ```
  - Expected: BOTH tests pass

- [ ] **Report status: DONE.**

---

## Task 4: Wire migration helper into FastAPI lifespan

### Classification: small
### Required Docs
- `backend/src/main.py` — current lifespan (lines 32-37)
- `backend/src/db/migrate.py` — Task 3 implementation

### Task Description

Call `run_migrations` from the FastAPI `lifespan` startup hook, AFTER `create_all` so the DB exists.

### Files

- **Modify:** `backend/src/main.py` — add migration call to `lifespan`

### Steps

- [ ] **Read current main.py lifespan:**
  ```bash
  sed -n '30,40p' backend/src/main.py
  ```

- [ ] **Modify `backend/src/main.py` — update imports and lifespan:**

```python
"""Memo backend — FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from src.admin.setup import setup_admin
from src.core.config import settings
from src.db import db_manager
from src.db.base import Base
from src.db.migrate import run_migrations
# ... (all other imports unchanged)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with db_manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Issue #61: apply pending migrations to bring DB to head
    await run_migrations(str(settings.DATABASE_URL))
    yield
```

- [ ] **Verify import is correct:**
  ```bash
  cd backend
  uv run python -c "from src.db.migrate import run_migrations; print('ok')"
  ```

- [ ] **Run all backend tests — confirm no regression:**
  ```bash
  cd backend
  uv run pytest -v
  ```
  - All existing tests must still pass

- [ ] **Verify the production memo.db has custom_price column after restart:**
  ```bash
  cd backend
  sqlite3 memo.db ".schema records" | grep custom_price
  ```
  - Expected: `custom_price INTEGER,` (or similar)
  - If still missing: restart backend (`uv run python -m src.main` or similar) and re-check

- [ ] **Report status: DONE.**

---

## Task 5: Close issue #47 as wontfix

### Classification: trivial
### Required Docs
- Issue #47 body — what it asks for

### Task Description

Add a comment to issue #47 explaining the schema already has `start`, and close the issue.

### Files

- None (GitHub-only operation)

### Steps

- [ ] **Add comment to issue #47:**
  ```bash
  gh issue comment 47 --repo mkosinov/memo --body "Closing as wontfix. The frontend uses PATCH (\`patchActivity\` in \`frontend/packages/api-client/src/endpoints.ts:184\`) and both \`ActivityUpdate\` and \`ActivityPatch\` schemas already include \`start: datetime | None = None\`. Pydantic v2 accepts ISO datetime strings. Verified by examining the current code — no fix needed."
  ```

- [ ] **Close issue #47:**
  ```bash
  gh issue close 47 --repo mkosinov/memo --reason "not planned"
  ```

- [ ] **Report status: DONE.**

---

## Task 6: Final verification

### Classification: trivial
### Required Docs
- All previous tasks

### Task Description

Run the full test suite to confirm nothing is broken, and verify the production DB is now in a healthy state.

### Steps

- [ ] **Run full backend test suite:**
  ```bash
  cd backend
  uv run pytest -v --tb=short
  ```
  - All tests must pass

- [ ] **Verify production memo.db schema:**
  ```bash
  cd backend
  sqlite3 memo.db ".schema records" | grep custom_price
  sqlite3 memo.db ".schema clients" | grep channel
  sqlite3 memo.db "SELECT version_num FROM alembic_version"
  ```
  - Expected: `custom_price INTEGER,` present
  - Expected: `channel VARCHAR(50),` present (unchanged)
  - Expected: version `275ba490cab8` (or current head)

- [ ] **Verify no leftover broken state:**
  ```bash
  cd backend
  grep -rn "channel: Channel" src/schemas/client.py
  ```
  - Expected: only in `ClientBase`, `ClientCreate`, `ClientUpdate`, `ClientPatch` (input schemas). NOT in `ClientResponse` or `ClientWithStats`.

- [ ] **Report status: DONE with test summary (X passed, Y failed).**

---

## Commit Strategy

After all tasks, commits on `fix/backend-issues`:

```bash
git add backend/src/schemas/client.py backend/tests/test_api_clients.py
git commit -m "fix(client): tolerate any channel value in response schema (#60)"

git add backend/src/db/migrate.py backend/tests/test_migrate.py
git commit -m "feat(db): add alembic migration runner with stamp+upgrade (#61)"

git add backend/src/main.py
git commit -m "feat(db): run migrations on FastAPI startup (fix #61)"
```

## Acceptance Criteria (from spec)

- [ ] `GET /api/v1/clients` returns 200 even when DB has clients with `channel='instagram'`/`'vk'`/`'website'`
- [ ] `POST /api/v1/clients` with `channel='instagram'` returns 422 (rejected on input)
- [ ] `backend/memo.db` has `custom_price` column in `records` table after running backend once
- [ ] All existing tests pass (`pytest`)
- [ ] Issue #47 closed with explanation comment
- [ ] Issue #60 closed after fix lands
- [ ] Issue #61 closed after fix lands
