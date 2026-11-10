"""Migration + ORM tests for the notification subsystem tables (#482,
spec §4; the notify→notification rename — #581, spec §3.2/§5).

Runs the real alembic chain (``upgrade head`` / downgrade to explicit
parent ids) against clean temporary SQLite files:

* four notification tables (domain_events, notification_tasks,
  notification_task_attempts, notification_templates) + columns
  ``clients.notification_enabled`` / ``records.notify`` with the spec'd
  server defaults (true / false);
* the partial index ``ix_domain_events_unpublished`` exists in
  ``sqlite_master`` with the relay-cursor predicate ``published_at IS
  NULL`` (#580 §4.2);
* the seed default ``new_record`` template is present with ``is_default``;
* the #581 rename migration round-trips with DATA (spec §5.6–5.8):
  engines run ``PRAGMA foreign_keys=ON``; non-seed rows staged at the
  rename's parent (a client with consent OFF under the old column name,
  a chain task + attempt) survive the upgrade — consent ``false`` stays
  ``false``, the FK target follows the rename
  (``PRAGMA foreign_key_list``), the old table/index names leave
  ``sqlite_master``; the downgrade to the EXPLICIT parent id is the
  exact mirror (consent ``false`` survives the roundtrip);
* ORM metadata (Base.metadata, incl. ``src/notification/models.py``) matches
  the migrated schema column-for-column — the no-drift contract.
"""

from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

import src.models  # noqa: F401 — registers all models incl. src.notification
from alembic import command
from src.db.base import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]

NOTIFICATION_TABLES = (
    "domain_events",
    "notification_tasks",
    "notification_task_attempts",
    "notification_templates",
)

pytestmark = pytest.mark.pure_unit  # own tmp-file DB; the session DB is untouched


def _alembic_config(db_url: str) -> Config:
    """Alembic config bound to a temp DB (same overrides as src/db/migrate.py)."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


@pytest.fixture(scope="module")
def upgraded_url(tmp_path_factory) -> str:
    """Clean DB taken to head once; read-only checks share it."""
    db_file = tmp_path_factory.mktemp("notification_migration") / "upgraded.db"
    url = f"sqlite:///{db_file}"
    command.upgrade(_alembic_config(url), "head")
    return url


def _engine(url: str) -> Engine:
    """Engine with ``PRAGMA foreign_keys=ON`` on every connection (#581
    spec §5.6): the test side of the FK contract — the migration itself
    runs on alembic's own FK-OFF connection (env.py, batch-mode
    requirement); renames still rewrite REFERENCES (SQLite ≥ 3.26), and
    this engine catches any miss live."""
    engine = create_engine(url)

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection: Any, connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def _table_names(url: str) -> set[str]:
    engine = _engine(url)
    try:
        return set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()


def _columns(url: str, table: str) -> dict[str, dict]:
    engine = _engine(url)
    try:
        inspector = sa.inspect(engine)
        assert table in inspector.get_table_names(), (
            f"table {table!r} missing — migrated tables: {sorted(inspector.get_table_names())}"
        )
        return {c["name"]: c for c in inspector.get_columns(table)}
    finally:
        engine.dispose()


def _column_defaults(url: str, table: str) -> dict[str, str | None]:
    """Raw ``dflt_value`` per column (PRAGMA table_info) — the inspector
    does not expose server defaults portably."""
    engine = _engine(url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT name, dflt_value FROM pragma_table_info(:t)"),
                {"t": table},
            ).fetchall()
        return {name: dflt for name, dflt in rows}
    finally:
        engine.dispose()


def _scalar(url: str, sql: str) -> Any:
    engine = _engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).scalar()
    finally:
        engine.dispose()


def _fetchone(url: str, sql: str) -> tuple | None:
    engine = _engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).fetchone()
    finally:
        engine.dispose()


class TestUpgradeHead:
    def test_notification_tables_created(self, upgraded_url: str) -> None:
        tables = _table_names(upgraded_url)
        for name in NOTIFICATION_TABLES:
            assert name in tables, f"{name} not created by upgrade head"

    def test_flag_columns_with_spec_defaults(self, upgraded_url: str) -> None:
        """clients.notification_enabled defaults true, records.notify
        false (§4; the #581 rename keeps the defaults verbatim)."""
        clients = _columns(upgraded_url, "clients")
        assert "notification_enabled" in clients, (
            "clients.notification_enabled missing"
        )
        client_dflts = _column_defaults(upgraded_url, "clients")
        assert client_dflts["notification_enabled"] in ("1", "true")

        records = _columns(upgraded_url, "records")
        assert "notify" in records, "records.notify missing"
        record_dflts = _column_defaults(upgraded_url, "records")
        assert record_dflts["notify"] in ("0", "false")

    def test_partial_index_has_both_predicates(self, upgraded_url: str) -> None:
        """#580 §4.2 rewrite: the two pending-polling predicates are
        REPLACED by the relay cursor — ``ix_domain_events_unpublished ON
        (occurred_at) WHERE published_at IS NULL``; the old
        ``ix_domain_events_pending`` (both old predicates) is gone with
        the columns it references."""
        sql = _scalar(
            upgraded_url,
            "SELECT sql FROM sqlite_master WHERE type='index'"
            " AND name='ix_domain_events_unpublished'",
        )
        assert sql is not None, "partial index ix_domain_events_unpublished missing"
        assert "ON domain_events" in sql
        assert "occurred_at" in sql
        assert "published_at IS NULL" in sql, (
            f"partial index lost the published_at predicate: {sql}"
        )
        old = _scalar(
            upgraded_url,
            "SELECT sql FROM sqlite_master WHERE type='index'"
            " AND name='ix_domain_events_pending'",
        )
        assert old is None, (
            "old processed_at/processing_error pending index survived the"
            " #580 switchover"
        )

    def test_seed_default_new_record_template(self, upgraded_url: str) -> None:
        """§3.5/§4: the migration seeds the default new_record template
        (is_default=1) with the full-variable draft body — the #581
        rename carries the row into ``notification_templates``."""
        row = _fetchone(
            upgraded_url,
            "SELECT event_type, title, body, is_default"
            " FROM notification_templates WHERE event_type = 'new_record'",
        )
        assert row is not None, (
            "seed row new_record missing from notification_templates"
        )
        event_type, title, body, is_default = row
        assert event_type == "new_record"
        assert is_default in (1, True)
        assert title, "seed template must have a title"
        # full-variable draft from spec §3.5 (null-tolerant via {% if %})
        for landmark in (
            "{% if client.name %}",
            "{{ service.title }}",
            "{{ activity.start | fmt_dt }}",
            "{{ location.map_url }}",
            "{% for t in tariffs %}",
            "{{ total_price | money }}",
        ):
            assert landmark in body, f"seed body lost {landmark!r}"


class TestRoundtrip:
    def test_downgrade_drops_notification_schema_then_upgrade_rebuilds(
        self,
        tmp_path: Path,
    ) -> None:
        db_file = tmp_path / "roundtrip.db"
        url = f"sqlite:///{db_file}"
        cfg = _alembic_config(url)

        command.upgrade(cfg, "head")
        assert set(NOTIFICATION_TABLES) <= _table_names(url)

        # Downgrade to the notify migration's PARENT explicitly — «-1»
        # stopped being the notify step once later migrations appended to
        # the chain (users.client_id, #499 f8d2a4c6b9e1): a relative step
        # would exercise the newest migration instead of this one's
        # downgrade, silently voiding the assertions below.
        command.downgrade(cfg, "4ba65fe87015")
        remaining = _table_names(url)
        for name in NOTIFICATION_TABLES:
            assert name not in remaining, f"{name} survived the notify downgrade"
        assert "notify_enabled" not in _columns(url, "clients")
        assert "notify" not in _columns(url, "records")

        command.upgrade(cfg, "head")
        assert set(NOTIFICATION_TABLES) <= _table_names(url)
        seeded = _scalar(
            url,
            "SELECT COUNT(*) FROM notification_templates"
            " WHERE event_type='new_record' AND is_default=1",
        )
        assert seeded == 1


class TestPerChannelMigration:
    """#485 Task 1 — per-channel task reshape (ADR 014, spec §4): the
    ``d94b1f7c2a6e`` migration reshapes ``notify_tasks`` (drops
    ``text``/``channels``, adds the per-channel columns +
    ``UNIQUE(root_task_id, channel)``), adds ``notify_templates.channel``
    with the COALESCE expression index and
    ``notify_task_attempts.sent_text``. At HEAD the tables live under
    their #581 ``notification_*`` names."""

    def test_notification_tasks_columns_reshaped(self, upgraded_url: str) -> None:
        columns = _columns(upgraded_url, "notification_tasks")
        # dropped (ADR 014 — dark system, no data compat)
        assert "text" not in columns, "notification_tasks.text must be dropped"
        assert "channels" not in columns, (
            "notification_tasks.channels must be dropped"
        )
        # the per-channel shape
        for name in (
            "channel",
            "address",
            "payload",
            "template_id",
            "template_body",
            "root_task_id",
            "parent_task_id",
            "delivery_outcome",
            "resend_of",
        ):
            assert name in columns, f"notification_tasks.{name} missing"
        # kept columns (skip-landing, §13)
        for name in ("client_id", "skip_reason", "reenqueues", "status"):
            assert name in columns, (
                f"notification_tasks.{name} must survive the reshape"
            )

    def test_spawn_idempotency_unique_constraint(self, upgraded_url: str) -> None:
        """UNIQUE(root_task_id, channel) present as the unique index
        (family §8.3 — idempotent chain spawn; an index, not a table
        constraint, so SQLite batch migrations can drop it cleanly)."""
        sql = _scalar(
            upgraded_url,
            "SELECT sql FROM sqlite_master WHERE type='index'"
            " AND name='uq_notification_tasks_root_channel'",
        )
        assert sql is not None, (
            "unique index uq_notification_tasks_root_channel missing"
        )
        assert "root_task_id" in sql and "channel" in sql
        assert "CREATE UNIQUE INDEX" in sql.upper()

    def test_spawn_idempotency_enforced_on_migrated_db(
        self, upgraded_url: str
    ) -> None:
        """Live check on the migrated DB: a duplicate (root, channel)
        pair is rejected (the constraint is not just declared)."""
        engine = _engine(upgraded_url)
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO domain_events (id, type, occurred_at, snapshot,"
                        " created_at, updated_at)"
                        " VALUES ('evt-spawn', 'new_record', '2026-01-01 00:00:00',"
                        " '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    )
                )
            with engine.begin() as conn:
                for row_id in ("t-1", "t-2"):
                    conn.execute(
                        text(
                            "INSERT INTO notification_tasks (id, event_id, scenario,"
                            " status, channel, root_task_id, created_at, updated_at)"
                            " VALUES (:id, 'evt-spawn', 'new_record',"
                            " 'queued', 'telegram', 'root-1',"
                            " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                        ),
                        {"id": row_id},
                    )
            raise AssertionError("duplicate (root, channel) insert was accepted")
        except IntegrityError:
            pass  # the constraint fired — exactly the DoD
        finally:
            engine.dispose()

    def test_templates_channel_with_coalesce_index(self, upgraded_url: str) -> None:
        columns = _columns(upgraded_url, "notification_templates")
        assert "channel" in columns, "notification_templates.channel missing"

        sql = _scalar(
            upgraded_url,
            "SELECT sql FROM sqlite_master WHERE type='index'"
            " AND name='uq_notification_templates_event_channel'",
        )
        assert sql is not None, (
            "unique COALESCE index on notification_templates missing"
        )
        assert "event_type" in sql
        assert "COALESCE" in sql, (
            f"index is not the COALESCE expression index (universal rows"
            f" would escape uniqueness): {sql}"
        )

    def test_attempts_sent_text(self, upgraded_url: str) -> None:
        columns = _columns(upgraded_url, "notification_task_attempts")
        assert "sent_text" in columns, (
            "notification_task_attempts.sent_text missing"
        )

    def test_skipped_row_lands_on_migrated_db(self, upgraded_url: str) -> None:
        """Skip-landing (§13): a ``skipped`` task with a reason inserts
        cleanly on the migrated schema — no channel payload required."""
        engine = _engine(upgraded_url)
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO domain_events (id, type, occurred_at, snapshot,"
                        " created_at, updated_at)"
                        " VALUES ('evt-2', 'new_record', '2026-01-01 00:00:00',"
                        " '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO notification_tasks (id, event_id, scenario,"
                        " status, skip_reason, created_at, updated_at)"
                        " VALUES ('t-skip', 'evt-2', 'new_record', 'skipped',"
                        " 'no_recipient', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    )
                )
                reason = conn.execute(
                    text(
                        "SELECT skip_reason FROM notification_tasks"
                        " WHERE id='t-skip'"
                    )
                ).scalar()
            assert reason == "no_recipient"
        finally:
            engine.dispose()

    def test_per_channel_roundtrip(self, tmp_path: Path) -> None:
        """The reshape migration upgrades/downgrades cleanly: downgrade
        to its parent drops the reshape (the pre-#585 old-name world),
        upgrade rebuilds it (head = the #581 names)."""
        db_file = tmp_path / "per_channel_roundtrip.db"
        url = f"sqlite:///{db_file}"
        cfg = _alembic_config(url)

        command.upgrade(cfg, "head")
        columns = _columns(url, "notification_tasks")
        assert "channel" in columns and "text" not in columns

        command.downgrade(cfg, "d3b5f7a9c1e3")
        # below the #581 rename the tables carry their old names
        columns = _columns(url, "notify_tasks")
        assert "channel" not in columns
        assert "text" in columns and "channels" in columns, (
            "downgrade must restore the pre-#485 shape"
        )
        assert "channel" not in _columns(url, "notify_templates")
        assert "sent_text" not in _columns(url, "notify_task_attempts")

        command.upgrade(cfg, "head")
        assert "channel" in _columns(url, "notification_tasks")
        assert "sent_text" in _columns(url, "notification_task_attempts")


class TestTemplateOriginMigration:
    """#485 Task 4 — the template ORIGIN freeze (spec §6.2 parse-mode
    rule): ``notification_tasks.template_channel`` — the frozen template
    row's ``channel`` value (NULL = universal). The worker is DB-free
    (ADR 009), so the origin rides the task row + payload to the send
    seam (a channel template → the channel's parse mode, a universal →
    none).
    """

    def test_template_channel_column_added(self, upgraded_url: str) -> None:
        columns = _columns(upgraded_url, "notification_tasks")
        assert "template_channel" in columns, (
            "notification_tasks.template_channel missing"
        )
        # nullable — dark-system rows and universal templates keep NULL
        assert columns["template_channel"]["nullable"], (
            "template_channel must be nullable (NULL = universal template)"
        )

    def test_template_origin_roundtrip(self, tmp_path: Path) -> None:
        """Downgrade to the Task-3 head (below the #581 rename — old
        names) drops the origin column; upgrade rebuilds it."""
        db_file = tmp_path / "template_origin_roundtrip.db"
        url = f"sqlite:///{db_file}"
        cfg = _alembic_config(url)

        command.upgrade(cfg, "head")
        assert "template_channel" in _columns(url, "notification_tasks")

        command.downgrade(cfg, "d94b1f7c2a6e")
        assert "template_channel" not in _columns(url, "notify_tasks")

        command.upgrade(cfg, "head")
        assert "template_channel" in _columns(url, "notification_tasks")


# ── #581 — the notify→notification rename migration (spec §5.6–5.8) ──────────


#: The rename migration's parent — the last pre-#581 chain head.
RENAME_PARENT = "e8a2c4d6b0f3"

OLD_TABLES = (
    "notify_tasks",
    "notify_task_attempts",
    "notify_event_attempts",
    "notify_templates",
)
NEW_TABLES = tuple(f"notification{name[6:]}" for name in OLD_TABLES)

OLD_INDEXES = (
    "uq_notify_tasks_root_channel",
    "uq_notify_tasks_event_scenario_root",
    "uq_notify_templates_event_channel",
)
NEW_INDEXES = tuple(
    name.replace("uq_notify_", "uq_notification_", 1) for name in OLD_INDEXES
)


def _sqlite_master_names(url: str, object_type: str) -> set[str]:
    """Names of tables/indexes currently declared in sqlite_master."""
    return {
        row[0]
        for row in (
            _fetchone_many(
                url,
                "SELECT name FROM sqlite_master WHERE type=:t",
                {"t": object_type},
            )
        )
    }


def _fetchone_many(url: str, sql: str, params: dict | None = None) -> list[tuple]:
    engine = _engine(url)
    try:
        with engine.connect() as conn:
            return list(conn.execute(text(sql), params or {}).fetchall())
    finally:
        engine.dispose()


def _stage_parent_rows(url: str) -> None:
    """NON-seed rows staged at the rename migration's PARENT — the
    old-name world (#581 spec §5.7): a client with consent OFF (old
    column name ``notify_enabled`` — at the parent the column is still
    old), a journal event, a chain task and its channel attempt."""
    engine = _engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO clients (id, name, phone, notify_enabled,"
                    " is_active, created_at, updated_at)"
                    " VALUES ('cl-consent-off', 'Consent Off', '+79990000011',"
                    " 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO domain_events (id, type, occurred_at, snapshot,"
                    " created_at, updated_at)"
                    " VALUES ('evt-rename', 'new_record', '2026-11-01 10:00:00',"
                    " '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO notify_tasks (id, event_id, scenario, client_id,"
                    " status, channel, address, root_task_id, reenqueues,"
                    " created_at, updated_at)"
                    " VALUES ('task-rename', 'evt-rename', 'new_record',"
                    " 'cl-consent-off', 'queued', 'telegram', '+79990000011',"
                    " 'task-rename', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO notify_task_attempts (id, task_id, channel,"
                    " stage, occurred_at)"
                    " VALUES ('attempt-rename', 'task-rename', 'telegram',"
                    " 'sending', CURRENT_TIMESTAMP)"
                )
            )
    finally:
        engine.dispose()


class TestNotificationRename:
    """#581 Task 1 — the rename migration (spec §3.2/§5): four table
    renames, the ``clients.notify_enabled`` column rename, three named
    unique indexes drop+create (no ``ALTER INDEX`` in SQLite); full
    symmetric downgrade; staged rows — consent ``false`` included —
    survive BOTH directions; the FK target follows the rename under
    ``PRAGMA foreign_keys=ON``; old names leave ``sqlite_master``."""

    def test_rename_roundtrip_preserves_rows_consent_and_fk(
        self, tmp_path: Path
    ) -> None:
        db_file = tmp_path / "rename_roundtrip.db"
        url = f"sqlite:///{db_file}"
        cfg = _alembic_config(url)

        # — the parent world: OLD names live; rows staged with FK ON —
        command.upgrade(cfg, RENAME_PARENT)
        _stage_parent_rows(url)

        tables = _table_names(url)
        assert set(OLD_TABLES) <= tables, "parent must hold the OLD names"
        assert not (set(NEW_TABLES) & tables), "NEW names must not exist at parent"
        assert "notify_enabled" in _columns(url, "clients")

        # FK enforcement is really ON for the staging engine (§5.6)
        assert _scalar(url, "PRAGMA foreign_keys") == 1

        # ── upgrade: renamed, rows intact, consent false survived ──────
        command.upgrade(cfg, "head")

        tables = _table_names(url)
        assert set(NEW_TABLES) <= tables, f"renamed tables missing: {tables}"
        assert not (set(OLD_TABLES) & tables), (
            f"old table names survived the rename: {sorted(set(OLD_TABLES) & tables)}"
        )

        indexes = _sqlite_master_names(url, "index")
        assert set(NEW_INDEXES) <= indexes, (
            f"renamed indexes missing: {sorted(set(NEW_INDEXES) - indexes)}"
        )
        assert not (set(OLD_INDEXES) & indexes), (
            f"old index names survived the rename:"
            f" {sorted(set(OLD_INDEXES) & indexes)}"
        )

        clients = _columns(url, "clients")
        assert "notification_enabled" in clients, "consent column not renamed"
        assert "notify_enabled" not in clients, "old consent column survived"

        # the staged non-seed rows are all on place, consent false kept
        assert _scalar(
            url,
            "SELECT notification_enabled FROM clients WHERE id='cl-consent-off'",
        ) in (0, False)
        assert _scalar(
            url, "SELECT COUNT(*) FROM notification_tasks WHERE id='task-rename'"
        ) == 1
        assert _scalar(
            url,
            "SELECT COUNT(*) FROM notification_task_attempts"
            " WHERE id='attempt-rename'",
        ) == 1

        # the FK target followed the rename (§5.6): the attempts table
        # references notification_tasks, and the whole schema holds no
        # dangling reference (foreign_key_check is empty).
        fk_rows = _fetchone_many(
            url, "PRAGMA foreign_key_list(notification_task_attempts)"
        )
        # (id, seq, table, from, to, on_update, on_delete, match)
        targets = {(row[2], row[3], row[4]) for row in fk_rows}
        assert ("notification_tasks", "task_id", "id") in targets, (
            f"FK did not follow the rename: {sorted(targets)}"
        )
        assert not _fetchone_many(url, "PRAGMA foreign_key_check"), (
            "dangling FK references after the rename"
        )

        # ── downgrade to the EXPLICIT parent id (never «-1») — mirror ──
        command.downgrade(cfg, RENAME_PARENT)

        tables = _table_names(url)
        assert set(OLD_TABLES) <= tables, "downgrade must restore the OLD names"
        assert not (set(NEW_TABLES) & tables), "NEW names survived the downgrade"

        indexes = _sqlite_master_names(url, "index")
        assert set(OLD_INDEXES) <= indexes
        assert not (set(NEW_INDEXES) & indexes)

        clients = _columns(url, "clients")
        assert "notify_enabled" in clients, "consent column not renamed back"
        assert "notification_enabled" not in clients

        # the staged rows (consent false included) survived the ROUNDTRIP
        assert _scalar(
            url,
            "SELECT notify_enabled FROM clients WHERE id='cl-consent-off'",
        ) in (0, False)
        assert _scalar(
            url, "SELECT COUNT(*) FROM notify_tasks WHERE id='task-rename'"
        ) == 1
        assert _scalar(
            url,
            "SELECT COUNT(*) FROM notify_task_attempts WHERE id='attempt-rename'",
        ) == 1

        fk_rows = _fetchone_many(url, "PRAGMA foreign_key_list(notify_task_attempts)")
        targets = {(row[2], row[3], row[4]) for row in fk_rows}
        assert ("notify_tasks", "task_id", "id") in targets, (
            f"FK did not follow the downgrade rename: {sorted(targets)}"
        )
        assert not _fetchone_many(url, "PRAGMA foreign_key_check"), (
            "dangling FK references after the downgrade"
        )

    def test_seed_template_survives_rename(self, tmp_path: Path) -> None:
        """The deterministic seed template row (c970adc6b3d6) travels
        with the renamed table — rename preserves rows (spec §5.5)."""
        db_file = tmp_path / "rename_seed.db"
        url = f"sqlite:///{db_file}"
        cfg = _alembic_config(url)

        command.upgrade(cfg, RENAME_PARENT)
        assert _scalar(
            url,
            "SELECT COUNT(*) FROM notify_templates"
            " WHERE event_type='new_record' AND is_default=1",
        ) == 1

        command.upgrade(cfg, "head")
        assert _scalar(
            url,
            "SELECT COUNT(*) FROM notification_templates"
            " WHERE event_type='new_record' AND is_default=1",
        ) == 1


class TestOrmParity:
    def test_metadata_matches_migrated_schema(self, upgraded_url: str) -> None:
        """Every Base.metadata table exists after upgrade head with exactly
        the declared column names — the model side of the no-drift contract
        (sqlite_where partial index is covered by the sqlite_master test)."""
        engine = _engine(upgraded_url)
        try:
            inspector = sa.inspect(engine)
            db_tables = set(inspector.get_table_names())
            for table in Base.metadata.sorted_tables:
                assert table.name in db_tables, (
                    f"ORM table {table.name!r} not created by migrations"
                )
                reflected = {c["name"] for c in inspector.get_columns(table.name)}
                declared = {c.name for c in table.columns}
                assert reflected == declared, (
                    f"{table.name}: migration/model column drift —"
                    f" only-in-db={sorted(reflected - declared)},"
                    f" only-in-model={sorted(declared - reflected)}"
                )
        finally:
            engine.dispose()
