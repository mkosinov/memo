"""Unit tests for the #257 migration's data-expansion function.

The migration ``expand anonym_visits into anonymous visits and drop column``
keeps its row-generating logic in a module-level ``_expand_anonym_visits``
so it can be tested without running the whole alembic chain.

Contract (spec D5 / US7): each unit of the legacy ``records.anonym_visits``
counter is expanded into a real ``visits`` row with:

* ``visitor_id IS NULL`` (anonymous — that is the whole point of #257);
* ``price = 0``, ``tariff_id/custom_price = NULL`` (the counter carried no
  money information — later tasks add money semantics);
* ``status`` inherited from the record's status (NOT reset to ``waiting``),
  so a ``cancelled``/``visited`` record's anonymous guests stay consistent
  with the record after upgrade.
"""
import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_REVISION = "dc47abd1ad2d"

pytestmark = pytest.mark.pure_unit  # own in-memory DB; the session DB is untouched


def _load_expand_fn():
    """Import the migration module by revision file name."""
    path = next(
        BACKEND_DIR.glob(f"alembic/versions/{MIGRATION_REVISION}_*.py"), None
    )
    assert path is not None, (
        f"migration file for {MIGRATION_REVISION} not found — "
        "update MIGRATION_REVISION when the revision id changes"
    )
    spec = importlib.util.spec_from_file_location(
        f"_migration_{MIGRATION_REVISION}", path
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._expand_anonym_visits


def _legacy_schema(conn) -> None:
    """Hand-written DDL of the OLD (pre-drop) schema — only what the
    expansion function touches. FK pragma not needed: the function inserts
    into visits only, and rows reference no real parents."""
    conn.execute(text(
        """
        CREATE TABLE records (
            id VARCHAR(36) PRIMARY KEY,
            status VARCHAR(20) NOT NULL,
            seats INTEGER NOT NULL,
            anonym_visits INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        )
        """
    ))
    conn.execute(text(
        """
        CREATE TABLE visits (
            id VARCHAR(36) PRIMARY KEY,
            record_id VARCHAR(36) NOT NULL,
            visitor_id VARCHAR(36),
            tariff_id VARCHAR(36),
            price INTEGER NOT NULL,
            custom_price INTEGER,
            status VARCHAR(20) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        )
        """
    ))


def _insert_record(conn, rid: str, status: str, anonym_visits: int) -> None:
    conn.execute(text(
        "INSERT INTO records (id, status, seats, anonym_visits, created_at, updated_at)"
        " VALUES (:id, :status, 0, :anonym, datetime('now'), datetime('now'))"
    ), {"id": rid, "status": status, "anonym": anonym_visits})


def _insert_named_visit(conn, rid: str, visit_id: str, status: str) -> None:
    """Named visit: visitor_id gets a fresh non-NULL uuid (legacy shape)."""
    conn.execute(text(
        "INSERT INTO visits (id, record_id, visitor_id, tariff_id, price,"
        " custom_price, status, created_at, updated_at)"
        " VALUES (:id, :rid, :visitor_id, NULL, 1000, NULL, :status,"
        " datetime('now'), datetime('now'))"
    ), {"id": visit_id, "rid": rid,
        "visitor_id": str(uuid.uuid4()), "status": status})


def _anonymous_visit_rows(conn, rid: str) -> list:
    return conn.execute(text(
        "SELECT visitor_id, tariff_id, price, custom_price, status FROM visits"
        " WHERE record_id = :rid AND visitor_id IS NULL"
    ), {"rid": rid}).fetchall()


def test_expand_inherits_record_status_and_shapes_anonymous_rows() -> None:
    """'visited' record with anonym_visits=2 + 1 named visit:
    2 anonymous rows appear, visitor_id NULL, price 0, status inherited,
    all visit ids unique."""
    expand = _load_expand_fn()
    engine = create_engine("sqlite:///:memory:")
    rid = str(uuid.uuid4())
    with engine.begin() as conn:
        _legacy_schema(conn)
        _insert_record(conn, rid, status="visited", anonym_visits=2)
        _insert_named_visit(conn, rid, str(uuid.uuid4()), status="visited")

        expand(conn)

        anon_rows = _anonymous_visit_rows(conn, rid)
        assert len(anon_rows) == 2, "counter=2 must expand into 2 anonymous visits"
        for visitor_id, tariff_id, price, custom_price, status in anon_rows:
            assert visitor_id is None
            assert tariff_id is None
            assert price == 0, "counter carried no money → price 0"
            assert custom_price is None
            assert status == "visited", "status inherited from the record (D5)"

        # ids unique across ALL visits of the record (1 named + 2 anonymous)
        ids = [r[0] for r in conn.execute(text(
            "SELECT id FROM visits WHERE record_id = :rid"), {"rid": rid}
        ).fetchall()]
        assert len(ids) == 3
        assert len(set(ids)) == 3


def test_expand_cancelled_record_yields_cancelled_visit_not_waiting() -> None:
    """A cancelled record's counter expands into a 'cancelled' anonymous
    visit — NOT 'waiting' (inheritance, not reset)."""
    expand = _load_expand_fn()
    engine = create_engine("sqlite:///:memory:")
    rid = str(uuid.uuid4())
    with engine.begin() as conn:
        _legacy_schema(conn)
        _insert_record(conn, rid, status="cancelled", anonym_visits=1)

        expand(conn)

        anon_rows = _anonymous_visit_rows(conn, rid)
        assert len(anon_rows) == 1
        assert anon_rows[0][4] == "cancelled"


def test_expand_zero_counter_is_noop() -> None:
    """anonym_visits=0 must not create any rows."""
    expand = _load_expand_fn()
    engine = create_engine("sqlite:///:memory:")
    rid = str(uuid.uuid4())
    with engine.begin() as conn:
        _legacy_schema(conn)
        _insert_record(conn, rid, status="waiting", anonym_visits=0)

        expand(conn)

        count = conn.execute(text(
            "SELECT COUNT(*) FROM visits"
        )).scalar()
        assert count == 0
