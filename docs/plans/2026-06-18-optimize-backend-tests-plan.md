# Backend Test Suite Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce full pytest suite from 30+ min to ≤5 min, add `pure_unit` marker for fast local smoke, ship as 1 PR.

**Architecture:** Session-scoped fixtures, alembic fast-path, truncate-per-test instead of drop+create, skip admin/alembic in test env, `pytest-xdist` for CI parallelism. Behavior changes get focused TDD tests.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, alembic, pytest, pytest-asyncio, pytest-xdist (new), pytest-cov (CI only).

**Spec:** `docs/specs/2026-06-18-optimize-backend-tests-design.md`

**Issue:** #68

**Branch:** `fix/optimize-backend-tests` (worktree at `.worktrees/fix-optimize-backend-tests/`)

---

## File Structure

### Files modified
- `backend/pyproject.toml` — markers, addopts, dev deps
- `backend/src/core/config.py` — `ENV` field
- `backend/src/main.py` — lifespan simplification, conditional alembic
- `backend/src/admin/setup.py` — skip in test env
- `backend/src/db/migrate.py` — fast-path at head
- `backend/tests/conftest.py` — session-scoped fixtures, pure_unit skip
- `backend/tests/test_migrate.py` — fast-path tests
- `backend/tests/test_main.py` — lifespan skip test
- `backend/tests/test_setup_admin.py` — new: skip test
- `backend/tests/test_schemas_search.py` — marker audit
- `backend/tests/test_schemas_user_settings.py` — marker audit
- `backend/tests/test_schemas_photo.py` — marker audit
- `backend/tests/test_schemas_client.py` — partial marker audit
- `backend/tests/test_models.py` — partial marker audit
- `backend/tests/test_edge_cases.py` — marker audit (no change likely)
- `.opencode/skills/pytest-patterns/SKILL.md` — markers section
- `.github/workflows/test.yml` — xdist for coverage job
- `backend/.env.dev` — `ENV=development` (no change needed if defaults work)

### Files NOT modified
- `backend/src/api/` — all routers unchanged
- `backend/src/models/` — models unchanged
- `backend/src/db/base.py` — Base unchanged
- `backend/src/seed/` — seed unchanged

---

## Task 1: Add pytest-xdist dev dependency

### Classification: trivial
### Required Docs
- None

### Task Description
Add `pytest-xdist` to dev dependencies in `backend/pyproject.toml` and verify install.

### Files
- Modify: `backend/pyproject.toml`

### Steps
- [ ] Edit `backend/pyproject.toml`: in `[dependency-groups].dev`, add `"pytest-xdist>=3.5"` after existing pytest deps
- [ ] Run: `cd backend && uv sync`
- [ ] Verify: `cd backend && uv run pytest --help | grep -A2 "xdist"` shows `-n` option
- [ ] Commit: `cd .worktrees/fix-optimize-backend-tests && git checkout -b fix/optimize-backend-tests 2>/dev/null || true; git add backend/pyproject.toml backend/uv.lock; git commit -m "chore(deps): add pytest-xdist for parallel test execution"`

---

## Task 2: Drop --cov from addopts in pyproject.toml

### Classification: trivial
### Required Docs
- None

### Task Description
Remove `--cov=src` from `[tool.pytest.ini_options].addopts`. Coverage now only runs in CI coverage job with explicit `--cov` flag.

### Files
- Modify: `backend/pyproject.toml`

### Steps
- [ ] Edit `backend/pyproject.toml`: change `addopts = ["--cov=src", "--cov-report=term-missing"]` to `addopts = []`
- [ ] Run: `cd backend && uv run pytest --collect-only -q 2>&1 | tail -5` — should complete in <1s (no coverage instrumentation)
- [ ] Commit: `git add backend/pyproject.toml && git commit -m "chore(pytest): drop --cov from addopts (CI uses explicit flag)"`

---

## Task 3: Alembic fast-path at head (TDD)

### Classification: small
### Required Docs
- `backend/src/db/migrate.py` — current implementation
- `backend/alembic/env.py` — env config
- `backend/alembic.ini` — alembic config

### Task Description
Add fast-path: if `alembic_version.version_num` equals script head, skip `command.upgrade`. Use TDD: RED test first, then GREEN impl.

### Files
- Modify: `backend/src/db/migrate.py`
- Modify: `backend/tests/test_migrate.py`

### Steps

**RED:**
- [ ] Read `backend/tests/test_migrate.py` and `backend/src/db/migrate.py`
- [ ] Add new test to `backend/tests/test_migrate.py`:
  ```python
  def test_run_alembic_upgrade_fast_path_when_at_head(tmp_path) -> None:
      """When alembic_version matches script head, skip command.upgrade (fast path)."""
      from alembic.script import ScriptDirectory
      from src.db.base import Base
      from src.db.database import DBManager
      from src.db.migrate import run_alembic_upgrade

      test_db = tmp_path / "test_fast_path.db"
      test_url = f"sqlite+aiosqlite:///{test_db}"

      async def scenario():
          mgr = DBManager(test_url, echo_mode=False)
          async with mgr.engine.begin() as conn:
              await conn.run_sync(Base.metadata.create_all)
          # Stamp to head first
          sync_url = test_url.replace("+aiosqlite", "")
          cfg = Config(str(BACKEND_DIR / "alembic.ini"))
          cfg.set_main_option("sqlalchemy.url", sync_url)
          cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
          command.stamp(cfg, "head")

          # Now call run_alembic_upgrade — must complete without error
          await run_alembic_upgrade(test_url)

          async with mgr.engine.connect() as conn:
              version = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()
              assert version is not None
          await mgr.engine.dispose()

      asyncio.run(scenario())
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_migrate.py::test_run_alembic_upgrade_fast_path_when_at_head -v` — **MUST FAIL** (current impl calls `command.upgrade` even at head)
- [ ] Confirm RED: error should be import error or assertion error, not infrastructure failure

**GREEN:**
- [ ] Edit `backend/src/db/migrate.py`:
  ```python
  from alembic.script import ScriptDirectory

  async def run_alembic_upgrade(database_url: str) -> None:
      backend_dir = Path(__file__).resolve().parents[2]
      cfg = Config(str(backend_dir / "alembic.ini"))
      sync_url = database_url.replace("+aiosqlite", "")
      cfg.set_main_option("sqlalchemy.url", sync_url)
      cfg.set_main_option("script_location", str(backend_dir / "alembic"))

      script_head = ScriptDirectory.from_config(cfg).get_heads()[0]

      engine = create_async_engine(database_url, echo=False)
      try:
          async with engine.connect() as conn:
              result = await conn.execute(text("SELECT version_num FROM alembic_version"))
              current = result.scalar()
              if current is None:
                  logger.warning("alembic_version missing — stamping to head (legacy DB bootstrap)")
                  command.stamp(cfg, "head")
                  return
              if current == script_head:
                  logger.debug("Already at head — skipping upgrade")
                  return
      finally:
          await engine.dispose()

      logger.info("Running alembic upgrade head")
      command.upgrade(cfg, "head")
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_migrate.py -v` — all 3 tests must pass
- [ ] Commit: `git add backend/src/db/migrate.py backend/tests/test_migrate.py && git commit -m "perf(db): add alembic fast-path when at head"`

---

## Task 4: Add Settings.ENV field

### Classification: trivial
### Required Docs
- `backend/src/core/config.py` — current Settings class

### Task Description
Add `ENV: str = "development"` field to Settings. Reads from `ENV` env var (or `.env` file via pydantic-settings).

### Files
- Modify: `backend/src/core/config.py`

### Steps
- [ ] Read `backend/src/core/config.py` — find Settings class
- [ ] Add field: `ENV: str = "development"` (place near other top-level config fields)
- [ ] Run: `cd backend && uv run python -c "from src.core.config import settings; print(settings.ENV)"` — should print "development"
- [ ] Run: `cd backend && ENV=testing uv run python -c "from src.core.config import settings; print(settings.ENV)"` — should print "testing"
- [ ] Commit: `git add backend/src/core/config.py && git commit -m "feat(config): add ENV field for environment-based config switching"`

---

## Task 5: Skip setup_admin in test env (TDD)

### Classification: small
### Required Docs
- `backend/src/admin/setup.py` — current setup_admin function
- `backend/src/main.py` — where setup_admin is called

### Task Description
Skip `setup_admin(app)` call when `settings.ENV == "testing"`. Use TDD.

### Files
- Modify: `backend/src/main.py`
- Create: `backend/tests/test_admin_env.py`

### Steps

**RED:**
- [ ] Create `backend/tests/test_admin_env.py`:
  ```python
  """Test that setup_admin is skipped in test env."""
  from src.core.config import settings
  from src.admin.setup import setup_admin
  from fastapi import FastAPI

  def test_setup_admin_called_when_not_testing(monkeypatch):
      """When ENV != 'testing', setup_admin runs normally."""
      monkeypatch.setattr(settings, "ENV", "development")
      app = FastAPI()
      setup_admin(app)
      # sqladmin attaches routes; check that admin route exists
      assert any("/admin" in r.path for r in app.routes)

  def test_setup_admin_skipped_when_testing(monkeypatch):
      """When ENV == 'testing', setup_admin is a no-op."""
      monkeypatch.setattr(settings, "ENV", "testing")
      app = FastAPI()
      setup_admin(app)
      # No admin routes should be added
      assert not any("/admin" in r.path for r in app.routes)
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py -v` — both tests must FAIL (current setup_admin always runs)

**GREEN:**
- [ ] Edit `backend/src/main.py:61`: change `setup_admin(app)` to:
  ```python
  if settings.ENV != "testing":
      setup_admin(app)
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py -v` — both tests must PASS
- [ ] Commit: `git add backend/src/main.py backend/tests/test_admin_env.py && git commit -m "feat(admin): skip setup_admin in test env"`

---

## Task 6: Skip run_alembic_upgrade in test env lifespan (TDD)

### Classification: small
### Required Docs
- `backend/src/main.py` — current lifespan
- `backend/src/db/migrate.py` — run_alembic_upgrade

### Task Description
Skip `run_alembic_upgrade` call in lifespan when `settings.ENV == "testing"`. Tests will run alembic once via session-scoped fixture (Task 10).

### Files
- Modify: `backend/src/main.py`

### Steps

**RED:**
- [ ] Add test to `backend/tests/test_admin_env.py` (or new `backend/tests/test_lifespan.py`):
  ```python
  def test_lifespan_skips_alembic_in_test_env(monkeypatch):
      """When ENV == 'testing', lifespan does not call run_alembic_upgrade."""
      from unittest.mock import AsyncMock, patch
      from src.main import lifespan
      from fastapi import FastAPI

      monkeypatch.setattr(settings, "ENV", "testing")
      with patch("src.main.run_alembic_upgrade", new=AsyncMock()) as mock:
          app = FastAPI()
          async with lifespan(app):
              pass
          mock.assert_not_called()
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py::test_lifespan_skips_alembic_in_test_env -v` — must FAIL (current code always calls)

**GREEN:**
- [ ] Edit `backend/src/main.py:32-38`:
  ```python
  @asynccontextmanager
  async def lifespan(_app: FastAPI):
      if settings.ENV != "testing":
          await run_alembic_upgrade(str(settings.DATABASE_URL))
      yield
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py -v` — all tests pass
- [ ] Commit: `git add backend/src/main.py backend/tests/test_admin_env.py && git commit -m "feat(db): skip alembic upgrade in test env lifespan"`

---

## Task 7: Remove redundant Base.metadata.create_all from main.py lifespan

### Classification: small
### Required Docs
- `backend/src/main.py` — current lifespan

### Task Description
Remove `Base.metadata.create_all` from lifespan — alembic now owns schema creation. The `create_all` was redundant with `run_alembic_upgrade`.

### Files
- Modify: `backend/src/main.py`

### Steps
- [ ] Read `backend/src/main.py:32-38` — current lifespan
- [ ] Remove the `async with db_manager.engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)` block
- [ ] Remove `from src.db.base import Base` import if no longer used in main.py
- [ ] Run: `cd backend && uv run pytest tests/test_migrate.py tests/test_admin_env.py -v` — all pass
- [ ] Commit: `git add backend/src/main.py && git commit -m "refactor(db): remove redundant create_all from lifespan (alembic owns schema)"`

---

## Task 8: Remove redundant create_all from setup_admin

### Classification: small
### Required Docs
- `backend/src/admin/setup.py` — current setup_admin

### Task Description
Remove the `Base.metadata.create_all(sync_engine)` call from setup_admin. Alembic already creates all tables; this is redundant.

### Files
- Modify: `backend/src/admin/setup.py`

### Steps
- [ ] Read `backend/src/admin/setup.py:151-162` — current setup_admin
- [ ] Remove `Base.metadata.create_all(sync_engine)` line (or the `sync_engine` entirely if not used elsewhere)
- [ ] Keep the sync_engine for sqladmin's `Admin(app, engine=sync_engine)` argument
- [ ] Run: `cd backend && uv run pytest tests/test_admin.py -v` — all pass (when not in test env)
- [ ] Commit: `git add backend/src/admin/setup.py && git commit -m "refactor(admin): remove redundant create_all from setup_admin"`

---

## Task 9: Session-scope app fixture (TDD)

### Classification: small
### Required Docs
- `backend/tests/conftest.py` — current fixtures
- `backend/src/main.py` — create_app

### Task Description
Add `app` fixture with `scope="session"`. Test that the same app instance is reused across multiple tests.

### Files
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_admin_env.py` (or new test file)

### Steps

**RED:**
- [ ] Add test to `backend/tests/test_admin_env.py`:
  ```python
  def test_app_fixture_is_session_scoped():
      """The app fixture returns the same instance across calls in a session."""
      from tests.conftest import app
      app1 = app()
      app2 = app()
      assert app1 is app2
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py::test_app_fixture_is_session_scoped -v` — must FAIL (no `app` fixture exists)

**GREEN:**
- [ ] Edit `backend/tests/conftest.py`: add new fixture:
  ```python
  @pytest.fixture(scope="session")
  def app():
      from src.main import create_app
      return create_app()
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py::test_app_fixture_is_session_scoped -v` — must PASS
- [ ] Commit: `git add backend/tests/conftest.py backend/tests/test_admin_env.py && git commit -m "test: add session-scoped app fixture"`

---

## Task 10: Session-scope db_engine fixture (TDD)

### Classification: standard
### Required Docs
- `backend/src/db/database.py` — DBManager
- `backend/alembic/env.py` — env config
- `backend/tests/conftest.py` — current reset_db

### Task Description
Add `db_engine` fixture with `scope="session"`. Runs alembic upgrade once. Schema is shared across all tests in session.

### Files
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_admin_env.py`

### Steps

**RED:**
- [ ] Add test:
  ```python
  def test_db_engine_fixture_is_session_scoped():
      """The db_engine fixture returns the same engine across calls in a session."""
      from tests.conftest import db_engine
      e1 = db_engine()
      e2 = db_engine()
      assert e1 is e2
  ```
- [ ] Run: must FAIL (no `db_engine` fixture)

**GREEN:**
- [ ] Add to `backend/tests/conftest.py`:
  ```python
  @pytest.fixture(scope="session")
  def db_engine():
      """Async engine shared across all tests; schema created once via alembic."""
      import os
      from alembic import command
      from alembic.config import Config
      from sqlalchemy import text
      from src.db.database import DBManager

      test_db_path = os.environ.get("TEST_DB_PATH")
      if not test_db_path:
          import tempfile
          fd, test_db_path = tempfile.mkstemp(suffix=".db")
          os.close(fd)
          os.environ["TEST_DB_PATH"] = test_db_path

      test_url = f"sqlite+aiosqlite:///{test_db_path}"
      sync_url = f"sqlite:///{test_db_path}"

      # Run alembic once at session start
      backend_dir = Path(__file__).resolve().parents[1]
      cfg = Config(str(backend_dir / "alembic.ini"))
      cfg.set_main_option("sqlalchemy.url", sync_url)
      cfg.set_main_option("script_location", str(backend_dir / "alembic"))
      command.upgrade(cfg, "head")

      mgr = DBManager(test_url, echo_mode=False)
      yield mgr.engine
      # Cleanup
      import asyncio
      asyncio.run(mgr.engine.dispose())
      if os.path.exists(test_db_path):
          os.unlink(test_db_path)
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py::test_db_engine_fixture_is_session_scoped -v` — must PASS
- [ ] Commit: `git add backend/tests/conftest.py backend/tests/test_admin_env.py && git commit -m "test: add session-scoped db_engine fixture"`

---

## Task 11: Session-scope api_client fixture (TDD)

### Classification: small
### Required Docs
- `backend/tests/conftest.py` — current api_client

### Task Description
Change `api_client` fixture from function to session scope. Reuses one TestClient across all tests.

### Files
- Modify: `backend/tests/conftest.py`

### Steps
- [ ] Read current `api_client` fixture in `backend/tests/conftest.py:129-136`
- [ ] Change `@pytest.fixture` to `@pytest.fixture(scope="session")`
- [ ] Change `app = create_app()` to use the session-scoped `app` fixture (depend on it):
  ```python
  @pytest.fixture(scope="session")
  def api_client(app):
      with TestClient(app) as c:
          yield c
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_admin_env.py -v` — all pass
- [ ] Run: `cd backend && uv run pytest tests/test_api_records.py -v` — sample test file passes
- [ ] Commit: `git add backend/tests/conftest.py && git commit -m "perf(tests): make api_client session-scoped"`

---

## Task 12: Replace drop+create with truncate-per-test (TDD)

### Classification: standard
### Required Docs
- `backend/tests/conftest.py` — current reset_db fixture
- `backend/src/models/` — list of all models

### Task Description
Replace `drop_all + create_all` per test with `PRAGMA foreign_keys=OFF; DELETE FROM <each_table>; PRAGMA foreign_keys=ON`. ~10× faster.

### Files
- Modify: `backend/tests/conftest.py`

### Steps

**RED:**
- [ ] Add test to `backend/tests/test_admin_env.py`:
  ```python
  def test_reset_db_truncates_instead_of_drops(tmp_path, db_engine):
      """reset_db should clear rows (truncate), not drop tables."""
      from sqlalchemy import text
      import asyncio
      # Insert a row via direct SQL
      async def insert():
          async with db_engine.begin() as conn:
              await conn.execute(text("INSERT INTO masters (id, name) VALUES (9999, 'test')"))
      asyncio.run(insert())

      # Trigger reset (via autouse or manual)
      from tests.conftest import reset_db
      # ... manual call to verify truncate behavior
  ```
  (Adjust test to match actual reset_db implementation)
- [ ] Run: must FAIL or be skipped (TBD based on current implementation)

**GREEN:**
- [ ] Replace reset_db body in `backend/tests/conftest.py` with:
  ```python
  @pytest.fixture(autouse=True)
  def reset_db(request, db_engine):
      """Truncate all tables before each test. Skipped for pure_unit tests."""
      if "pure_unit" in request.keywords:
          yield
          return
      asyncio.run(_truncate_all(db_engine))
      yield

  async def _truncate_all(engine):
      from sqlalchemy import text
      from src.models import (
          Activity, Client, Location, Master, Material, Payment, Photo,
          Record, Service, Tag, Tariff, User, UserSettings, Visit, Visitor,
      )
      from src.db.base import Base
      async with engine.begin() as conn:
          await conn.execute(text("PRAGMA foreign_keys=OFF"))
          for table in reversed(Base.metadata.sorted_tables):
              await conn.execute(text(f"DELETE FROM {table.name}"))
          await conn.execute(text("PRAGMA foreign_keys=ON"))
  ```
- [ ] Run: `cd backend && uv run pytest -q` — all 544 tests pass
- [ ] Commit: `git add backend/tests/conftest.py && git commit -m "perf(tests): truncate-per-test instead of drop+create (~10x faster)"`

---

## Task 13: Add pure_unit marker to pyproject.toml

### Classification: trivial
### Required Docs
- None

### Task Description
Add `pure_unit` marker to `[tool.pytest.ini_options].markers` list.

### Files
- Modify: `backend/pyproject.toml`

### Steps
- [ ] Edit `backend/pyproject.toml`: add to markers list:
  ```toml
  "pure_unit: Fast tests, NO database (pydantic, validation, pure logic)",
  ```
- [ ] Run: `cd backend && uv run pytest --markers | grep pure_unit` — should show marker
- [ ] Commit: `git add backend/pyproject.toml && git commit -m "chore(pytest): add pure_unit marker for DB-free tests"`

---

## Task 14: Verify reset_db skip for pure_unit (TDD)

### Classification: small
### Required Docs
- `backend/tests/conftest.py` — reset_db fixture (after Task 12)

### Task Description
Verify that `reset_db` skips when `pure_unit` marker is present. This should already be implemented in Task 12; this task is the explicit test.

### Files
- Create: `backend/tests/test_pure_unit_marker.py`

### Steps
- [ ] Create test:
  ```python
  """Verify pure_unit marker behavior."""

  pytestmark = pytest.mark.pure_unit

  def test_pure_unit_test_runs_without_db():
      """A test marked pure_unit should not require database connection."""
      assert True

  def test_pure_unit_marker_is_registered():
      """The pure_unit marker is registered in pyproject.toml."""
      import subprocess
      result = subprocess.run(
          ["uv", "run", "pytest", "--markers"],
          capture_output=True, text=True, cwd="."
      )
      assert "pure_unit" in result.stdout
  ```
- [ ] Run: `cd backend && uv run pytest tests/test_pure_unit_marker.py -v` — both pass
- [ ] Verify skip: `cd backend && uv run pytest tests/test_pure_unit_marker.py -v -s 2>&1 | grep -i "reset_db\|truncate"` — should show no truncate calls
- [ ] Commit: `git add backend/tests/test_pure_unit_marker.py && git commit -m "test: verify pure_unit marker skips reset_db"`

---

## Task 15: Marker audit — test_schemas_search.py

### Classification: trivial
### Required Docs
- `backend/tests/test_schemas_search.py`

### Task Description
Add `pytestmark = pytest.mark.pure_unit` to `test_schemas_search.py` (5 tests, pure pydantic).

### Files
- Modify: `backend/tests/test_schemas_search.py`

### Steps
- [ ] Read file — verify no `api_client`, `db_engine`, or DB fixtures used
- [ ] Add at module level (after imports): `pytestmark = pytest.mark.pure_unit`
- [ ] Remove existing `pytestmark = pytest.mark.unit` if present
- [ ] Run: `cd backend && uv run pytest tests/test_schemas_search.py -v` — all pass
- [ ] Commit: `git add backend/tests/test_schemas_search.py && git commit -m "test: mark test_schemas_search as pure_unit"`

---

## Task 16: Marker audit — test_schemas_user_settings.py

### Classification: trivial
### Required Docs
- `backend/tests/test_schemas_user_settings.py`

### Task Description
Reclassify as `pure_unit` (9 tests, pure pydantic).

### Files
- Modify: `backend/tests/test_schemas_user_settings.py`

### Steps
- [ ] Read file — verify pure pydantic, no DB
- [ ] Add `pytestmark = pytest.mark.pure_unit` (replace existing marker)
- [ ] Run tests, commit (same pattern as Task 15)

---

## Task 17: Marker audit — test_schemas_photo.py

### Classification: trivial
### Required Docs
- `backend/tests/test_schemas_photo.py`

### Task Description
Reclassify as `pure_unit` (3 tests, pure pydantic).

### Files
- Modify: `backend/tests/test_schemas_photo.py`

### Steps
- [ ] Same as Task 15

---

## Task 18: Marker audit — test_schemas_client.py (partial)

### Classification: small
### Required Docs
- `backend/tests/test_schemas_client.py`

### Task Description
14 of 20 tests are pure pydantic; 6 use `api_client`. Split: pure tests get `pure_unit`, DB tests get `unit` (or no marker).

### Files
- Modify: `backend/tests/test_schemas_client.py`

### Steps
- [ ] Read file, identify pure vs DB tests
- [ ] If file-level marker exists, remove it
- [ ] Add `@pytest.mark.pure_unit` to each pure test function (or split into 2 files)
- [ ] Run tests, commit

---

## Task 19: Marker audit — test_models.py (partial)

### Classification: small
### Required Docs
- `backend/tests/test_models.py`

### Task Description
~20 of 58 tests are pure schema inspection (no DB). Mark these `pure_unit`.

### Files
- Modify: `backend/tests/test_models.py`

### Steps
- [ ] Read file, identify tests that use `_make_engine()` vs pure schema inspection
- [ ] Mark pure tests as `pure_unit` (or split file)
- [ ] Run tests, commit

---

## Task 20: Update pytest-patterns skill with markers section

### Classification: small
### Required Docs
- `.opencode/skills/pytest-patterns/SKILL.md` — current content

### Task Description
Add "## Markers" section to skill with all 5 markers, decision rule, and example.

### Files
- Modify: `.opencode/skills/pytest-patterns/SKILL.md`

### Steps
- [ ] Read current skill
- [ ] Add section after the intro:
  ```markdown
  ## Markers

  Use these pytest markers to classify tests:

  | Marker | When to use |
  |--------|-------------|
  | `pure_unit` | Pure pydantic validation, no DB, no API client. Use for `test_schemas_*` files. |
  | `unit` | Fast tests, may touch DB (legacy — prefer `pure_unit` for new tests) |
  | `api` | API endpoint tests via `TestClient` |
  | `integration` | Multi-step flows |
  | `misc` | Health, CORS, admin |

  **Decision rule**: Does this test use `api_client`, `db_engine`, or any factory fixture? If NO → `pure_unit`. If YES → `api` or `unit`.

  Apply at module level:
  ```python
  import pytest
  pytestmark = pytest.mark.pure_unit
  ```

  Or per test:
  ```python
  @pytest.mark.pure_unit
  def test_my_validation():
      assert validate(...) == expected
  ```

  **Fast local smoke**: `pytest -m pure_unit -q` (typically <10 sec).
  ```
- [ ] Verify: re-read file, section present
- [ ] Commit: `git add .opencode/skills/pytest-patterns/SKILL.md && git commit -m "docs(skills): document pytest markers including pure_unit"`

---

## Task 21: CI workflow — add -n auto to coverage job

### Classification: trivial
### Required Docs
- `.github/workflows/test.yml`

### Task Description
Add `-n auto` flag to `backend-coverage` job's pytest command for parallel execution.

### Files
- Modify: `.github/workflows/test.yml`

### Steps
- [ ] Read `.github/workflows/test.yml` — find `backend-coverage` job
- [ ] Modify pytest command to include `-n auto`:
  ```yaml
  run: uv run pytest --cov=src --cov-report=xml --cov-fail-under=80 -n auto
  ```
- [ ] Verify: re-read file, change present
- [ ] Commit: `git add .github/workflows/test.yml && git commit -m "ci(backend): enable pytest-xdist for coverage job"`

---

## Task 22: Final verification — full suite time

### Classification: trivial
### Required Docs
- None

### Task Description
Run full suite, verify ≤ 5 min. If not, identify slow tests and revisit.

### Steps
- [ ] Run: `cd backend && time uv run pytest -q 2>&1 | tail -20`
- [ ] Verify: real time < 5 min (300 sec)
- [ ] Verify: all 544 tests pass (0 failures)
- [ ] Run smoke: `cd backend && time uv run pytest -m pure_unit -q 2>&1 | tail -5` — should be < 10 sec
- [ ] If full suite > 5 min: profile with `pytest --durations=20 -q`, identify top slow tests, consider further optimizations (e.g., xdist locally with `-n 2`)
- [ ] Document result in PR description

---

## Execution Notes

- All TDD tasks: write RED test first, confirm failure, then implement GREEN
- After each task, run focused tests for that area
- After all tasks, run full suite for final verification
- Commit after each task (small atomic commits, squash on merge)
- Update scratchpad after each completed task
- On blockers: re-dispatch with more context, do not fix yourself
