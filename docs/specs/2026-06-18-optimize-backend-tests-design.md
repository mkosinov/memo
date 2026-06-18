# Design: Optimize Backend Test Suite

**Date:** 2026-06-18
**Status:** Draft (pre-approved)
**Issue:** #68
**Branch:** `fix/optimize-backend-tests`
**Worktree:** `/root/workspace/memo/.worktrees/fix-optimize-backend-tests/`

## Problem

Full backend pytest suite takes 30+ minutes and times out at 300s with only 124/544 tests executed. Per-test fixture setup (~450-1100ms each) dominates cost: 4 engines, 4× `create_all`, 7 migration files imported per test, even when at head.

## Goal

Reduce full suite to **≤ 5 minutes** while keeping all 544 tests passing. Establish a fast local smoke path (`pytest -m pure_unit`).

## Approach (Big Bang, 1 PR)

All 4 phases of optimizations from issue #68, plus marker audit, plus skill update, in a single PR.

## Architecture Changes

### 1. `tests/conftest.py` — fixture restructuring

| Fixture | Old scope | New scope | Notes |
|---------|-----------|-----------|-------|
| `api_client` | function | **session** | One `TestClient` per session; per-test overhead minimal |
| `db_engine` | (implicit, per-test via reset_db) | **session** | One async engine; schema created by alembic once at session start |
| `reset_db` | autouse, function | autouse, function, **skip on `pure_unit`** | Truncate (not drop+create) for ~10× speedup |
| `app` | (created inside api_client) | **session** | Used by api_client + db_engine fixtures |

```python
@pytest.fixture(scope="session")
def app():
    from src.main import create_app
    return create_app()

@pytest.fixture(scope="session")
def db_engine():
    # Create schema once via alembic upgrade head
    from alembic import command
    from alembic.config import Config
    from src.db.database import DBManager
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", TEST_SYNC_URL)
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")
    mgr = DBManager(TEST_ASYNC_URL)
    return mgr.engine

@pytest.fixture
def api_client(app):
    with TestClient(app) as c:
        yield c

@pytest.fixture(autouse=True)
def reset_db(request, db_engine):
    if "pure_unit" in request.keywords:
        yield
        return
    asyncio.run(_truncate_all_tables(db_engine))
    yield
```

**`_truncate_all_tables`**: delete all rows from all tables in dependency order (or use `PRAGMA foreign_keys = OFF` + `DELETE FROM` + `PRAGMA foreign_keys = ON`). Faster than `drop_all + create_all`.

### 2. `backend/src/db/migrate.py` — alembic fast-path

```python
async def run_alembic_upgrade(database_url: str) -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    sync_url = database_url.replace("+aiosqlite", "")
    cfg.set_main_option("sqlalchemy.url", sync_url)
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    # Fast-path: if at head, skip command.upgrade
    script_head = ScriptDirectory.from_config(cfg).get_heads()[0]
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT version_num FROM alembic_version")
            )
            current = result.scalar()
            if current is None:
                logger.warning("alembic_version missing — stamping to head")
                command.stamp(cfg, "head")
            elif current == script_head:
                logger.debug("Already at head — skipping upgrade")
                return
    finally:
        await engine.dispose()

    logger.info("Running alembic upgrade head")
    command.upgrade(cfg, "head")
```

**Performance**: at-head check is ~5ms vs 100-250ms for `command.upgrade`.

### 3. `backend/src/main.py` — lifespan simplification

- Remove `Base.metadata.create_all` from lifespan (alembic owns schema)
- Conditional `run_alembic_upgrade`: skip if `settings.ENV == "testing"`

```python
@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.ENV != "testing":
        if settings.ENV != "production":  # dev/staging: ensure schema
            async with db_manager.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        await run_alembic_upgrade(str(settings.DATABASE_URL))
    yield
```

### 4. `backend/src/admin/setup.py` — skip admin setup in test env

```python
def setup_admin(app: FastAPI) -> None:
    if settings.ENV == "testing":
        return  # sqladmin not exercised by pytest
    # ... existing code
```

### 5. `backend/src/core/config.py` — ENV field

```python
class Settings(BaseSettings):
    # ... existing fields
    ENV: str = "development"
```

Read from `ENV` env var or `ENV_FILE`. Default `development`.

### 6. `backend/pyproject.toml` — config

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = [
    "unit: Fast tests, schemas/validation mostly + some DB",
    "pure_unit: Fast tests, NO database (pydantic, validation, pure logic)",
    "api: API endpoint tests (CRUD, status codes)",
    "integration: Complex flows, multi-step scenarios",
    "misc: Infrastructure, health, CORS, admin",
]
addopts = []  # --cov moved to CI coverage job

[dependency-groups]
dev = [
    # ... existing
    "pytest-xdist>=3.5",
]
```

### 7. Marker audit — manual reclassification

| File | Tests | New marker | Notes |
|------|------:|------------|-------|
| `test_schemas_search.py` | 5 | `pure_unit` | pure pydantic |
| `test_schemas_user_settings.py` | 9 | `pure_unit` | pure pydantic |
| `test_schemas_photo.py` | 3 | `pure_unit` | pure pydantic |
| `test_schemas_client.py` | 14 (of 20) | `pure_unit` | partial — 6 use `api_client`, keep `unit` for those |
| `test_models.py` | ~20 (of 58) | `pure_unit` | schema inspection only — non-DB |
| `test_edge_cases.py` | review | `unit` (no change) | mostly DB |
| **Total** | **~50** | `pure_unit` | |

Each file gets a module-level `pytestmark = pytest.mark.pure_unit` (or stays at `unit`/`api`/etc.).

### 8. `.opencode/skills/pytest-patterns/SKILL.md` — skill update

Add section `## Markers`:

- List all 5 markers with descriptions
- Decision rule: "Does this test touch a database, engine, or `api_client`? If NO → `pure_unit`."
- Example with `pytestmark = pytest.mark.pure_unit` at module level
- Fast smoke command: `pytest -m pure_unit -q`

### 9. `.github/workflows/test.yml` — CI changes

`backend-coverage` job: add `-n auto` flag for xdist.

```yaml
- name: Run tests with coverage
  run: uv run pytest --cov=src --cov-report=xml --cov-fail-under=80 -n auto
```

## Trade-offs

| Decision | Pro | Con |
|----------|-----|-----|
| Session-scoped `api_client` | ~90s saved | All tests share app; need careful fixture isolation |
| Truncate (not drop+create) | ~150s saved | Must handle FK constraints; some tests may rely on schema changes between tests |
| Skip alembic in test env lifespan | Cleaner test setup | Production behavior diverges — must trust session-scoped fixture |
| `pure_unit` marker audit | Fast local smoke | Manual classification error risk |
| Big Bang (1 PR) | Atomic, simple review | Large diff (~500 lines) |

## Risks

1. **Test isolation regression** — session-scoped app + truncate-per-test must be airtight. If any test mutates schema or relies on cross-test state, breaks.
2. **xdist + module-level singletons** — `db_manager` is module-level; xdist spawns subprocesses (separate engines), but `tmp_path` based DB might conflict. Verify with `-n 2` first.
3. **Marker mis-classification** — `pure_unit` test that actually hits DB will pass (autouse skip is silent). Need code review + integration test.
4. **CI coverage regression** — moving `--cov` out of `addopts` might miss coverage in local dev. Document `pytest --cov` for local coverage.

## Testing Strategy

- **No perf assertions** (fragile).
- **Regression**: all 544 tests must pass after changes.
- **Verification**: `time uv run pytest` ≤ 5 min (target: 3-5 min).
- **Smoke**: `pytest -m pure_unit` runs without DB.

Each behavior change gets a focused test:
- `test_migrate.py` — fast-path at head
- `test_main.py` — lifespan skip in test env
- `test_setup_admin.py` — skip in test env
- `test_conftest.py` — reset_db skip on `pure_unit`

## Acceptance Criteria

- [ ] `time uv run pytest` (full suite) ≤ 5 min
- [ ] All 544 tests pass
- [ ] `pytest -m pure_unit` runs in ≤ 10 sec
- [ ] CI `backend-coverage` job passes (coverage ≥ 80%)
- [ ] `pytest-patterns` skill updated with marker section
- [ ] 1 PR with 1 squash commit
- [ ] No production code behavior changes (only test/perf-impacted paths)

## Out of Scope

- Frontend test optimization
- E2E test changes
- Production code changes unrelated to perf
- Refactoring of test logic (only fixture/scope/marker changes)

## Implementation Plan (preview)

Will be detailed in `docs/plans/2026-06-18-optimize-backend-tests-plan.md` with bite-sized tasks classified by complexity.
