"""#580 Task 3 — the storage-contract switchover migration (spec §4.2).

Runs the real alembic chain against clean temporary SQLite files,
staging PRE-migration data at the switchover migration's parent
(``a7c3e9f1b2d4``) the way ``test_notification_migration`` stages post-shape
checks:

* backfill — both DEAD sets are marked ``published_at`` at the migration
  moment: consumed (``processed_at IS NOT NULL``) OR parked-by-error
  (``processing_error IS NOT NULL`` — two disjoint sets; dead events are
  never republished); pending rows (both NULL) stay NULL — publishable
  by the relay (Task 4) after the switch;
* the consumer-state columns (``processed_at``/``attempts``/
  ``processing_error``) are dropped, the pending index replaced by
  ``ix_domain_events_unpublished WHERE published_at IS NULL``;
* notify gets the attempts ledger ``notify_event_attempts(event_id,
  scenario, attempts, last_error)`` with ``UNIQUE(event_id, scenario)``
  (consumed by the dispatcher in Task 6);
* the partial unique index ``uq_notify_tasks_event_scenario_root
  (event_id, scenario) WHERE parent_task_id IS NULL`` is guarded by a
  duplicate-roots pre-check — the migration FAILS LOUDLY on existing
  duplicate roots (insurance; today they cannot exist — the old
  ``processed_at`` guard worked);
* round-trip: downgrade to the parent restores the pre-#580 shape.

#581 note: at HEAD the #581 rename migration has since carried the
ledger and the index into ``notification_event_attempts`` /
``uq_notification_tasks_event_scenario_root`` — the post-upgrade
INSERTs/asserts below use those HEAD names, while the PARENT-level
staging (pre-rename world) keeps the old ``notify_*`` names.
"""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parents[2]

#: The switchover migration's parent — the last pre-#580 chain head.
PARENT = "a7c3e9f1b2d4"

pytestmark = pytest.mark.pure_unit  # own tmp-file DBs; the session DB is untouched


def _alembic_config(db_url: str) -> Config:
    """Alembic config bound to a temp DB (same overrides as src/db/migrate.py)."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _db_url(tmp_path: Path, name: str) -> str:
    return f"sqlite:///{tmp_path / name}"


def _upgrade_to_parent(tmp_path: Path, name: str = "pre.db") -> str:
    """A clean DB taken to the switchover migration's PARENT revision."""
    url = _db_url(tmp_path, name)
    command.upgrade(_alembic_config(url), PARENT)
    return url


def _columns(url: str, table: str) -> set[str]:
    engine = create_engine(url)
    try:
        inspector = sa.inspect(engine)
        assert table in inspector.get_table_names(), (
            f"table {table!r} missing — tables: {sorted(inspector.get_table_names())}"
        )
        return {c["name"] for c in inspector.get_columns(table)}
    finally:
        engine.dispose()


def _scalar(url: str, sql: str):
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).scalar()
    finally:
        engine.dispose()


def _run(url: str, sql: str, params: dict | None = None) -> None:
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text(sql), params or {})
    finally:
        engine.dispose()


def _insert_event_pre(
    url: str,
    event_id: str,
    *,
    processed_at: str | None = None,
    processing_error: str | None = None,
) -> None:
    """A domain_events row in the PARENT shape (consumer-state columns)."""
    _run(
        url,
        "INSERT INTO domain_events (id, type, occurred_at, snapshot, attempts,"
        " processed_at, processing_error, created_at, updated_at)"
        " VALUES (:id, 'new_record', '2026-11-01 10:00:00', '{}', 0,"
        " :processed_at, :processing_error, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        {
            "id": event_id,
            "processed_at": processed_at,
            "processing_error": processing_error,
        },
    )


def _insert_event_head(url: str, event_id: str) -> None:
    """A domain_events row in the POST-switchover shape (published_at)."""
    _run(
        url,
        "INSERT INTO domain_events (id, type, occurred_at, snapshot,"
        " created_at, updated_at)"
        " VALUES (:id, 'new_record', '2026-11-01 10:00:00', '{}',"
        " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        {"id": event_id},
    )


def _insert_root_task(
    url: str,
    task_id: str,
    event_id: str,
    *,
    parent_task_id: str | None = None,
    table: str = "notify_tasks",
) -> None:
    """A tasks-table row (chain root by default — parent NULL). The
    table name is a parameter: the pre-#581 parent world stages into
    ``notify_tasks``, post-upgrade inserts go to
    ``notification_tasks``."""
    _run(
        url,
        f"INSERT INTO {table} (id, event_id, scenario, status,"
        " root_task_id, parent_task_id, created_at, updated_at)"
        " VALUES (:id, :event_id, 'new_record', 'queued', :id,"
        " :parent_task_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        {"id": task_id, "event_id": event_id, "parent_task_id": parent_task_id},
    )


def _index_sql(url: str, name: str) -> str | None:
    return _scalar(
        url, f"SELECT sql FROM sqlite_master WHERE type='index' AND name='{name}'"
    )


def _table_names(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()


def _fetch_id_value(url: str, column: str) -> dict[str, object]:
    """id → column map over domain_events (two-column fetch)."""
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return dict(
                conn.execute(
                    text(f"SELECT id, {column} FROM domain_events")
                ).fetchall()
            )
    finally:
        engine.dispose()


def _expect_integrity_error(url: str, sql: str, params: dict) -> None:
    """The statement must be REJECTED (a real unique constraint fired)."""
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text(sql), params)
        raise AssertionError(f"statement was accepted but must be rejected: {sql}")
    except IntegrityError:
        pass  # the constraint fired — exactly the contract
    finally:
        engine.dispose()


# ── the DoD test: backfill of both dead sets + the flip ──────────────────────


def test_domain_events_migration(tmp_path: Path) -> None:
    """Both backfill sets (consumed OR parked-by-error) are marked
    ``published_at`` at the migration moment; pending rows stay NULL
    (publishable by the relay); the consumer-state columns and the old
    pending index are gone."""
    url = _upgrade_to_parent(tmp_path)
    # three pre-switch rows: consumed, parked by error, pending
    _insert_event_pre(url, "evt-consumed", processed_at="2026-11-02 12:00:00")
    _insert_event_pre(
        url, "evt-parked", processing_error="RenderError: template exploded"
    )
    _insert_event_pre(url, "evt-pending")

    command.upgrade(_alembic_config(url), "head")

    # the flip: consumer-state columns gone, published_at in
    columns = _columns(url, "domain_events")
    assert "published_at" in columns, "domain_events.published_at missing"
    for dead in ("processed_at", "attempts", "processing_error"):
        assert dead not in columns, f"domain_events.{dead} survived the switchover"

    rows = _fetch_id_value(url, "published_at")

    # both DEAD sets marked — dead events are never republished (§4.2)
    assert rows["evt-consumed"] is not None, (
        "a consumed event (processed_at set) was not backfilled to published_at"
    )
    assert rows["evt-parked"] is not None, (
        "a parked-by-error event (processing_error set) was not backfilled"
        " to published_at"
    )
    # the migration moment is ONE moment — both marked rows share it
    assert rows["evt-consumed"] == rows["evt-parked"], (
        "backfill must stamp one migration moment, got"
        f" {rows['evt-consumed']!r} vs {rows['evt-parked']!r}"
    )
    # pending rows stay NULL — the relay cursor (published_at IS NULL)
    # picks them up after the switch
    assert rows["evt-pending"] is None, (
        "a pending event must stay unpublished (NULL published_at)"
    )

    # the index swap: old pending index gone, relay cursor index present
    assert _index_sql(url, "ix_domain_events_pending") is None, (
        "old ix_domain_events_pending survived the switchover"
    )
    sql = _index_sql(url, "ix_domain_events_unpublished")
    assert sql is not None, "partial index ix_domain_events_unpublished missing"
    assert "ON domain_events" in sql
    assert "occurred_at" in sql
    assert "published_at IS NULL" in sql, (
        f"partial index lost the published_at predicate: {sql}"
    )

    # the attempts ledger: exact columns + UNIQUE(event_id, scenario)
    # — at HEAD the table carries its #581 name
    ledger_columns = _columns(url, "notification_event_attempts")
    assert ledger_columns == {"event_id", "scenario", "attempts", "last_error"}, (
        f"notification_event_attempts column drift: {sorted(ledger_columns)}"
    )
    _run(
        url,
        "INSERT INTO notification_event_attempts (event_id, scenario,"
        " attempts, last_error) VALUES ('evt-pending', 'new_record', 0, NULL)",
    )
    _expect_integrity_error(
        url,
        "INSERT INTO notification_event_attempts (event_id, scenario,"
        " attempts, last_error) VALUES ('evt-pending', 'new_record', 1, 'boom')",
        {},
    )


def test_domain_events_migration_roots_without_duplicates(tmp_path: Path) -> None:
    """«Корни без дублей» (test_notification_migration style): on a CLEAN
    pre-switch DB the partial root index lands and is ENFORCED — a
    second root for the same (event_id, scenario) is rejected, a chain
    CONTINUATION with the same pair is not (it inherits the root's
    pair; the index covers roots only)."""
    url = _upgrade_to_parent(tmp_path)
    _insert_event_pre(url, "evt-clean")
    _insert_root_task(url, "root-1", "evt-clean")

    command.upgrade(_alembic_config(url), "head")

    # at HEAD the root index carries its #581 name (#580 created it as
    # uq_notify_tasks_event_scenario_root; the rename migration carried
    # the definition over verbatim)
    sql = _index_sql(url, "uq_notification_tasks_event_scenario_root")
    assert sql is not None, (
        "partial root index uq_notification_tasks_event_scenario_root missing"
    )
    assert "CREATE UNIQUE INDEX" in sql.upper()
    assert "event_id" in sql and "scenario" in sql
    assert "parent_task_id IS NULL" in sql, (
        f"root index lost the partial predicate: {sql}"
    )

    # live enforcement on the migrated DB (the #581 table name)
    _insert_event_head(url, "evt-dup")
    _insert_root_task(url, "root-2", "evt-dup", table="notification_tasks")
    _expect_integrity_error(
        url,
        "INSERT INTO notification_tasks (id, event_id, scenario, status,"
        " root_task_id, parent_task_id, created_at, updated_at)"
        " VALUES ('root-2b', 'evt-dup', 'new_record', 'queued', 'root-2b',"
        " NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        {},
    )
    # a CONTINUATION (parent set) with the same (event_id, scenario) is fine
    _run(
        url,
        "INSERT INTO notification_tasks (id, event_id, scenario, status,"
        " root_task_id, parent_task_id, created_at, updated_at)"
        " VALUES ('cont-1', 'evt-dup', 'new_record', 'queued', 'root-2',"
        " 'root-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )


def test_domain_events_migration_duplicate_roots_fail_loudly(
    tmp_path: Path,
) -> None:
    """The duplicate-roots pre-check: a pre-switch DB with TWO roots for
    the same (event_id, scenario) makes the upgrade FAIL LOUDLY (§4.2 —
    insurance; the processed_at guard made duplicates impossible) and
    the DB stays at the parent revision."""
    url = _upgrade_to_parent(tmp_path)
    _insert_event_pre(url, "evt-dupes")
    _insert_root_task(url, "root-a", "evt-dupes")
    _insert_root_task(url, "root-b", "evt-dupes")  # the duplicate root

    with pytest.raises(RuntimeError, match="uq_notify_tasks_event_scenario_root"):
        command.upgrade(_alembic_config(url), "head")

    # nothing half-applied: the DB is still at the parent revision
    assert (
        _scalar(url, "SELECT version_num FROM alembic_version") == PARENT
    ), "a failed switchover must leave the DB at the parent revision"
    assert _index_sql(url, "uq_notify_tasks_event_scenario_root") is None
    assert "published_at" not in _columns(url, "domain_events")


def test_domain_events_migration_roundtrip(tmp_path: Path) -> None:
    """Downgrade to the parent restores the pre-#580 shape: columns,
    pending index (both old predicates), backfill inverse (published →
    processed); the ledger table and the root index are dropped."""
    url = _upgrade_to_parent(tmp_path)
    _insert_event_pre(url, "evt-consumed", processed_at="2026-11-02 12:00:00")
    _insert_event_pre(url, "evt-pending")

    command.upgrade(_alembic_config(url), "head")
    assert "published_at" in _columns(url, "domain_events")

    command.downgrade(_alembic_config(url), PARENT)

    columns = _columns(url, "domain_events")
    assert "published_at" not in columns, "published_at survived the downgrade"
    for restored in ("processed_at", "attempts", "processing_error"):
        assert restored in columns, f"domain_events.{restored} not restored"

    # the backfill inverse: the marked row is processed again, the
    # pending one stays pending
    rows = _fetch_id_value(url, "processed_at")
    assert rows["evt-consumed"] is not None
    assert rows["evt-pending"] is None

    # the old pending index is back with BOTH predicates
    sql = _index_sql(url, "ix_domain_events_pending")
    assert sql is not None, "old pending index not restored by the downgrade"
    assert "processed_at IS NULL" in sql
    assert "processing_error IS NULL" in sql

    # the #580 notify additions are gone (the #581 downgrade has
    # renamed the tables back on the way)
    assert _index_sql(url, "ix_domain_events_unpublished") is None
    assert _index_sql(url, "uq_notify_tasks_event_scenario_root") is None
    assert "notify_event_attempts" not in _table_names(url)

    # and the way back up re-applies the switchover (head = #581 names)
    command.upgrade(_alembic_config(url), "head")
    assert "published_at" in _columns(url, "domain_events")
    assert "notification_event_attempts" in _table_names(url)
