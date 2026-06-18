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

## Task 3: Bring existing memo.db to alembic head (one-time)

### Classification: standard
### Required Docs
- `backend/alembic/versions/*.py` — all migration files
- `backend/alembic.ini` — alembic config
- `backend/src/core/config.py` — DATABASE_URL

### Task Description

The current `backend/memo.db` was created via `create_all` and is missing some columns added by later migrations (e.g. `records.custom_price`). The DB has NO `alembic_version` table. To use alembic going forward, we need to:
1. Determine the correct baseline (the last migration that was definitely applied)
2. Stamp the DB to that baseline
3. Run `alembic upgrade head` to apply pending migrations
4. Verify the DB schema now matches the model

**Baseline determination:** Inspect the DB schema. The DB has:
- `clients.name/phone/channel` nullable (post-`ce42b37ee405`)
- `user_settings` table exists (post-`25569161a522`)
- BUT `records.custom_price` missing (pre-`c2d4ed6da43f`)
- AND `locations.short_title` missing (pre-`4c7aaa708a63`)
- AND `services.max_age` NOT NULL (pre-`275ba490cab8`)

**Inconsistent state** — the DB has some post-`25569161a522` artifacts (user_settings) but is missing other later changes. The safest baseline is the **root** (`ce42b37ee405`), but the upgrade will fail on `25569161a522` because `user_settings` already exists.

**Strategy:** Drop the existing `memo.db` and let `create_all` recreate it from current models. Data loss is acceptable for dev (per issue #61: "acceptable for dev, not for prod" — and this is dev). For prod, document the manual migration steps in the commit message.

### Files

- **Modify:** None (operations on DB file only)
- **Create:** `backend/scripts/recreate_dev_db.sh` — script for re-creating dev DB

### Steps

- [ ] **Backup the current memo.db (safety):**
  ```bash
  cd backend
  cp memo.db memo.db.bak.$(date +%Y%m%d)
  ls -la memo.db*
  ```

- [ ] **Inspect what's in the DB before dropping:**
  ```bash
  cd backend
  sqlite3 memo.db "SELECT COUNT(*) AS records_count FROM records;"
  sqlite3 memo.db "SELECT COUNT(*) AS clients_count FROM clients;"
  sqlite3 memo.db "SELECT COUNT(*) AS activities_count FROM activities;"
  ```
  - Note: dev DB likely has seed data, no production data
  - If counts are 0 or only seed data — safe to drop

- [ ] **Recreate the DB using alembic (one-time):**
  ```bash
  cd backend
  rm memo.db
  uv run alembic upgrade head
  ```
  - Expected: All migrations apply, ending at head `275ba490cab8`
  - Verify: `sqlite3 memo.db ".tables"` should include `alembic_version`

- [ ] **Verify schema now matches model:**
  ```bash
  cd backend
  sqlite3 memo.db "PRAGMA table_info(records);" | grep custom_price
  sqlite3 memo.db "PRAGMA table_info(visits);" | grep custom_price
  sqlite3 memo.db "PRAGMA table_info(records);"
  sqlite3 memo.db "SELECT version_num FROM alembic_version;"
  ```
  - Expected: `custom_price` present in records and visits
  - Expected: version = `275ba490cab8` (head)

- [ ] **Re-seed the dev DB:**
  ```bash
  cd backend
  uv run python -m src.seed.seed
  ```
  - Expected: Seed runs successfully, no errors

- [ ] **Save the recreate script — `backend/scripts/recreate_dev_db.sh`:**

```bash
#!/usr/bin/env bash
# Recreate the dev memo.db from scratch using alembic migrations.
# Use when the DB has drifted from the model schema.
#
# Usage: ./scripts/recreate_dev_db.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f memo.db ]; then
    echo "Backing up existing memo.db → memo.db.bak.$(date +%Y%m%d%H%M%S)"
    cp memo.db "memo.db.bak.$(date +%Y%m%d%H%M%S)"
    rm memo.db
fi

echo "Running alembic upgrade head..."
uv run alembic upgrade head

echo "Seeding dev data..."
uv run python -m src.seed.seed

echo "Done. New memo.db created at head $(uv run alembic current 2>/dev/null | tail -1)"
```

- [ ] **Make script executable:**
  ```bash
  chmod +x backend/scripts/recreate_dev_db.sh
  ```

- [ ] **Report status: DONE with backup file path and new head version.**

---

## Task 4: Wire `alembic upgrade head` into FastAPI lifespan

### Classification: small
### Required Docs
- `backend/src/main.py` — current lifespan (lines 32-37)
- `backend/alembic.ini` — config

### Task Description

Add `alembic upgrade head` to the FastAPI `lifespan` startup hook, so future migrations apply automatically. Assumes the DB has been brought to head once (Task 3).

### Files

- **Modify:** `backend/src/main.py` — add alembic upgrade to lifespan

### Steps

- [ ] **Read current main.py lifespan:**
  ```bash
  sed -n '30,40p' backend/src/main.py
  ```

- [ ] **Add a migration helper — `backend/src/db/migrate.py`:**

```python
"""Run alembic upgrade head (issue #61).

Idempotent — runs every app startup. Assumes the DB has been stamped
to a baseline at least once (use `alembic stamp` or recreate script).
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


async def run_alembic_upgrade(database_url: str) -> None:
    """Run `alembic upgrade head`. Idempotent.

    If `alembic_version` table doesn't exist, the call will fail — the
    operator must run `alembic stamp <baseline>` or recreate the DB first.

    Args:
        database_url: SQLAlchemy async URL (e.g. 'sqlite+aiosqlite:///memo.db').
    """
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", database_url)
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    # If alembic_version doesn't exist, we cannot upgrade — fail loudly
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name='alembic_version'"
                )
            )
            if result.scalar() is None:
                raise RuntimeError(
                    "alembic_version table not found. "
                    "Run `alembic stamp <baseline>` or recreate the DB. "
                    "See scripts/recreate_dev_db.sh"
                )
    finally:
        await engine.dispose()

    logger.info("Running alembic upgrade head")
    command.upgrade(cfg, "head")
```

- [ ] **Modify `backend/src/main.py` — add migration call to lifespan:**

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
from src.db.migrate import run_alembic_upgrade
# ... (all other imports unchanged)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with db_manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Issue #61: apply pending alembic migrations
    await run_alembic_upgrade(str(settings.DATABASE_URL))
    yield
```

- [ ] **Verify the import:**
  ```bash
  cd backend
  uv run python -c "from src.db.migrate import run_alembic_upgrade; print('ok')"
  ```

- [ ] **Add a unit test — `backend/tests/test_migrate.py`:**

```python
"""Tests for the alembic upgrade runner (issue #61)."""

import asyncio

import pytest
from sqlalchemy import text


def test_run_alembic_upgrade_on_already_at_head(tmp_path) -> None:
    """When DB is at head, run_alembic_upgrade is a no-op (no errors)."""
    from src.db.migrate import run_alembic_upgrade
    from src.db.database import DBManager
    from src.db.base import Base

    test_db = tmp_path / "test_at_head.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        # Create schema and stamp to head first
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # Stamp to head via alembic CLI
        from alembic.config import Config
        from alembic import command
        backend_dir = mgr.engine.url.database and __import__('pathlib').Path(mgr.engine.url.database).resolve().parents[1]
        cfg = Config(str(backend_dir / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", test_url)
        cfg.set_main_option("script_location", str(backend_dir / "alembic"))
        command.stamp(cfg, "head")

        # Now run_alembic_upgrade must be a no-op
        await run_alembic_upgrade(test_url)

        async with mgr.engine.connect() as conn:
            version = (await conn.execute(
                text("SELECT version_num FROM alembic_version")
            )).scalar()
            assert version == "275ba490cab8"

        await mgr.engine.dispose()

    asyncio.run(scenario())


def test_run_alembic_upgrade_fails_when_alembic_version_missing(tmp_path) -> None:
    """When alembic_version doesn't exist, raise RuntimeError with guidance."""
    from src.db.migrate import run_alembic_upgrade
    from src.db.database import DBManager
    from src.db.base import Base

    test_db = tmp_path / "test_no_alembic.db"
    test_url = f"sqlite+aiosqlite:///{test_db}"

    async def scenario():
        mgr = DBManager(test_url, echo_mode=False)
        async with mgr.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        # No stamping — alembic_version doesn't exist
        with pytest.raises(RuntimeError, match="alembic_version"):
            await run_alembic_upgrade(test_url)
        await mgr.engine.dispose()

    asyncio.run(scenario())
```

- [ ] **Run the tests:**
  ```bash
  cd backend
  uv run pytest tests/test_migrate.py -v
  ```
  - Expected: BOTH tests pass

- [ ] **Run all backend tests — confirm no regression:**
  ```bash
  cd backend
  uv run pytest -v --tb=short
  ```
  - All existing tests must still pass (test DBs use `reset_db` autouse fixture, no alembic interference)

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

After all tasks, commits on `fix/backend-issues` (in this order):

```bash
# 1. Channel fix
git add backend/src/schemas/client.py backend/tests/test_api_clients.py
git commit -m "fix(client): tolerate any channel value in response schema (#60)"

# 2. Migration helper + startup hook
git add backend/src/db/migrate.py backend/tests/test_migrate.py
git commit -m "feat(db): add alembic upgrade runner (issue #61)"

git add backend/src/main.py
git commit -m "feat(db): run alembic upgrade on FastAPI startup (issue #61)"

# 3. Recreate script
git add backend/scripts/recreate_dev_db.sh
git commit -m "chore(db): add script to recreate dev memo.db via alembic (#61)"
```

**Note:** `backend/memo.db` itself is NOT committed (gitignored). The recreate script handles DB lifecycle for dev.

## Acceptance Criteria (from spec)

- [ ] `GET /api/v1/clients` returns 200 even when DB has clients with `channel='instagram'`/`'vk'`/`'website'`
- [ ] `POST /api/v1/clients` with `channel='instagram'` returns 422 (rejected on input)
- [ ] `backend/memo.db` has `custom_price` column in `records` table after running backend once
- [ ] All existing tests pass (`pytest`)
- [ ] Issue #47 closed with explanation comment
- [ ] Issue #60 closed after fix lands
- [ ] Issue #61 closed after fix lands
