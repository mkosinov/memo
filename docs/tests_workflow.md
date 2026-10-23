# Test Workflow

> Brief overview of how tests are organized and run in this repo.
> For deep dives, see [CONTRIBUTING.md](../CONTRIBUTING.md) and the testing strategy specs.

## TL;DR

| Test type | Command | Working dir | What it tests |
|-----------|---------|-------------|---------------|
| Backend pytest | `cd backend && uv run pytest` | `backend/` | Backend API, models, services |
| Frontend unit (vitest) | `cd frontend/admin && pnpm test` | `frontend/admin/` | React components, hooks, contexts |
| Workspace unit (vitest) | `bash scripts/run-workspace-tests.sh` | repo root | Unit tests of `packages/domain`, `packages/api-client`, `frontend/web` — the package list is derived from the workspace globs (GH #420) |
| Frontend e2e (Playwright) | `cd frontend/admin && pnpm test:e2e` | `frontend/admin/` | Full user flows in browser |
| Type check | `cd frontend/admin && pnpm type-check` | `frontend/admin/` | TypeScript validation |
| Lint | `pnpm lint` (from repo root) | repo root | ESLint via Turbo |
| **Full local suite (on demand)** | `bash scripts/test-all.sh` (repo root) | repo root | All of the above + visual compliance; self-acquires the heavy lock (GH #472) |
| Re-record visual baselines | `cd frontend/admin && pnpm run test:e2e:update` | `frontend/admin/` | Update visual regression baselines |

> **Heavy-run lock (GH #472):** whole suites — the full run, ALL of backend
> pytest, ALL admin/workspace vitest — serialize on a container-wide lock
> (`scripts/with-test-lock.sh`; `test-all.sh` self-acquires it). See
> [Heavy-run lock (GH #472)](#heavy-run-lock-gh-472) before launching one.

## Test environment

### Dev (interactive)
- Backend FastAPI on `:8000` (DB: `backend/memo.db`)
- Admin (Next.js) on `:3001` (when started with `--admin`)
- Started via `dev.sh`

### E2E (automated)
A single Playwright project `e2e` (per `frontend/admin/playwright.config.ts`, GH #415); sharding is native — the `--shard=i/N` run flag makes Playwright split spec FILES deterministically across N runs. The project name no longer encodes test composition: which spec runs in which shard is decided by `--shard` alone.

- **CI** (`e2e-tests` in `test.yml`): 4 shards, `--shard=i/4` — each matrix job starts its OWN stack on fixed ports: shard 1 → 3002/8001, 2 → 3003/8002, 3 → 3004/8003, 4 → 3005/8004.
- **Local** (`bash scripts/test-all.sh`): 2 shards, `--shard=1/2` and `--shard=2/2`, run in parallel from the SAME cwd (`frontend/admin`); per-shard env outputs `E2E_RESULTS_JSON=results-shard<N>.json` and `E2E_REPORT_DIR=playwright-report-shard<N>` (read by the config's reporters) keep the two runs from overwriting each other's `results.json`/`playwright-report/`.
- 2 local shards instead of 5 is deliberate — CPU contention on 4-core machines (5 parallel Next.js dev servers caused 30s+ page loads).

Where the stacks live depends on the environment (GH #317): **locally** every run gets a unique run tag and 4 dynamic ports from the 28000-32700 window (details in [Run tag & dynamic ports](#run-tag--dynamic-ports-gh-317) below); **in CI** the ports stay fixed by the shard matrix (front 3002–3005, back 8001–8004) and the tag is empty — each workflow job passes its shard's env explicitly.

Each shard stack is orchestrated by `scripts/test-all.sh`:
 1. Start-cleanup: run leases (`/tmp/memo-shard-runs/*.run`) classify runs as live/dead; dead runs are swept by THEIR 4 ports + command mask, their tagged files and lease removed; a tail audit deletes tagged resources with no live lease (log dirs `run-<tag>` only once the tag has been dead > 24 h)
 2. A run tag is generated and 4 pairwise-distinct free ports allocated from the window (live runs' ports passed as busy); the run lease is written, then the «тег/порты прогона» line is printed
 3. Stale shard build dirs are wiped — tag-scoped: own `.next-shard-*_${TAG}` plus untagged legacy dirs, the latter only while the legacy ports 3002/3003/8001/8002 are free
 4. Master DB (`test_memo.db`) is seeded if missing or has <5 tables (a mkdir-lock serializes same-machine seeds)
 5. Master DB is copied to per-shard tagged DBs (`test_memo_shard{1,2}_${TAG}.db`)
 6. Each shard's backend starts (uvicorn on its dynamic port), then the frontend (Next.js on its dynamic port, building into `.next-shard-N_${TAG}`)
 7. Playwright runs with `reuseExistingServer: true` (skips the `webServer` config in shard mode — see the `SHARD_ID` conditional in `playwright.config.ts`)
 8. Cleanup kills the run's background processes and removes its tagged DBs, build/photo dirs and lease

Each shard's servers start via `scripts/e2e-shard-start.sh`:
- Sets `SHARD_ID` (allowlist 1–4, GH #415), `SHARD_PORT`, `BACKEND_PORT`, `TEST_DB_PATH`, `BACKEND_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_DIST_DIR` (and, optional GH #317, `SHARD_RUN_TAG`: a set tag suffixes resource names and writes a manual-stack run lease; unset → exact legacy untagged names — the CI path)
- Backend starts in background, frontend in foreground
- Waits for backend health check (Alembic runs migrations automatically during startup)
- Seeds DB with test data (idempotent — skips if tables already exist)
- Waits for frontend to respond on its port

**Build isolation (GH #264):** each shard builds into its own `frontend/admin/.next-shard-N[_${TAG}]` (tag-suffixed locally, plain `.next-shard-N` untagged; one per shard, recreated from scratch by every `test-all.sh` run — chunks never leak between shards or into the default `.next`). Contract: `e2e-shard-start.sh` is the sole producer of `NEXT_DIST_DIR` (`.next-shard-${SHARD_ID}` + `_${SHARD_RUN_TAG}` when a tag is set), consumed by `next.config.mjs` (`distDir: process.env.NEXT_DIST_DIR || '.next'`). The default `.next` belongs to the dev stack / standalone e2e — shards never read or wipe it.

**Cleanup is bounded (GH #122):** `cleanup_shards` (`scripts/lib/shard-helpers.sh`) is trapped on `EXIT INT TERM` (GH #317 — Ctrl-C and `kill` run the cleaner too): TERM to shard wrapper PIDs → bounded wait (10 s budget, 0.5 s poll) → `kill -9` survivors → control sweep keyed on the run's **actual (dynamic) ports** and command mask (`next dev -p <port>` / `next-server (v` title / `uvicorn`, each gated on holding one of the run's ports; no bare port kills, no global next-server pkill) → the run's tagged DBs, build/photo dirs and lease removed. Any exit path finishes in ≤ ~15 s without hanging and without touching unrelated processes.

**reuseExistingServer pattern:** When `SHARD_ID` is set, `playwright.config.ts` omits the `webServer` block entirely. This avoids a Playwright edge case where `reuseExistingServer` health check fails under load, causing `EADDRINUSE` when Playwright tries to start a second Next.js on the same port.

**CI artifacts & flake gate (GH #415):**
- On failure a shard job uploads the `e2e-report-shard-<i>` artifact (HTML report `playwright-report/` + `test-results/`, 7-day retention).
- After every run — green included (`if: always()`) — the «Flake summary» step runs `scripts/e2e-report-summary.mjs` over the shard's `results.json`: each test with status `flaky` (failed an earlier attempt, passed on the retry — CI has `retries: 1`) prints a `FLAKY: <suite> — <test>` line, the total `Flaky: N` goes to the log and the job's Step-Summary table. A missing or broken `results.json` is ONE warning line, exit 0 — no run, no flakes; a false red is unacceptable.
- **The flake policy is BLOCKING:** ≥1 flaky test exits 1 and turns the e2e job red even on an otherwise green run — merge is blocked by the green-CI gate. `Flaky: 0` → exit 0. The gate runs before the artifact upload, so a flake-red job still uploads its report. Locally `retries: 0` — the `flaky` status cannot occur by construction.

**5-shard design (superseded by GH #415):** the old plan — 5 named Playwright projects (services, schedule, records, clients, rest) — is obsolete: scaling the suite is now just a higher N in `--shard=i/N` plus more CI matrix entries, no project split involved. The historical spec stays in `docs/specs/2026-06-18-e2e-shard-5-projects-design.md`.

### Run tag & dynamic ports (GH #317)

Every local `test-all.sh` run carries a **run tag** — 6 lowercase hex chars from `openssl rand -hex 3` (24 bits of entropy; `$RANDOM` is forbidden — a tag collision would mean shared DBs/dirs). The tag is validated against `[0-9a-f]{6}` and regenerated if any resource of that tag already exists. All run resources are tag-suffixed: DBs `test_memo_shard{N}_${TAG}.db`, build dirs `.next-shard-N_${TAG}`, photo dirs `test_files_shard${N}_${TAG}`, and the per-run log dir `${TMPDIR:-/tmp}/test-all-logs/run-${TAG}`. An empty tag (CI, untagged manual `e2e-shard-start.sh`) keeps the exact legacy untagged names — back-compat without a single workflow edit.

**Port window 28000-32700:** each run allocates 4 pairwise-distinct free ports (frontend + backend per shard) — lsof-checked, 20 attempts, fail-fast. The window sits below the Linux ephemeral range (32768-60999 — the kernel never assigns those ports to outgoing connections) and below macOS ephemeral (49152+), above the privileged range, and clear of every repo service port (dev 3000/3001/8000, legacy shards 3002/3003/8001/8002, playground 3100/8101). Capacity: 4700 ports / 4 per run ≈ **1175 parallel runs**. Occupation is re-checked immediately before each stack starts (narrowing the allocate→bind race).

**The «тег/порты прогона» line:** the first thing a run prints is its identity —
`🏷 run tag: <tag> | shard 1 → front :P, back :P | shard 2 → front :P, back :P | logs: <dir>`.
Stack addresses are no longer memorized constants: to debug against a running suite manually, read the ports (and the log dir) from this line — or from the run's lease file.

**Run leases (`/tmp/memo-shard-runs/${TAG}.run`):** written by the run right after port allocation (a manually started tagged `e2e-shard-start.sh` writes the same lease with its own PID) — one line: PID, tag, 4 ports, start timestamp. A lease is **alive** iff its PID answers AND it is fresher than 24 h (`SHARD_LEASE_MAX_AGE_S=86400`; the threshold also covers PID reuse). Live runs' ports are handed to the allocator as busy and are excluded from every sweep. A dead run is swept precisely: its own 4 ports + command mask (`uvicorn` / `next dev` / `next-server`), its tagged files and its lease deleted. The run removes its own lease on exit.

**Tail audit (anti-accumulation):** after processing leases, the startup-clean deletes every tagged resource whose tag matches no live lease and is not the current run's — `test_memo_shard*_<6hex>*`, `.next-shard-*_<6hex>`, `test_files_shard*_<6hex>`: **a tagged file without a live lease is garbage** (lost lease, leftovers of old layouts). Log dirs `run-<tag>` follow the same rule with a grace period: they are deleted only once the tag has been dead > 24 h — a crashed run keeps its logs for a day of diagnostics (the Linux container's `/tmp` does not self-clean).

**Legacy fixed ports — CI/standalone only:** a local run never occupies or cleans 3002/3003/8001/8002 — those belong to CI and standalone Playwright runs (the defaults in `playwright.config.ts`/`globalSetup.ts` stay). Untagged legacy resources (`.next-shard-N`, `test_memo_shardN.db`, …) are wiped by a run only while the legacy ports are free — a live untagged manual stack holding them is thereby protected. The dev stack (3000/3001/8000) and playground (3100/8101) are never touched: their ports are outside the window, the leases and the masks.

**Failures and interrupts:** a failed allocation exits 1 before any run resource is created (no lease, no tagged files, no listeners). `EADDRINUSE` in a stack's start log is fatal by design — «порт X занят между проверкой и стартом; перезапусти test-all» — the answer is to restart `test-all` (no bind-retry: §4 of the spec). Ctrl-C and `kill` are covered too: the cleaner is trapped on `EXIT INT TERM` and removes the run's stacks, tagged files and lease on any exit path.

### DB conventions
- Backend tests use `:memory:` SQLite (per-fixture `DBManager`) — fast, isolated, no cleanup needed
- E2E tests use a shared `test_memo.db` master DB, copied to per-shard `test_memo_shard{1,2}[_${TAG}].db` (tag-suffixed in local runs, GH #317; plain names in CI)
- The master is re-seeded only if missing or has <5 tables (idempotent guard) — see `scripts/test-all.sh` for the exact check
- E2E tests query the DB directly via `frontend/admin/e2e/fixtures/db-query.ts` (uses `sqlite3` CLI on `TEST_DB_PATH`)

### TEST_DB_PATH resolution (standalone vs shard, GH #336)
All e2e DB access funnels through the single resolver `e2e/lib/db-path.ts`
(`resolveTestDbPath`; consumers: `globalSetup`, `db-query`, `factories`,
`seed-reset`). Contract:

- `SHARD_ID` set → canonical `<root>/backend/test_memo_shard{id}[_${SHARD_RUN_TAG}].db` (tag suffix when `SHARD_RUN_TAG` is set, GH #317; empty tag → the exact legacy path)
- `TEST_DB_PATH` set → used as-is (relative paths resolve against the repo root, never `process.cwd()`)
- both set and resolving to DIFFERENT files → loud error naming both vars (GH #209)
- a tagged `TEST_DB_PATH` with no `SHARD_RUN_TAG` in env (or vice versa) → the same loud conflict error (GH #317)
- neither set → default `<root>/backend/test_memo.db`
- `TEST_DB_PATH=''` (empty string) counts as unset — pinned by a unit test in `__tests__/db-path.test.ts`

Where each run mode gets its env from:

- **Full run (`bash scripts/test-all.sh`)**: `test-all.sh` exports `TEST_DB_PATH` explicitly
  per shard (plus `SHARD_RUN_TAG`, GH #317), and an exported env var always beats a line in `.env.test`
  (`playwright.config.ts` loads `.env.test` via `process.loadEnvFile`, which
  never overrides already-set variables). No conflict is possible in this mode.
- **Standalone (`pnpm exec playwright test <spec>`)**: the backend URL is NOT
  defaulted anymore — `e2e/lib/backend-url.ts` (`resolveBackendUrl()`, the
  single resolver every spec and fixture reads) throws with the canonical
  recipe unless BOTH `BACKEND_URL` and `NEXT_PUBLIC_API_URL` are exported
  with the SAME host (GH #387/#463: silent per-file defaults `:8000/:8001`
  let bare runs piggyback a foreign shard stack, and a `localhost` API
  origin against the `127.0.0.1` baseURL silently dropped the SameSite=Lax
  session cookie). The tracked `frontend/admin/.env.test` keeps only
  `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` — the browser-bundle default,
  same host as the baseURL; ports may differ between the two vars, hosts
  may not. The pre-sharding `TEST_DB_PATH` line was dropped from the file
  (GH #336): the GH #209 conflict error now fires only when you export
  BOTH vars yourself with different paths — unset one of them.

**Canonical standalone invocation** (the recipe the guard error prints;
`SHARD_PORT` pins the page off the shard ports — the default `:3002`
belongs to shard 1, and a running full run would be silently reused by
`reuseExistingServer` with ITS baked API origin):

```bash
# ── Stack: once per DB lifetime (redo after a week rollover or a seed change) ──
cd backend && rm -f test_memo.db test_memo.db-shm test_memo.db-wal
# new terminal, keep running — Alembic recreates the schema on boot:
ENV_FILE=.env.test PYTHONPATH=src uv run uvicorn src.main:app --port 8000
# seed (EXPLICIT absolute DATABASE_URL, 4 slashes — the seeder reads
# os.environ, not ENV_FILE; a relative URL silently targets the wrong DB):
cd backend && DATABASE_URL="sqlite+aiosqlite:////$(pwd)/test_memo.db" PYTHONPATH=src uv run python -m seed.seed
# snapshot the canonical reset script (#310):
python3 scripts/gen_seed_canon.py backend/test_memo.db backend/test_memo.db.canon.sql

# ── Run ──
cd frontend/admin && SHARD_PORT=3005 BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 pnpm exec playwright test e2e/<spec>.ts
```

`NEXT_PUBLIC_API_URL` is baked into the Next.js bundle at compile time: if
you change the API host between runs, remove `frontend/admin/.next` first
(same poisoning `test-all.sh` guards against). Sharded/CI runs are
unaffected — `test-all.sh`, `e2e-shard-start.sh` and every CI workflow
already export both vars with the same host, so the guard is a no-op there.

## How to run

### Quick (specific test type)
- Just backend: `cd backend && uv run pytest -k test_name -v`
- Just one vitest: `cd frontend/admin && pnpm test -- -t "test name"`
- Just one frontend spec (standalone): the full canonical recipe lives
  right above ("Canonical standalone invocation") — stack (backend + seed
  + canon) then the pinned run with `SHARD_PORT` off the shard ports.
  Bare runs without the pins fail LOUDLY with that exact recipe
  (`e2e/lib/backend-url.ts`).

### Full (on demand)
- `bash scripts/test-all.sh` (from repo root) — orchestrates all stages in parallel. (The root `pnpm test:all` is `turbo test:all` — it routes to admin's own `test:all` script, NOT to `scripts/test-all.sh`.)
- Typical runtime: ~10-15 minutes
- Skip visual compliance: `VISUAL_COMPLIANCE=0 bash scripts/test-all.sh`
- Sequential mode (debugging): `SEQUENTIAL=1 bash scripts/test-all.sh`
- The run **self-acquires the heavy lock** at the very start — before the `SEQUENTIAL` branch, so both run shapes serialize. On a busy machine it queues with a status line every 5 min and exits **75** past 1 h — see [Heavy-run lock (GH #472)](#heavy-run-lock-gh-472)

### Heavy-run lock (GH #472)

Two heavy suites on one container CPU-starve each other into flaky timeouts,
so every heavy entry point serializes on a machine-wide `flock`
(`scripts/lib/test-lock.sh`): the full local suite acquires the lock itself,
standalone heavy sets are launched through the `scripts/with-test-lock.sh`
wrapper.

**Heaviness is a property of the SET, not the invocation syntax.** The whole
suite is heavy however you spell it; a single file or spec is not. The rule
is fixed per entry point:

| Entry point | Canonical command | Lock |
|---|---|---|
| Full local suite | `bash scripts/test-all.sh` (every env form: `VISUAL_COMPLIANCE=0`, `SEQUENTIAL=1`) | **self-acquired** — run directly, never wrap |
| Whole backend pytest | `scripts/with-test-lock.sh bash -c 'cd backend && uv run pytest'` | wrapper |
| Whole admin vitest | `scripts/with-test-lock.sh bash -c 'cd frontend/admin && pnpm test'` | wrapper |
| Admin vitest + Playwright — `npm run test:all` in `frontend/admin` (a DIFFERENT `test:all`, not the root one) | `scripts/with-test-lock.sh bash -c 'cd frontend/admin && npm run test:all'` | wrapper |
| Workspace vitest sweep, run standalone | `scripts/with-test-lock.sh bash scripts/run-workspace-tests.sh` | wrapper |
| Single files/specs, type-check, lint, standalone Playwright | as-is | no lock (fast iteration / investigation — spec'd residual risk) |

Inside `test-all.sh` the stages (pytest, vitest, shards) already run under
its acquired lock — nothing extra to do there.

**Mechanics** (`scripts/lib/test-lock.sh`, shared by the wrapper and the
self-acquisition):

- Lock file `${MEMO_TEST_LOCK_PATH:-/root/workspace/.memo-heavy-tests.lock}` — fixed absolute path on the container volume, outside every worktree, shared by all sessions; the file is never deleted or recreated.
- Queue: first attempt immediate; busy → status line `[lock] занят, ожидание 15/60 мин (прошло 900 с)` and retry every `MEMO_LOCK_POLL_S` (default 300 s); ceiling `MEMO_LOCK_WAIT_S` (default 3600 s) counted by actual waited time (the sleep is clipped to the remainder).
- Ceiling exhausted → exit code **75** (distinct from any test failure — automation can tell «busy» from «red») with «машина занята чужим тяжёлым прогоном дольше 60 мин; перезапусти прогон позже». The answer is literally to rerun later.
- The lock fd lives in the owner process only (`test-all.sh` or the wrapper); every spawned command/stage runs with the fd closed (`9>&-`) — `kill -9` of the owner frees the lock instantly, surviving orphans never hold it.
- Reentrancy: the owner exports `MEMO_TEST_LOCK_HELD=1`; a nested heavy call under it skips acquiring and runs through.
- Bypass — the run proceeds WITHOUT the lock, one notice line (`[lock] обход без замка: … — прогон НЕ сериализован`), suppressed under real `CI=true` — when the lock dir is missing/not writable (it is never auto-created), `flock` is absent, or `MEMO_TEST_LOCK_DISABLE=1`.

**Never wrap `test-all.sh` in `with-test-lock.sh`** — the script self-acquires
before the `SEQUENTIAL=1` branch, so both run shapes serialize; the wrapper
exists for entry points WITHOUT a built-in acquire (its own header says the
same).

**Session gate (G7 fast suite) batch pattern:** one wrapper call for the
whole heavy batch beats per-command wrapping — pytest and vitest run
back-to-back under a single acquire instead of re-queueing between them:

```bash
scripts/with-test-lock.sh bash -c '(cd backend && uv run pytest) && (cd frontend/admin && pnpm run test)'
```

Per-command wrapping is also valid — it just serializes pytest→vitest inside
the session (+1–3 min, the accepted price). Lint and type-check stay outside
the lock.

**Not the seed lock:** `test-all.sh` also takes a short mkdir lock
(`${TMPDIR:-/tmp}/memo-testall-master-seed.lock`, #317 §8) around master-DB
seeding — best-effort, dropped after 60 s of waiting with a warning. The two
are deliberately different idioms (short & soft vs strict & queued for the
whole run); they are NOT to be unified.

### Pre-push hook
- Source: `scripts/git-hooks/pre-push`
- Installed by `pnpm install` (postinstall via `scripts/install-hooks.sh`, which is worktree-aware), but **disabled — a no-op** (`exit 0`)
- Local pre-push checking is done by the container harness at G7 (fast suite: backend pytest + vitest + type-check + lint — see `finishing-a-development-branch` skill); full local runs are on demand (`bash scripts/test-all.sh`)
- Busy machine: the no-op hook takes no lock and never waits — a push itself is never blocked by a heavy run. The queue/exit-75 behavior lives where heavy runs actually start: the G7 fast suite (whole pytest + whole vitest under `with-test-lock.sh`, batch pattern above) and any `test-all.sh` run
- Re-install manually: `bash scripts/install-hooks.sh`
- Skip once (moot while the hook is a no-op): `git push --no-verify`

### Parallelism in test-all.sh
The script runs stages concurrently using background processes and `wait`:

```
Backend pytest ───────────────┐
                              ├── wait for all
Lint + type-check + vitest ───┤   │
                              │   │
Playwright --shard=1/2 ───────┤   │
Playwright --shard=2/2 ───────┘   │
                                  │
Visual compliance (after all) ─────┘
```

- Backend pytest runs in parallel with frontend stages
- Lint, type-check, and vitest run in parallel with each other
- 2 native Playwright shards (`--shard=1/2`, `--shard=2/2`) run in parallel (each with its own server stack)
- Visual compliance runs last (needs admin dev server on `:3001`)
- 2 shards instead of 5 to avoid CPU contention on 4-core machines (5 parallel Next.js dev servers caused 30s+ page loads)

### Visual compliance check
- Script: `scripts/visual-compliance-check.sh`
- Loads each URL from `docs/specs/2026-06-19-current-user-scenarios.md` and checks for visual errors
- Runs after all other tests pass, against the running admin dev server on `:3001`
- URL for dev server can be overridden with `VISUAL_COMPLIANCE_URL`

## Visual regression

Visual regression tests use Playwright's `toHaveScreenshot` with committed PNG baselines.

**Baselines location:**
- `frontend/admin/e2e/week-view.spec.ts-snapshots/`
- `frontend/admin/e2e/visual-regression.spec.ts-snapshots/`
- `frontend/admin/e2e/wave6-status-snapshots.spec.ts-snapshots/`

**Update baselines when UI intentionally changes:**
- `cd frontend/admin && pnpm run test:e2e:update`
- Then commit the new PNG files

> **Note on baseline provenance:** All screenshot baselines in this repo
> (the snapshot directories listed above) are recorded in the CI environment
> via `.github/workflows/update-snapshots.yml`, deliberately — to avoid
> font/OS rendering drift between local and CI. This has a known consequence
> described under [Known caveats](#known-caveats) below.

**Date stability:**
- The 8 visual tests in `week-view.spec.ts` and `visual-regression.spec.ts` use `page.clock.install()` in `test.beforeEach` to mock browser time
- Combined with `WEEK_FIXED_START = datetime(2026, 6, 15)` in `seed.py`, this produces date-stable screenshots
- Baselines only need re-recording when the seed or UI intentionally changes, not when "today" rolls forward

## E2E test patterns

### `openModal()` / `openAddTab()` — date-independent
- `frontend/admin/e2e/fixtures/helpers.ts` exports `openModal` and `openAddTab`
- Both query the DB for the record's activity date via `resolveRecordDate()`
- Then navigate directly to that week via `navigateToWeek()` (uses `__memo-switch-to-week-view` event)
- **Source of truth is the DB**, not the wall clock — these helpers work regardless of when tests run

The flow:
1. `resolveRecordDate(recordId?)` runs raw SQL against the test DB:
   ```sql
   SELECT substr(a.start, 1, 10) AS d
   FROM records r
   JOIN activities a ON r.activity_id = a.id
   WHERE r.id = '...'
   ```
2. `navigateToWeek(page, date)` dispatches a custom DOM event:
   ```ts
   document.dispatchEvent(new CustomEvent('__memo-switch-to-week-view', { detail: { date } }));
   ```
3. Waits for `[data-testid^="activity-"]` to appear, then 300ms buffer

### `resolveRecordDate()` — DB as source of truth
- If no `recordId` given, finds the first active record (ORDER BY r.id ASC LIMIT 1)
- Returns ISO date string (`YYYY-MM-DD`) or `null`
- Used not only by `openModal`/`openAddTab` but also directly in tests that need to know "what week is this record in?"

### Direct DB queries
- Use `queryDBRow` / `queryDBRows` from `frontend/admin/e2e/fixtures/db-query.ts`
- Reads `TEST_DB_PATH` env var (set by `scripts/test-all.sh`)
- Polling pattern: `expect.poll(..., { timeout: 30_000, intervals: [200, 500, 1000] })`
- Known issue: some tests poll for DB writes after API success, and the writes aren't always visible to the `sqlite3` CLI (WAL mode race). These are tracked separately as flaky tests.

### Global setup / cleanup
- `frontend/admin/e2e/globalSetup.ts` runs once per Playwright run: it resets the DB via the same canonical `RESET_SQL` as the per-test reset (single source of truth — `e2e/fixtures/seed-reset.ts`), then runs the #152 seed-contract checks (seed rows present, current-week activities non-empty), logs the seeded admin in via the backend API and saves the session cookie as the shard-scoped `storageState` (`frontend/test-results/.auth/admin-${SHARD_ID ?? 'standalone'}.json`; GH #247 T14), and runs the standalone route warmup.
- **Auth storageState (GH #247 T14):** both Playwright projects start authenticated as admin `+79990000001/admin12345`; the filename is shard-scoped via the shared `e2e/fixtures/auth-state.ts` helper (parallel shards have separate DBs — a foreign-DB token would mass-401), and `playwright.config.ts` pins the project default and the frontend `baseURL` to `http://127.0.0.1:{SHARD_PORT}` — pages and the API (`BACKEND_URL`) must be same-site for the HttpOnly SameSite=Lax `memo_session` cookie to flow (localhost would make every API fetch cross-site). Login-flow specs opt out with `test.use({ storageState: { cookies: [], origins: [] } })` — `undefined` does NOT override a project default. `RESET_SQL` deliberately never touches `users`/`sessions`, so the storageState session survives the per-test reset. Logout specs must establish their OWN session (API login + `context.addCookies`) — revoking the shard's stored token bounces every later spec to `/login`.
- The old manual `cleanTestData()` helper is deleted (GH #252) — per-test cleaning is now automatic, see below.

### Per-test seed reset (GH #252)

Every e2e test now starts from canonical seed state: the wrapper `test` (`e2e/fixtures/test.ts`) registers an auto test-scoped fixture that resets the DB **before every test, incl. retries** — nothing an earlier test (incl. a crashed one) left behind can leak into yours. This kills the shared-shard order-dependence flake class.

What a spec author must know:

- **Import `test` from `./fixtures/test` in every spec** (standing rule — grep check rides reviews; the wrapper re-exports `expect`). Importing from `@playwright/test` silently drops the reset. The reset runs `resetToSeed()` from `e2e/fixtures/seed-reset.ts` — ONE canonical `RESET_SQL`, shared verbatim with `globalSetup` (children-first DELETEs incl. visitors, prefix-filtered activities, `sort_order` CASE-restores, `PRAGMA busy_timeout`), so no drift is possible.
- **Never mutate or delete seed rows.** The reset deletes non-seed rows only — it does NOT restore seed rows (`seed.py` stays the single seed source). Untouchable: clients `c1–c5`, visitors `vis1–vis10`, records `r1–r6`, visits `v1–v10`, payments `p1–p6`, activities `ev_*`/`ev_fixed_*`, and the canonical `sort_order` of masters `m1–m5`/`m7` + locations `alpika`/`grand`/`p1389`. Build your own rows via `e2e/fixtures/factories.ts` (`createTestClient`, `createTestRecord`, `createTestVisit`, …); clean them up records-before-clients.
- **Reset does NOT heal corrupted seed rows.** Crashed/leaked non-seed data self-heals on the next reset, but a mutated/deleted seed row needs a reseed. From the repo root:
  ```bash
  rm backend/test_memo.db
  cd backend && DATABASE_URL="sqlite+aiosqlite:///$(pwd)/test_memo.db" PYTHONPATH=src uv run python -m seed.seed
  ```
  The next `test-all.sh` run re-copies the reseeded master to both shard DBs.
- **Local runs are serial.** `workers: 1` is pinned in `playwright.config.ts` (CI was already serial) and the fixture throws a labeled error when `workers > 1` — an accidental parallel override fails loudly instead of silently reintroducing reset races.
- **Retries snapshot the DB first.** When a test is retried (`testInfo.retry > 0`; CI sets `retries: 1`), the fixture saves a consistent pre-reset copy (`db-before-reset.sqlite`) into the test's output dir — the crashed state survives the reset as failure evidence.
- **Семантика канона закреплена pytest-сьютом (GH #373).** Контракт `resetToSeed` — что канон восстанавливает и что намеренно щадит — закреплён в `backend/tests/test_seed_canon.py` (маркер `misc`): реальная схема и реальный сид, генерация канона боевым `scripts/gen_seed_canon.py`, применение той же командой sqlite3, что и обёртка; 7 семантик — полный restore, канонический `sort_order`, пользователи по сиду, очистка `user_settings` целиком, исключения `audit_logs`/`sessions`/таблицы notify-журнала, `notify_templates` в каноне, идемпотентность. Витест-файл обёртки (`frontend/admin/__tests__/seed-reset.test.ts`) проверяет только чистые функции обёртки и громкую ошибку отсутствующего canon-файла. Мотивировка — в [спеке переноса](specs/2026-10-21-seed-canon-pytest-move-design.md).

## CI vs local

**Trigger scheme** (details in [the CI-triggers spec](specs/2026-09-07-ci-triggers-and-gates-split-design.md)):
- CI (`test.yml`) runs the full suite on `pull_request` + manual `workflow_dispatch` — pushes to main (incl. merges) start **nothing**; docs-only pushes run zero workflows.
- A newer commit pushed to an open PR cancels that PR's obsolete run (`concurrency` + `cancel-in-progress`); manual dispatches never cancel each other.
- Local pre-push checking is the G7 fast suite (see [Pre-push hook](#pre-push-hook) above), not the git hook. CI is the authoritative merge gate — especially for e2e.

**Key insight:** Tests should be reproducible locally before pushing. The G7 fast suite (backend pytest + vitest + type-check + lint) catches issues before CI; local e2e is an investigation tool, never a gate.

### Coverage map (test type × gate)

| Test type | G6 quality¹ | G4.5 visual² | G7 pre-push³ | CI Tests⁴ |
|---|---|---|---|---|
| backend pytest (unit/api/integration/misc — маркеры как локальные селекторы `pytest -m …`; в `misc` живёт канон сида: `test_seed_canon.py` закрепляет 7 семантик reset-канона — GH #373) | ✅ | — | ✅ | ✅ один джоб `backend-tests`: весь набор одним прогоном + coverage ≥ 80 (GH #416) |
| frontend vitest (только фронт; из e2e-обвязки в нём остаются лишь тесты чистых функций обёртки, без внешних процессов — GH #373) | ✅ | — | ✅ | ✅ (single run, no shards — GH #420) |
| workspace vitest (domain, api-client, web) | ✅ (`test:all`) | — | — | ✅ (`workspace-tests` — list derived from workspace globs, GH #420) |
| lint (ESLint, admin scope) | — | — | ✅ | ✅ (`frontend-checks`) |
| type-check (tsc, admin) | ~⁵ | — | ✅ | ✅ (`frontend-checks`) |
| web checks (lint + type-check + vitest) | — | — | — | ✅ (`web-checks` workflow — path-filtered: only PRs touching `frontend/web/**`, GH #314) |
| backend lint (ruff/mypy ratchet) | — | — | — | ✅ (`backend-lint`) |
| script guards (z-token, skip-tracker, shard dryrun; parser/smoke of visual scripts) | — | — | — | ✅ (z-token in `frontend-checks`; skip-tracker warning-only; `shard-script-checks` — GH #415; parser/smoke local-only via `test:all`) |
| e2e Playwright (4 CI shards) | — | — | forbidden⁶ | ✅ |
| visual compliance | ✅ (UI) | ✅ | — | ✅ (inside e2e) |

¹ G6: whole pytest / whole vitest by language; UI changes add playwright-visual (`test:all`). Mandatory only for Standard/Large tasks (review budget).
² G4.5: UI phases only, `visual-compliance-check.sh`, soft block.
³ G7: fast suite before every branch push. Policy, not mechanism — CI is the deterministic backstop.
⁴ CI Tests = `test.yml`: `pull_request` + `workflow_dispatch`; concurrency cancels obsolete PR runs, never dispatch runs.
⁵ Type-check is deliberately **not duplicated at G6**: its deterministic homes are the CI `frontend-checks` job and the G7 fast suite; frontend coders additionally keep `tsc --noEmit` green in their checklist.
⁶ Harness policy: local e2e is an investigation tool, never a gate; CI owns e2e.

**Anchor rule (GH #420, replaces a guard script by user decision — new packages are rare):**
a new test surface or a new CI gate/check lands WITH its row in this table, in the same PR.
This table is the inventory of what runs where; tests without a row here are suspected dead
coverage — exactly what GH #420 found (package and web tests ran under no gate at all until
`workspace-tests` closed the gap). Review holds the line: a PR adding tests or gates without
touching this table is incomplete.

**Anchor rule (GH #373): тесты живут по предмету, а не по потребителю.** Контракт закрепляется
в доме того стека, чей это предмет, а не там, где его случилось запускать: семантика канона
сида — предмет бэкенд-инфраструктуры, её держит pytest-сьют (`backend/tests/test_seed_canon.py`),
витест обёртки e2e — только чистые функции самой обёртки. Первый вопрос нового теста —
«чей это предмет?», и лишь потом — «кто его потребляет?».

In CI:
- `retries: 1` (vs 0 locally) — one automatic retry; a test that passes only on the retry gets status `flaky` and FAILS the job via the blocking flake gate (GH #415, see [E2E (automated)](#e2e-automated)); a retry first snapshots the DB (see [Per-test seed reset](#per-test-seed-reset-gh-252))
- `workers: 1` everywhere (config-pinned since GH #252, not just CI) — per-test DB resets cannot race across workers; the fixture throws on `workers > 1`
- `forbidOnly: true` — `test.only` blocks CI from passing

## Known caveats

### Screenshot e2e: pixel comparison runs in CI only (#278)

Screenshot e2e (the visual specs — `visual-regression.spec.ts`,
`week-view.spec.ts`, `wave6-status-snapshots.spec.ts`) compares page
snapshots against PNG baselines recorded **inside the CI runner** via
[`.github/workflows/update-snapshots.yml`](../.github/workflows/update-snapshots.yml).
Rendering depends on the distro's font stack, and the local container
(Debian 12: fontconfig 2.14 / freetype 2.12) differs from the runner
(ubuntu-latest: fontconfig 2.15 / freetype 2.13) even though the font
packages themselves already match — a 2026-10-07 measurement on a
CI-green `main` commit showed **46 of 71 visual checks failing locally**
with ~1% pixel drift on every text and shifted label widths. Local pixel
comparison is therefore pure environment noise, and it is disabled:

- **Local runs do not collect visual specs at all.** `playwright.config.ts`
  skips the three visual spec files unless `CI=true` (GitHub) or
  `E2E_VISUAL=1` is set. Naming an ignored spec directly returns
  Playwright's "No tests found" — that is expected; set `E2E_VISUAL=1`.
- **`E2E_VISUAL=1` (or `pnpm run test:e2e:visual`) opts back in for
  investigation** — to eyeball diffs and tell font drift from a genuinely
  broken layout. Red local visual runs under the opt-in are expected
  environment noise, not regressions.
- **CI is the source of truth for screenshot e2e.** The `e2e-tests` matrix of
  `.github/workflows/test.yml` (project `e2e`, `--shard=i/4`) runs all visual
  specs on every PR — the deterministic spec-file split spreads them across
  the 4 shards.
- **Manual visual verdict on a branch:** run the narrow check-only workflow
  (available after its file lands on `main`, on branches that contain it):
  `gh workflow run visual-check.yml --ref <branch>` (~10 min, diffs
  artifact on failure). The full suite has always been dispatchable via
  `gh workflow run test.yml --ref <branch>`.
- **Re-recording baselines is a CI-only operation.** Always run
  `.github/workflows/update-snapshots.yml`; never commit locally recorded
  PNGs. Locally `test:e2e:update` can no longer touch visual baselines at
  all (the specs are not collected).

Precedent: 2026-07-29 (IMPL #182) — 6 visual e2e failures in a local
worktree run while CI was green, classified as environment drift (before
the local skip existed). 2026-10-07 (#278) — the measurement above led to
the CI-only policy.

## See also

- `CONTRIBUTING.md` — local setup, pre-push hook, manual test commands
- `docs/specs/2026-06-19-testing-strategy-v2.md` — testing strategy (current)
- `docs/specs/2026-06-03-backend-testing.md` — backend testing handbook
- `docs/specs/2026-06-03-frontend-testing.md` — frontend testing handbook
- `docs/specs/2026-06-18-e2e-shard-5-projects-design.md` — 5-shard design (superseded by native `--shard`, GH #415)
- `docs/specs/2026-06-18-optimize-backend-tests-design.md` — backend test perf optimization
- `.opencode/skills/dev-workflow/SKILL.md` — dev environment, ports, PTY rule
