# Backend Issues Batch — Design Spec

**Date:** 2026-06-18
**Scope:** Resolve 3 open GitHub issues with backend fixes in a single PR.
**Branch:** `fix/backend-issues`

## Context

| # | Issue | Status |
|---|-------|--------|
| 47 | DnD: добавить start (ISO) в ActivityUpdate schema | **Wontfix** — устарел, уже реализован |
| 60 | ClientWithStats pydantic validation fails on unknown channel value | **Fix** — schema validation |
| 61 | records table missing custom_price column — ORM/DB schema drift | **Fix** — apply alembic migration |

## Fix #60: Channel response schema tolerance

### Problem

DB column `clients.channel` is `String(50)` — accepts any string. Existing data has values like `instagram`, `vk`, `telegram`, `website`. But `Channel` enum only contains `telegram`, `max`, `whatsapp`. `ClientResponse` inherits from `ClientBase` which has `channel: Channel | None` — so `model_validate()` rejects any client with `instagram`/`vk`/`website` channel. Result: `GET /api/v1/clients` returns **500** for any such row.

### Fix

- **Input schemas** (`ClientCreate`, `ClientUpdate`, `ClientPatch`): keep `channel: Channel | None` — catch typos on write
- **Response schemas** (`ClientResponse`, `ClientWithStats`): use `channel: str | None` — tolerate any DB value
- Add test that inserts a client with `channel='instagram'` directly via ORM, then calls `GET /api/v1/clients` — expect 200

### Files

- `backend/src/schemas/client.py` — split `channel` typing between Base (input) and Response (output)
- `backend/tests/test_schemas_client.py` — add test for tolerant response schema
- `backend/tests/test_api_clients.py` — add integration test for 200 on `instagram` channel

## Fix #61: Apply alembic migration for custom_price

### Problem

`Record` ORM model has `custom_price: Mapped[int | None]`, but actual SQLite `records` table does NOT have this column. Migration file `c2d4ed6da43f_add_custom_price_to_records.py` exists but has never been applied — no `alembic_version` table in DB. Schema is created via `create_all` at startup, which doesn't add new columns to existing tables.

### Fix

Run `alembic upgrade head` to apply all pending migrations. Since `alembic_version` doesn't exist, the migration chain starts from `ce42b37ee405` (root). The current DB schema was created via `create_all` based on **current** model definitions, so it's in an unknown state relative to migrations.

**Strategy:** Add a startup migration step in the backend entrypoint that:
1. Checks if `alembic_version` table exists
2. If not — stamp to the current `head` (DB is already at head via `create_all`)
3. If yes — run `alembic upgrade head` to apply any pending migrations

This is safe because:
- Fresh DBs (tests, dev) → no `alembic_version` → stamp to head → no migrations run
- Existing DBs with `alembic_version` → upgrade head → applies pending migrations
- In all cases, the final state is "head" of migrations

**Alternative considered:** Drop & recreate DB. Rejected — would lose existing data.

### Files

- `backend/src/main.py` (or wherever startup happens) — add migration step
- `backend/alembic.ini` already configured (verified)

### Testing

- Tests use fresh in-memory/empty DBs → `create_all` creates schema → `alembic_version` doesn't exist → stamp to head → no-op → tests pass
- Add a test that verifies the migration step is idempotent (running twice doesn't break)

## Issue #47: Closure rationale

Issue title says "PUT" but frontend actually uses PATCH (`patchActivity` in `endpoints.ts:184`). Both `ActivityUpdate` and `ActivityPatch` schemas already include `start: datetime | None = None`. Pydantic v2 accepts ISO datetime strings (with or without timezone).

**Action:** Close issue #47 with comment explaining the schema is already correct. No code change needed.

## Visual Compliance Checks

N/A — this is backend-only. No UI changes.

## Acceptance Criteria

- [ ] `GET /api/v1/clients` returns 200 even when DB has clients with `channel='instagram'`/`'vk'`/`'website'`
- [ ] `POST /api/v1/clients` with `channel='instagram'` returns 422 (rejected on input)
- [ ] `backend/memo.db` has `custom_price` column in `records` table after running backend once
- [ ] All existing tests pass (`pytest`)
- [ ] Issue #47 closed with explanation comment
- [ ] Issue #60 closed after fix lands
- [ ] Issue #61 closed after fix lands
