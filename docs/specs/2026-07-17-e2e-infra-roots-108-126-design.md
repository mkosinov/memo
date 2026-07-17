# Design: E2E Infra Roots — DB Lock (#108) + Standalone Warmup (#126)

**Date:** 2026-07-17
**Issues:** #108 (database lock), #126 (standalone playwright warmup)
**Package:** 1 of the E2E-infra cluster (see audit `ses_091bf0bc4ffe`)
**Type:** Test-infra + one backend engine-config change. No app business-logic change.

## 1. Problem & Goal

Restore E2E infrastructure reliability by eliminating two high-certainty root causes of flakiness, so we depend less on `test.skip`/workarounds.

- **#126:** standalone `playwright test` does not warm up Next.js routes → first `_next/static` chunk request 404s → React never hydrates → tests hang on "Загрузка". Shard/CI mode already warms up; standalone does not.
- **#108:** SQLite engine has no `busy_timeout` and no WAL; lock-handling is inconsistent across 3 call sites → intermittent "database is locked" AND silent stale-data.

**Out of scope** (separate packages): openModal/#124, our earlier skips (unified-rows 10/15/15b, clients:331), clients stale-cache root (#121), production visitor-422 bug (#124 item 3), #106 (multi-worker, already neutralized), #107 (card timeout), #122 (script cleanup trap), #109 (verify-only).

## 2. #126 — Standalone route warmup

### Current state
- **Shard/CI mode** (`scripts/e2e-shard-start.sh:133-149`): after the frontend responds, force-curls 9 routes (`/`, `/schedule`, `/clients`, `/records`, `/services`, `/masters`, `/locations`, `/tags`, `/photos`) to trigger Next.js dev-mode compilation.
- **Standalone mode** (`frontend/admin/playwright.config.ts:73-80`): `webServer` only health-checks a single 2xx on `http://localhost:${SHARD_PORT}`, then starts tests immediately. On a cold `.next` cache, client chunks for `/schedule` etc. are not yet compiled → 404 → hang.

### Decision: reuse-warmup via Playwright `globalSetup` (Approach A)
Add route warmup to the **standalone path only** (shard mode already warms up and must stay untouched — it skips `webServer` entirely per `playwright.config.ts:68-73`).

- Extend `e2e/globalSetup.ts` to, **when `SHARD_ID` is NOT set** (standalone mode only), fetch each of the warmup routes once against `http://localhost:${SHARD_PORT}` after (or independently of) the DB clean, so the first real test doesn't race compilation.
- The canonical warmup route list currently lives in `e2e-shard-start.sh:135-145`. To avoid drift/duplication, define the route list **once** in a shared TS location (e.g. `e2e/fixtures/warmup-routes.ts` exporting `WARMUP_ROUTES`) and import it in `globalSetup.ts`. The shell script may keep its own copy (bash can't import TS); the TS list is the source of truth for the TS side and the two lists must be kept in sync via a code comment cross-reference on both sides. (We do NOT rewrite the shell warmup — shard mode is green and out of risk.)
- Warmup requests: fetch each route, tolerate non-2xx (dev compile still triggered by the request), use a generous per-route timeout. Skip warmup entirely in shard mode (`SHARD_ID` set) to preserve current behavior.

**Why globalSetup, not webServer.command:** globalSetup runs once, in Node, has access to `SHARD_PORT`, and can conditionally warm up only in standalone mode. Embedding curls in `webServer.command` would duplicate the route list in a shell string and run even in edge configs.

## 3. #108 — DB lock (A + B + C)

### A. PRAGMA-on-connect hook (`backend/src/db/database.py`)
Current: `database.py:18` — `create_async_engine(db_url, echo=echo_mode, future=True)`, no `connect_args`, no event hook. Live check: `PRAGMA journal_mode` = `delete` (rollback journal). Three separate engines touch the DB file (`database.py:18`, Alembic in `migrate.py`, sqladmin in `admin/setup.py`).

**Decision (per backend consult `ses_091a75715ffe`):** add a **process-global** `event.listens_for(Engine, "connect")` hook that sets, per connection:
1. `PRAGMA busy_timeout=5000`
2. `PRAGMA journal_mode=WAL`

- Class-level `Engine` target (not `engine.sync_engine`) so it covers ALL three engines (app async + Alembic + sqladmin sync) — verified by the consult to fire for aiosqlite and pysqlite alike.
- Placed in `database.py` at module scope (imported by `db/__init__.py`, `migrate.py`, `admin/setup.py`), so the hook is registered before any engine constructs a connection.
- **WAL + busy_timeout everywhere (prod + dev + test).** Deployment is single-host, single-process, local-disk (ADR `docs/decisions/001-use-sqlite-for-storage.md`), so WAL is safe. busy_timeout is the direct fix for "database is locked" (CLI `sqlite3` racing uvicorn); WAL is complementary (shrinks the lock window).

### B. `globalSetup.ts` — retry on lock instead of rethrow
Current: `e2e/globalSetup.ts:40-50` swallows only `no such table` / `no such file` / `unable to open database`; a genuine `database is locked` is **rethrown** → kills the whole Playwright run.

**Decision:** wrap the `sqlite3` clean in a retry-on-lock (reuse the retry logic already in `e2e/fixtures/db-query.ts:43-63` — `MAX_RETRIES=5`, `RETRY_DELAY_MS=200`). Extract that retry into a shared helper (see §3d) and call it here. If still locked after retries → **explicit throw** (fail loudly). Keep the existing "DB not ready" swallow behavior (those are legitimately skippable).

### C. `cleanTestData()` — retry + explicit fail (stop silent stale-data)
Current: `e2e/fixtures/helpers.ts:36-53` — on `database is locked`, it only `console.warn`s and returns → cleanup **silently no-ops**, leaving stale UUID data that can poison later tests (a MEDIUM-certainty confound for #124's "wrong activity").

**Decision:** use the same shared retry-on-lock helper. If cleanup still fails after retries with a lock → **throw** (do NOT silently continue). Keep the "DB not ready" (`no such table`/`no such file`/`unable to open`) early-return as-is.

### 3d. Shared retry-on-lock helper (de-dup)
Extract the busy-wait retry currently in `db-query.ts:43-63` (`sqliteExecSync`) into a shared module (e.g. `e2e/fixtures/sqlite-exec.ts`) exporting a `sqliteExecWithRetry(cmd)` used by: `db-query.ts` (existing behavior preserved), `globalSetup.ts` (B), `cleanTestData()` (C). Single source of truth for lock handling; removes the current 3-way inconsistency (retry / rethrow / silent-swallow).

### 3e. ADR note (WAL backup caveat)
Add a note to `docs/decisions/001-use-sqlite-for-storage.md`: with WAL enabled, backing up via raw file copy must first `PRAGMA wal_checkpoint(TRUNCATE)` (or copy the `-wal`/`-shm` sidecars), else uncheckpointed writes are lost. No backup script exists today; this is a future-landmine guard.

## 4. Data Flow / Ordering

- **PRAGMA hook:** fires on every new DBAPI connection. `busy_timeout` is per-connection (must be set each connect). `journal_mode=WAL` is persisted in the DB file header (set once, harmless to re-issue). Order: `busy_timeout` first, then `journal_mode`.
- **Retry helper:** attempt → on "database is locked" AND attempts remain → busy-wait `RETRY_DELAY_MS` → retry; else throw. Same semantics currently in `db-query.ts`.
- **Warmup:** globalSetup → (standalone only) fetch each `WARMUP_ROUTES` entry once → then tests start.

## 5. User Scenarios

Each maps to a verification (E2E behavior or backend test).

- **US-1 (#126):** A developer runs `pnpm exec playwright test` standalone on a cold `.next` cache → tests do NOT hang on "Загрузка"; the first schedule/clients test finds its data-testid within timeout (routes were warmed up). → E2E/manual standalone run.
- **US-2 (#108-A):** During an E2E run where CLI `sqlite3` writes race the uvicorn backend, no run aborts with "database is locked" (busy_timeout retries the write). → observed across the E2E suite / no lock aborts in CI.
- **US-3 (#108-C):** If `cleanTestData()` cannot acquire the DB after all retries, the test **fails explicitly** (does not silently proceed with stale data). → unit/behavioral test of the helper (simulate persistent lock → expect throw).
- **US-4 (#108-A):** `PRAGMA journal_mode` on the test DB after backend start returns `wal`. → backend test asserting the engine sets WAL on connect.
- **US-5 (#108-A regression):** All existing backend pytest pass unchanged with WAL + busy_timeout enabled (no app breakage). → full backend pytest suite green.
- **US-6 (#108-B):** A locked DB during `globalSetup` retries rather than killing the whole Playwright run; only fails loudly if the lock persists past retries. → behavioral test of globalSetup retry path.

## 6. Error Handling

- `busy_timeout=5000` — if a lock genuinely persists >5s, the write still fails; that is a real problem surfaced (not masked), acceptable.
- Retry helper — bounded (`MAX_RETRIES=5`), then explicit throw. No infinite loops.
- Warmup — non-2xx responses tolerated (compile still triggered); a total fetch failure is logged but does not abort (warmup is best-effort; the goal is to trigger compilation, not assert route health).
- WAL sidecars (`-wal`/`-shm`) — expected to appear next to the DB file; must be in `.gitignore` if the DB path ever is (verify test DB paths are already ignored).

## 7. Testing Strategy

- **Backend (pytest):** assert the connect hook sets `busy_timeout` and `journal_mode=WAL` (query PRAGMAs on a fresh session). Full regression suite must stay green.
- **E2E helpers:** behavioral tests for the shared retry helper (persistent-lock → throw; transient-lock → succeed after retry). globalSetup/cleanTestData use the helper.
- **Standalone warmup:** verified by a cold-cache standalone run (US-1). No new CI job needed — shard CI is unaffected.
- **`.gitignore` check:** confirm `-wal`/`-shm` for test DBs are not accidentally committed.

## 8. Task Classification (preview for plan)

- T1 — backend PRAGMA hook + backend tests (US-4/US-5): **standard** (backend-coder, TDD).
- T2 — shared retry helper `sqlite-exec.ts` + rewire `db-query.ts`: **small** (frontend-coder).
- T3 — `globalSetup.ts` retry (B) + `cleanTestData()` retry+throw (C): **standard** (frontend-coder).
- T4 — shared `WARMUP_ROUTES` + standalone warmup in globalSetup (#126): **standard** (frontend-coder).
- T5 — ADR note (3e) + `.gitignore`/docs: **trivial** (architect spot-check or docser).

## Visual Compliance Checks

N/A — infra/test-only change, no UI surface. (Existing visual snapshots must remain green as a regression signal.)
