"""
conftest.py — Memo project conftest with fixture factories.

Provides:
  - Temporary SQLite database (auto-managed, CI-safe)
  - reset_db fixture (truncate-per-test, ~10x faster than drop+create)
  - api_client fixture (sync TestClient)
  - Fixture factories: create_master, create_service, create_location,
    create_client, create_activity, create_record
  - query_db helper for direct SQL verification
  - Test markers: unit, api, integration, misc, pure_unit

Key patterns:
  - Uses sync TestClient, NOT AsyncClient
  - Uses truncate-per-test (DELETE FROM + PRAGMA foreign_keys=OFF), NOT rollback
  - Uses fixture-based factories, NOT factory_boy
  - Uses tempfile for DB, NOT fixed path (parallel-safe)
  - Run specific groups: pytest -m unit / pytest -m api / pytest -m integration
  - Run fast smoke: pytest -m pure_unit
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


# ─── Session-Scoped Fixtures ────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def app():
    """Session-scoped FastAPI app. Created once per test session."""
    from src.main import create_app
    return create_app()


@pytest.fixture(scope="session")
def db_engine(app):
    """Session-scoped async engine. Schema created once via alembic upgrade.

    Yields ``db_manager.engine`` so API routes and tests share the same
    database.  FK enforcement is enabled via a pool checkout-event listener.
    """
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import event
    from src.db import db_manager

    # Enable FK enforcement on every connection checkout via pool event listener.
    # SQLite has FK enforcement OFF by default — this fixes that for tests.
    # Using "checkout" (not "connect") because connection pooling reuses
    # connections, and "connect" only fires once per new DBAPI connection.
    @event.listens_for(db_manager.engine.sync_engine.pool, "checkout")
    def _set_fk_pragma_on_checkout(dbapi_conn, connection_record, connection_proxy):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

    # Run alembic once at session start to create/update schema
    db_url = str(db_manager.engine.url)
    sync_url = db_url.replace("+aiosqlite", "")
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", sync_url)
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")

    yield db_manager.engine


@pytest.fixture(scope="session")
def api_client(app, db_engine):
    """Session-scoped TestClient. One client for the entire test session.

    Depends on ``db_engine`` to ensure alembic creates schema before the
    app's lifespan runs (which may also call ``run_alembic_upgrade``).
    """
    with TestClient(app) as c:
        yield c


# ─── Database Reset ─────────────────────────────────────────────────────────────

async def _truncate_all_tables(engine):
    """Delete all rows from all tables in dependency order, preserving schema.

    Uses ``PRAGMA foreign_keys=OFF`` to avoid FK violation errors during
    deletion.  ~10x faster than drop+create: ~10-20ms vs 180-330ms per test.
    """
    from src.db.base import Base
    from src.models import (  # noqa: F401 — register models with Base.metadata
        Activity,
        Client,
        Location,
        Master,
        Material,
        Payment,
        Photo,
        Record,
        Service,
        ServiceMaterial,
        Tag,
        Tariff,
        User,
        UserSettings,
        Visit,
        Visitor,
    )

    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f"DELETE FROM {table.name}"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))


@pytest.fixture(autouse=True)
def reset_db(request, db_engine):
    """Truncate all tables before each test. Skipped for pure_unit tests.

    ~10x faster than drop+create: ~10-20ms vs 180-330ms per test.
    Schema is preserved (created once by session-scoped db_engine fixture).
    """
    if "pure_unit" in request.keywords:
        yield
        return
    asyncio.run(_truncate_all_tables(db_engine))
    yield


# ─── HTTP Client ────────────────────────────────────────────────────────────────
# api_client is now session-scoped — see top of file.


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
def create_tag(api_client):
    """Factory: creates a tag via API. Uses UUID for unique tag value.

    Usage::

        tag = create_tag()
        tag = create_tag(tag="beginner")
    """
    import uuid as _uuid

    def factory(**overrides):
        unique = _uuid.uuid4().hex[:8]
        payload = {
            "tag": f"tag-{unique}",
            **overrides,
        }
        resp = api_client.post("/api/v1/tags", json=payload)
        assert resp.status_code == 201, f"create_tag failed: {resp.status_code}: {resp.text}"
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


@pytest.fixture
def _create_activity_payload(api_client, create_master, create_service, create_location):
    """Factory: returns a raw payload dict for POST /api/v1/activities.

    Usage::

        payload = _create_activity_payload()
        resp = api_client.post("/api/v1/activities", json=payload)
    """
    def factory(**overrides):
        master = create_master()
        service = create_service()
        location = create_location()
        from datetime import UTC, datetime, timedelta
        start = overrides.pop("start", datetime.now(UTC) + timedelta(days=1))
        return {
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": start.isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": False,
            **overrides,
        }
    return factory


# ─── DB Verification Helper ────────────────────────────────────────────────────

# ─── Phase 0 Fixtures (tariff_id round-trip) ─────────────────────────────────

@pytest.fixture
def sample_tariff():
    """Insert a tariff row directly via SQL (no tariff API exists yet)."""
    import uuid as _uuid

    tariff_id = f"tariff-{_uuid.uuid4().hex[:8]}"
    query_db(
        f"INSERT INTO tariffs (id, service_id, title, price, is_active, created_at, updated_at) "
        f"VALUES ('{tariff_id}', 'svc-placeholder', 'Adult', 3500, 1, datetime('now'), datetime('now'))"
    )
    return tariff_id


@pytest.fixture
def sample_record_with_visit(create_record):
    """Create a record with at least one visit (uses existing create_record factory).

    Returns the record dict from the API response.
    """
    return create_record()


@pytest.fixture
def sample_visit_with_tariff(sample_record_with_visit):
    """Create a record with a visit that has tariff_id set.

    Inserts tariff_id directly into the DB (column exists but ORM model
    doesn't expose it yet — this is the whole point of Phase 0).
    """
    record = sample_record_with_visit
    visit_id = record["visits"][0]["id"]
    tariff_id = f"tariff-{__import__('uuid').uuid4().hex[:8]}"
    query_db(
        f"INSERT INTO tariffs (id, service_id, title, price, is_active, created_at, updated_at) "
        f"VALUES ('{tariff_id}', 'svc-placeholder', 'Adult', 3500, 1, datetime('now'), datetime('now'))"
    )
    query_db(f"UPDATE visits SET tariff_id = '{tariff_id}' WHERE id = '{visit_id}'")
    return {"record": record, "visit_id": visit_id, "tariff_id": tariff_id}


@pytest.fixture
def sample_visit_no_tariff(create_record):
    """Create a record with a visit that has no tariff (tariff_id=None).

    Uses create_record factory — visits are created without tariff_id
    (column exists in DB, ORM model doesn't have it, default is NULL).
    """
    record = create_record()
    visit_id = record["visits"][0]["id"]
    return {"record": record, "visit_id": visit_id}


# ─── Phase 1: db_session + sample fixtures (record_visits domain tests) ────

@pytest.fixture
async def db_session(db_engine):
    """Function-scoped async session for direct ORM operations in domain tests.

    Shares the session-scoped db_engine (same test database) but creates a
    fresh session per test for isolation.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.close()


@pytest.fixture
async def sample_record(api_client, db_session):
    """Create a Record with 2 active visits + anonym_visits=1 via API, return ORM object.

    Used by test_recompute_record_seats.
    """
    import uuid as _uuid
    from datetime import UTC, datetime, timedelta
    from src.models.record import Record

    master = api_client.post("/api/v1/masters", json={
        "first_name": "Rec", "last_name": "Master", "color": "#5B8C7A",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "Rec Service", "description": "Test", "image_url": "https://example.com/t.jpg",
        "specialty": "живопись", "min_age": 6, "max_age": 99, "duration": 90, "record_info": "test",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "Rec Studio", "address": "Rec Address", "capacity": 20,
    }).json()
    activity = api_client.post("/api/v1/activities", json={
        "master_id": master["id"], "service_id": service["id"],
        "location_id": location["id"],
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90, "capacity": 10, "is_private": False,
    }).json()
    client_obj = api_client.post("/api/v1/clients", json={
        "name": "Rec Client", "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "email": None, "channel": "telegram",
    }).json()

    record_resp = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client_obj["id"],
        "comment": "Test record for seats",
        "visits": [
            {"name": "Alice", "price": 3500, "status": "waiting"},
            {"name": "Bob", "price": 2500, "status": "waiting"},
        ],
    })
    assert record_resp.status_code == 201
    record_id = record_resp.json()["id"]

    # Set anonym_visits=1 directly in DB
    await db_session.execute(
        text("UPDATE records SET anonym_visits = 1 WHERE id = :id"),
        {"id": record_id},
    )
    await db_session.commit()

    # Expire cached state and reload fresh ORM object
    db_session.expire_all()
    record = await db_session.get(Record, record_id)
    return record


@pytest.fixture
async def sample_record_with_visits(api_client, db_session):
    """Create a Record with active visits having different statuses.

    Creates 2 visits: one 'visited', one 'waiting'.
    Used by test_recompute_record_status_derives_from_visits.
    """
    import uuid as _uuid
    from datetime import UTC, datetime, timedelta
    from src.models.record import Record

    master = api_client.post("/api/v1/masters", json={
        "first_name": "St", "last_name": "Master", "color": "#5B8C7A",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "St Service", "description": "Test", "image_url": "https://example.com/t.jpg",
        "specialty": "живопись", "min_age": 6, "max_age": 99, "duration": 90, "record_info": "test",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "St Studio", "address": "St Address", "capacity": 20,
    }).json()
    activity = api_client.post("/api/v1/activities", json={
        "master_id": master["id"], "service_id": service["id"],
        "location_id": location["id"],
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90, "capacity": 10, "is_private": False,
    }).json()
    client_obj = api_client.post("/api/v1/clients", json={
        "name": "St Client", "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "email": None, "channel": "telegram",
    }).json()

    record_resp = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client_obj["id"],
        "comment": "Test record for status",
        "visits": [
            {"name": "Charlie", "price": 3500, "status": "visited"},
            {"name": "Diana", "price": 2500, "status": "waiting"},
        ],
    })
    assert record_resp.status_code == 201
    record_id = record_resp.json()["id"]

    record = await db_session.get(Record, record_id)
    return record


@pytest.fixture
async def sample_activity_with_capacity(api_client, db_session):
    """Create an Activity with capacity=10, no records. Capacity check should pass."""
    from datetime import UTC, datetime, timedelta
    from src.models.activity import Activity

    master = api_client.post("/api/v1/masters", json={
        "first_name": "Cap", "last_name": "Master", "color": "#5B8C7A",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "Cap Service", "description": "Test", "image_url": "https://example.com/t.jpg",
        "specialty": "живопись", "min_age": 6, "max_age": 99, "duration": 90, "record_info": "test",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "Cap Studio", "address": "Cap Address", "capacity": 20,
    }).json()
    act_resp = api_client.post("/api/v1/activities", json={
        "master_id": master["id"], "service_id": service["id"],
        "location_id": location["id"],
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90, "capacity": 10, "is_private": False,
    })
    assert act_resp.status_code == 201
    activity_id = act_resp.json()["id"]

    activity = await db_session.get(Activity, activity_id)
    return activity


@pytest.fixture
async def sample_activity_at_capacity(api_client, db_session):
    """Create an Activity (capacity=1) with a record using all seats.

    Then check_activity_capacity(seats=1) should raise 409.
    """
    import uuid as _local_uuid
    from datetime import UTC, datetime, timedelta
    from src.models.activity import Activity

    master = api_client.post("/api/v1/masters", json={
        "first_name": "Full", "last_name": "Master", "color": "#FF0000",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "Full Service", "description": "Test", "image_url": "https://example.com/t.jpg",
        "specialty": "живопись", "min_age": 6, "max_age": 99, "duration": 90, "record_info": "test",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "Full Studio", "address": "Full Address", "capacity": 20,
    }).json()
    act_resp = api_client.post("/api/v1/activities", json={
        "master_id": master["id"], "service_id": service["id"],
        "location_id": location["id"],
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90, "capacity": 1, "is_private": False,
    })
    assert act_resp.status_code == 201
    activity_id = act_resp.json()["id"]

    # Create a client and record that fills the capacity
    client_obj = api_client.post("/api/v1/clients", json={
        "name": "Full Client", "phone": f"+7999{_local_uuid.uuid4().hex[:7]}",
        "email": None, "channel": "telegram",
    }).json()
    record_resp = api_client.post("/api/v1/records", json={
        "activity_id": activity_id,
        "client_id": client_obj["id"],
        "comment": "Full record",
        "visits": [{"name": "Guest", "price": 3500, "status": "waiting"}],
    })
    assert record_resp.status_code == 201

    activity = await db_session.get(Activity, activity_id)
    return activity


@pytest.fixture
async def sample_visit(api_client, db_session):
    """Create a single active Visit ORM object with its parent Record + Activity.

    Returns the Visit ORM object (not a dict). Used by VisitService CRUD tests.
    """
    import uuid as _uuid
    from datetime import UTC, datetime, timedelta
    from src.models.visit import Visit

    master = api_client.post("/api/v1/masters", json={
        "first_name": "V", "last_name": "Master", "color": "#5B8C7A",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "V Service", "description": "Test", "image_url": "https://example.com/t.jpg",
        "specialty": "живопись", "min_age": 6, "max_age": 99, "duration": 90, "record_info": "test",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "V Studio", "address": "V Address", "capacity": 20,
    }).json()
    activity = api_client.post("/api/v1/activities", json={
        "master_id": master["id"], "service_id": service["id"],
        "location_id": location["id"],
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90, "capacity": 10, "is_private": False,
    }).json()
    client_obj = api_client.post("/api/v1/clients", json={
        "name": "V Client", "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "email": None, "channel": "telegram",
    }).json()

    record_resp = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client_obj["id"],
        "comment": "Visit test record",
        "visits": [{"name": "Solo", "price": 3000, "status": "waiting"}],
    })
    assert record_resp.status_code == 201
    record_id = record_resp.json()["id"]
    visit_id = record_resp.json()["visits"][0]["id"]

    db_session.expire_all()
    visit = await db_session.get(Visit, visit_id)
    return visit


@pytest.fixture
async def sample_visits(api_client, db_session):
    """Create a Record with 3 active Visit ORM objects. Returns list[Visit]."""
    import uuid as _uuid
    from datetime import UTC, datetime, timedelta
    from src.models.visit import Visit

    master = api_client.post("/api/v1/masters", json={
        "first_name": "Vs", "last_name": "Master", "color": "#5B8C7A",
        "position": "мастер", "specialty": "живопись",
    }).json()
    service = api_client.post("/api/v1/services", json={
        "title": "Vs Service", "description": "Test", "image_url": "https://example.com/t.jpg",
        "specialty": "живопись", "min_age": 6, "max_age": 99, "duration": 90, "record_info": "test",
    }).json()
    location = api_client.post("/api/v1/locations", json={
        "name": "Vs Studio", "address": "Vs Address", "capacity": 20,
    }).json()
    activity = api_client.post("/api/v1/activities", json={
        "master_id": master["id"], "service_id": service["id"],
        "location_id": location["id"],
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90, "capacity": 10, "is_private": False,
    }).json()
    client_obj = api_client.post("/api/v1/clients", json={
        "name": "Vs Client", "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "email": None, "channel": "telegram",
    }).json()

    record_resp = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client_obj["id"],
        "comment": "Visits test record",
        "visits": [
            {"name": "Guest1", "price": 1000, "status": "waiting"},
            {"name": "Guest2", "price": 2000, "status": "waiting"},
            {"name": "Guest3", "price": 3000, "status": "waiting"},
        ],
    })
    assert record_resp.status_code == 201
    record_id = record_resp.json()["id"]
    visit_ids = [v["id"] for v in record_resp.json()["visits"]]

    db_session.expire_all()
    visits = []
    for vid in visit_ids:
        v = await db_session.get(Visit, vid)
        assert v is not None, f"Visit {vid} not found"
        visits.append(v)
    return visits


def query_db(sql: str) -> list[dict]:
    """Execute SQL against the test database.

    Usage::

        rows = query_db("SELECT is_active FROM masters WHERE id='...'")
        assert rows[0]["is_active"] == 0  # SQLite stores bool as 0/1
    """
    conn = sqlite3.connect(_db_file.name)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql).fetchall()
    conn.commit()  # required: Python 3.12+ no longer auto-commits on close()
    conn.close()
    return [dict(r) for r in rows]
