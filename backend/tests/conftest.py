"""
conftest.py — Memo project conftest with fixture factories.

Provides:
  - Temporary SQLite database (auto-managed, CI-safe)
  - reset_db fixture (drop_all + create_all before each test)
  - api_client fixture (sync TestClient)
  - Fixture factories: create_master, create_service, create_location,
    create_client, create_activity, create_record
  - query_db helper for direct SQL verification
  - Test markers: unit, api, integration, misc

Key patterns:
  - Uses sync TestClient, NOT AsyncClient
  - Uses drop_all + create_all, NOT rollback
  - Uses fixture-based factories, NOT factory_boy
  - Uses tempfile for DB, NOT fixed path (parallel-safe)
  - Run specific groups: pytest -m unit / pytest -m api / pytest -m integration
"""

import asyncio
from pathlib import Path
import os
import sqlite3
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

# ─── Pytest Markers ──────────────────────────────────────────────────────────────

def pytest_configure(config):
    """Register custom markers for test grouping."""
    config.addinivalue_line("markers", "unit: Fast tests, no DB (schemas, utils, validation)")
    config.addinivalue_line("markers", "api: API endpoint tests (CRUD, status codes)")
    config.addinivalue_line("markers", "integration: Complex flows, multi-step scenarios")
    config.addinivalue_line("markers", "misc: Infrastructure, health, CORS, admin")

import asyncio
import os
import sqlite3
import tempfile

import pytest
from fastapi.testclient import TestClient

# ─── Test Database ──────────────────────────────────────────────────────────────

# Use a temporary file for SQLite so connections work across event loops.
# In-memory SQLite (`:memory:`) creates a new database per connection, and
# ``asyncio.run()`` in ``reset_db`` runs in a different event loop than the
# TestClient's lifespan, causing "no such table" errors.
_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db_file.close()
_TEST_DB_URL = f"sqlite+aiosqlite:///{_db_file.name}"

os.environ["DATABASE_URL"] = _TEST_DB_URL
os.environ["ENV_FILE"] = ".env.test"

# Path to backend root (where alembic.ini lives)
BACKEND_DIR = Path(__file__).resolve().parents[1]


# ─── Database Reset ─────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_db():
    """Drop and recreate all tables before each test for isolation.

    This ensures zero data leaking between tests — each test starts with a
    clean database. Uses ``asyncio.run()`` because the shared ``db_manager``
    engine is async but the API tests are sync.
    """
    # Import all models so they register with Base.metadata, then reset.
    from sqlalchemy import event

    from src.db import db_manager  # noqa: F811
    from src.db.base import Base
    from src.models import (  # noqa: F401
        Activity,
        Client,
        Location,
        Master,
        Material,
        Payment,
        Photo,
        Record,
        Service,
        Tag,
        Tariff,
        User,
        UserSettings,
        Visit,
        Visitor,
    )

    # Enable FK enforcement on every new connection via engine event listener.
    # SQLite has FK enforcement OFF by default — this fixes that for tests.
    def _set_fk_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

    event.listen(db_manager.engine.sync_engine, "connect", _set_fk_pragma)

    async def _reset() -> None:
        async with db_manager.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

        # Stamp alembic to head so lifespan's run_alembic_upgrade is a no-op in tests.
        # Uses alembic's sync API directly (avoids async driver issues).
        import alembic.config as _alembic_cfg
        from alembic import command as _alembic_cmd

        _cfg = _alembic_cfg.Config(str(BACKEND_DIR / "alembic.ini"))
        _cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        # Use sync URL for alembic (alembic runs synchronously)
        _sync_url = _TEST_DB_URL.replace("+aiosqlite", "")
        _cfg.set_main_option("sqlalchemy.url", _sync_url)
        _alembic_cmd.stamp(_cfg, "head")

    asyncio.run(_reset())


# ─── HTTP Client ────────────────────────────────────────────────────────────────

@pytest.fixture
def api_client():
    """Shared TestClient — one per test."""
    from src.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


# ─── Fixture Factories ──────────────────────────────────────────────────────────

@pytest.fixture
def create_master(api_client):
    """Factory: creates a master via API.

    Usage::

        master = create_master()
        master = create_master(first_name="Ольга", color="#FF0000")
    """
    _counter = 0

    def factory(**overrides):
        nonlocal _counter
        _counter += 1
        payload = {
            "first_name": f"Test_{_counter}",
            "last_name": "Master",
            "color": "#5B8C7A",
            "position": "мастер",
            "specialty": "живопись",
            **overrides,
        }
        resp = api_client.post("/api/v1/masters", json=payload)
        assert resp.status_code == 201, f"create_master failed: {resp.status_code}: {resp.text}"
        return resp.json()
    return factory


@pytest.fixture
def create_service(api_client):
    """Factory: creates a service via API.

    Usage::

        service = create_service()
        service = create_service(title="Картина маслом", duration=150)
    """
    _counter = 0

    def factory(**overrides):
        nonlocal _counter
        _counter += 1
        payload = {
            "title": f"Test Service {_counter}",
            "description": "Test service description",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись",
            "min_age": 6,
            "max_age": 99,
            "duration": 90,
            "record_info": "Bring apron",
            **overrides,
        }
        resp = api_client.post("/api/v1/services", json=payload)
        assert resp.status_code == 201, f"create_service failed: {resp.status_code}: {resp.text}"
        return resp.json()
    return factory


@pytest.fixture
def create_location(api_client):
    """Factory: creates a location via API.

    Usage::

        location = create_location()
        location = create_location(name="Альпика", capacity=30)
    """
    _counter = 0

    def factory(**overrides):
        nonlocal _counter
        _counter += 1
        payload = {
            "name": f"Test Studio {_counter}",
            "address": f"Test Address {_counter}",
            "capacity": 20,
            **overrides,
        }
        resp = api_client.post("/api/v1/locations", json=payload)
        assert resp.status_code == 201, f"create_location failed: {resp.status_code}: {resp.text}"
        return resp.json()
    return factory


@pytest.fixture
def create_client(api_client):
    """Factory: creates a client via API. Uses UUID for unique phone.

    Usage::

        client = create_client()
        client = create_client(name="Анна", phone="+79990001122")
    """
    import uuid as _uuid

    def factory(**overrides):
        unique = _uuid.uuid4().hex[:6]
        payload = {
            "name": f"Client {unique}",
            "phone": f"+7999{_uuid.uuid4().hex[:7]}",
            "email": None,
            "channel": "telegram",
            **overrides,
        }
        resp = api_client.post("/api/v1/clients", json=payload)
        assert resp.status_code == 201, f"create_client failed: {resp.status_code}: {resp.text}"
        return resp.json()
    return factory


@pytest.fixture
def create_activity(api_client, create_master, create_service, create_location):
    """Factory: creates master + service + location + activity.

    This is a COMPOSABLE factory — it depends on create_master, create_service,
    create_location. Pytest resolves the chain automatically.

    Usage::

        activity = create_activity()
        activity = create_activity(capacity=5, is_private=True)

        from datetime import UTC, datetime, timedelta
        past = datetime.now(UTC) - timedelta(days=1)
        activity = create_activity(start=past)
    """
    def factory(**overrides):
        from datetime import UTC, datetime, timedelta

        master = create_master()
        service = create_service()
        location = create_location()
        start = overrides.pop("start", datetime.now(UTC) + timedelta(days=1))
        payload = {
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": start.isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": False,
            **overrides,
        }
        resp = api_client.post("/api/v1/activities", json=payload)
        assert resp.status_code == 201, f"create_activity failed: {resp.status_code}: {resp.text}"
        return resp.json()
    return factory


@pytest.fixture
def create_record(api_client, create_activity, create_client):
    """Factory: creates activity + client + record with 1 visit.

    This is the TOP-LEVEL composable factory. It creates the full chain:
    master → service → location → activity → client → record → visit.

    Usage::

        record = create_record()
        record = create_record(comment="VIP client")
        record = create_record(visits=[
            {"price": 3500, "status": "waiting"},
            {"price": 2500, "status": "waiting"},
        ])
    """
    def factory(**overrides):
        activity = create_activity()
        client = create_client()
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [{"name": "Гость", "price": 3500, "status": "waiting"}],
            **overrides,
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201, f"create_record failed: {resp.status_code}: {resp.text}"
        return resp.json()
    return factory


# ─── User Factory (direct DB — no user API exists) ──────────────────────────

@pytest.fixture
def _user():
    """Create a user row directly in the DB (no user API endpoint)."""
    import uuid as _uuid

    user_id = str(_uuid.uuid4())
    phone = f"+7999{_uuid.uuid4().hex[:7]}"

    from sqlalchemy import text
    from src.db import db_manager

    async def _insert():
        async with db_manager.async_session() as session:
            await session.execute(
                text(
                    "INSERT INTO users (id, phone, password_hash, role, "
                    "email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
                    "VALUES (:id, :phone, :hash, :role, 0, 0, 1, datetime('now'), datetime('now'))"
                ),
                {"id": user_id, "phone": phone, "hash": "test", "role": "admin"},
            )
            await session.commit()

    asyncio.run(_insert())
    return {"id": user_id, "phone": phone}


# ─── DB Verification Helper ────────────────────────────────────────────────────

def query_db(sql: str) -> list[dict]:
    """Execute SQL against the test database.

    Usage::

        rows = query_db("SELECT is_active FROM records WHERE id='...'")
        assert rows[0]["is_active"] == 0  # SQLite stores bool as 0/1
    """
    conn = sqlite3.connect(_db_file.name)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql).fetchall()
    conn.close()
    return [dict(r) for r in rows]
