"""Seed-canon tests: the SQL semantics of resetToSeed, ported from vitest (#373).

The canon machinery lives in two places this file exercises against the REAL
schema and the REAL seed (not the vitest hand-made mini-schema):

  - scripts/gen_seed_canon.py snapshots a pristine seeded DB into a canon
    SQL file (DELETE + re-INSERT for every non-blacklisted table);
  - frontend/admin/e2e/fixtures/seed-reset.ts (resetToSeed) applies that
    file through the sqlite3 CLI before every e2e test.

The fixture builds a throwaway DB under pytest's tmp_path, generates the
canon with the real generator subprocess, and the helper applies it with
the exact same command the TS wrapper uses. Pollution techniques are
ported from frontend/admin/__tests__/seed-reset.test.ts (resetToSeed
group) — techniques, not verbatim TS.
"""

import hashlib
import sqlite3
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

from src.db.base import Base
from src.db.database import DBManager

pytestmark = pytest.mark.misc

# Repo root: tests → backend → repo (the generator script lives at the root).
REPO_ROOT = Path(__file__).resolve().parents[2]
GEN_SEED_CANON = REPO_ROOT / "scripts" / "gen_seed_canon.py"

# Every canon-exception table (audit_logs, sessions, the notify journal
# chain) plus notify_templates (a deterministic seed table that stays IN
# the canon) must exist in the built schema — by construction of the real
# models, which is exactly what this fixture asserts.
EXPECTED_TABLES = {
    "audit_logs",
    "sessions",
    "domain_events",
    "notify_tasks",
    "notify_task_attempts",
    "notify_templates",
}

# Pollution timestamp: fixed so polluted rows are identical across runs.
TS = "2026-01-01 00:00:00"

# Non-seed row ids: readable fixed ids (they survive in assertion
# messages) — "evt_something" keeps the vitest id verbatim.
FIXED_IDS = {
    "clients": "polluted-client",
    "visitors": "polluted-visitor",
    "records": "polluted-record",
    "visits": "polluted-visit",
    "payments": "polluted-payment",
    "activities": "evt_something",
}


def _require_sqlite3_cli() -> None:
    """Fail with ONE named reason when the sqlite3 CLI is missing.

    Without the utility both the apply helper and these tests collapse
    into a pile of confusing errors; a single named failure is the spec
    (design doc §Риски).
    """
    try:
        subprocess.run(
            ["sqlite3", "--version"], check=True, capture_output=True, shell=False
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        pytest.fail(f"sqlite3 CLI is not available (`sqlite3 --version`): {exc!r}")


@dataclass(frozen=True)
class CanonStack:
    """Paths of a canon test + canon application exactly like resetToSeed."""

    db: Path
    canon: Path
    sandbox: Path  # the test's tmp_path — a destructive canon must not escape it

    def apply(self) -> None:
        """Apply the canon with the very command resetToSeed uses."""
        # The retry wrapper (sqliteExecWithRetry) is a TS-side concern and is deliberately not reproduced here.
        sandbox = self.sandbox.resolve()
        assert self.db.resolve().is_relative_to(sandbox), (
            f"canon target db is outside tmp_path: {self.db}"
        )
        assert self.canon.resolve().is_relative_to(sandbox), (
            f"canon file is outside tmp_path: {self.canon}"
        )
        subprocess.run(
            ["sqlite3", str(self.db), f".read '{self.canon}'"],
            check=True,
            shell=False,
        )


def scalar(db: Path, sql: str) -> Any:
    """First column of the first row; None when no row came back.

    A value of 0 can never masquerade as an absent row (the vitest NaN
    trick, expressed Pythonically).
    """
    conn = sqlite3.connect(str(db))
    try:
        row = conn.execute(sql).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def count(db: Path, sql: str) -> int:
    """Integer COUNT(*) helper."""
    return int(scalar(db, sql))


def _exec(db: Path, *statements: tuple[str, tuple[Any, ...]]) -> None:
    """Run parametrized DML in one transaction (the pollution primitive).

    Like the vitest side (one execSync with a SQL script), pollution is a
    single committed batch; FK enforcement stays OFF (the sqlite3 driver
    default), matching how the canon itself applies with
    ``PRAGMA foreign_keys=OFF``.
    """
    conn = sqlite3.connect(str(db))
    try:
        cur = conn.cursor()
        for sql, params in statements:
            cur.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def pollute(stack: CanonStack) -> dict[str, Any]:
    """Pollute the seeded DB with the vitest techniques (ported, not copied).

    Edits seed rows, deletes seed rows (r1 is BOTH edited and deleted),
    and inserts non-seed rows with fixed ids AND fresh UUIDs. Returns the
    ids the assertions need: the touched seed rows and the inserted ids.
    """
    db = stack.db
    # The canonical r1: client «Анна Иванова» × service «Морской пейзаж»
    # (seed ids are UUIDs now, so seed rows are pinned by business keys).
    r1_id = scalar(
        db,
        "SELECT r.id FROM records r "
        "JOIN clients c ON c.id = r.client_id "
        "JOIN activities a ON a.id = r.activity_id "
        "JOIN services s ON s.id = a.service_id "
        "WHERE c.name = 'Анна Иванова' AND s.title = 'Морской пейзаж'",
    )
    assert isinstance(r1_id, str), "seed record r1 (Анна Иванова × Морской пейзаж) not found"
    r1_client_id = scalar(db, f"SELECT client_id FROM records WHERE id = '{r1_id}'")
    p1_id = scalar(db, f"SELECT id FROM payments WHERE record_id = '{r1_id}'")
    assert isinstance(p1_id, str), "seed payment p1 (record r1) not found"
    any_activity_id = scalar(db, "SELECT id FROM activities ORDER BY rowid LIMIT 1")
    assert isinstance(any_activity_id, str), "seed activities not found"

    uuid_ids = {t: str(uuid.uuid4()) for t in ("clients", "visitors", "records", "visits", "payments")}
    ts = "2026-01-01 00:00:00"
    conn = sqlite3.connect(str(db))
    try:
        cur = conn.cursor()
        # — edit seed rows —
        cur.execute(
            "UPDATE records SET status = 'cancelled', seats = seats + 3 WHERE id = ?",
            (r1_id,),
        )
        cur.execute("UPDATE payments SET amount = 1 WHERE id = ?", (p1_id,))
        # — delete seed rows (after the edit — the BOTH-edited-and-deleted trick) —
        cur.execute("DELETE FROM records WHERE id = ?", (r1_id,))
        # — insert non-seed rows: fixed ids …
        cur.execute(
            "INSERT INTO clients (id, name, phone, notify_enabled, is_active, created_at, updated_at) "
            "VALUES ('polluted-client', 'Polluted Client', '+70000000001', 1, 1, ?, ?)",
            (ts, ts),
        )
        cur.execute(
            "INSERT INTO visitors (id, client_id, name, created_at, updated_at) "
            "VALUES ('polluted-visitor', ?, 'Orphan Visitor', ?, ?)",
            (r1_client_id, ts, ts),
        )
        cur.execute(
            "INSERT INTO records (id, activity_id, client_id, status, seats, notify, created_at, updated_at) "
            "VALUES ('polluted-record', ?, ?, 'waiting', 1, 0, ?, ?)",
            (any_activity_id, r1_client_id, ts, ts),
        )
        cur.execute(
            "INSERT INTO visits (id, record_id, price, status, created_at, updated_at) "
            "VALUES ('polluted-visit', ?, 100, 'waiting', ?, ?)",
            (r1_id, ts, ts),  # r1 is deleted — an orphan on purpose
        )
        cur.execute(
            "INSERT INTO payments (id, record_id, amount, method, created_at, updated_at) "
            "VALUES ('polluted-payment', ?, 123, 'cash', ?, ?)",
            (r1_id, ts, ts),
        )
        cur.execute(
            "INSERT INTO activities (id, master_id, service_id, location_id, start, "
            "duration, capacity, is_private, created_at, updated_at) "
            "SELECT 'evt_something', m.staff_id, s.id, l.id, '2026-06-15 10:00:00', 3, 8, 0, ?, ? "
            "FROM masters m, services s, locations l "
            "WHERE m.rowid = (SELECT MIN(rowid) FROM masters) "
            "AND s.rowid = (SELECT MIN(rowid) FROM services) "
            "AND l.rowid = (SELECT MIN(rowid) FROM locations)",
            (ts, ts),
        )
        # — … and fresh UUIDs (what a real runtime insert would produce)
        cur.execute(
            "INSERT INTO clients (id, name, phone, notify_enabled, is_active, created_at, updated_at) "
            "VALUES (?, 'UUID Client', '+70000000002', 1, 1, ?, ?)",
            (uuid_ids["clients"], ts, ts),
        )
        cur.execute(
            "INSERT INTO visitors (id, client_id, name, created_at, updated_at) "
            "VALUES (?, ?, 'UUID Visitor', ?, ?)",
            (uuid_ids["visitors"], r1_client_id, ts, ts),
        )
        cur.execute(
            "INSERT INTO records (id, activity_id, client_id, status, seats, notify, created_at, updated_at) "
            "VALUES (?, ?, ?, 'waiting', 1, 0, ?, ?)",
            (uuid_ids["records"], any_activity_id, r1_client_id, ts, ts),
        )
        cur.execute(
            "INSERT INTO visits (id, record_id, price, status, created_at, updated_at) "
            "VALUES (?, ?, 200, 'waiting', ?, ?)",
            (uuid_ids["visits"], r1_id, ts, ts),
        )
        cur.execute(
            "INSERT INTO payments (id, record_id, amount, method, created_at, updated_at) "
            "VALUES (?, ?, 456, 'cash', ?, ?)",
            (uuid_ids["payments"], r1_id, ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    return {"r1_id": r1_id, "p1_id": p1_id, "uuid_ids": uuid_ids}


# The default new_record notify template: seeded by an alembic DATA
# migration with a FIXED uuid precisely so the row enters the deterministic
# canon (#482 §5); create_all does not run migrations, so the fixture
# reproduces that insert before canon generation — mirror of
# backend/alembic/versions/c970adc6b3d6_notify_subsystem_tables.py.
_DEFAULT_TEMPLATE = {
    "id": "27715c0f-1d0f-4895-a555-1cb54f00bc7e",
    "title": "Новая запись (дефолтный)",
    "body": (
        "{% if client.name %}{{ client.name }}, з{% else %}З{% endif %}"
        "дравствуйте! Вы записаны на «{{ service.title }}» — "
        "{{ activity.start | fmt_dt }} ({{ activity.duration }} мин), "
        "{{ location.title }}"
        "{% if location.address %}, {{ location.address }}{% endif %}"
        "{% if location.map_url %} ({{ location.map_url }}){% endif %}. "
        "{% if master.name %}Ведёт {{ master.name }}.{% endif %} "
        "{% for t in tariffs %}«{{ t.title }}» — {{ t.price | money }}; "
        "{% endfor %}"
        "Итого: {{ total_price | money }}. Если планы изменились — сообщите нам."
    ),
}


@pytest.fixture
async def canon_stack(tmp_path: Path) -> CanonStack:
    """Build a REAL schema + REAL seed under tmp_path, then generate the canon.

    Order matters and is normative (design doc §1):
      1. file-based DB (NOT in-memory — the generator reads it from a
         separate process);
      2. import the model modules BEFORE create_all (Base.metadata is
         empty without them; src.models is the aggregate import covering
         auth/session.py and notify/models.py too);
      3. create_all + assert the exception tables and notify_templates
         exist in the built schema;
      4. real seed_data(), then an explicit COMMIT and engine dispose
         BEFORE the generator runs (uncommitted rows are invisible from
         another process; the engine sets PRAGMA journal_mode=WAL on
         every connect, so commit-then-dispose — the last close
         checkpoints the WAL into the main file — is the safe order);
      5. run the real generator via subprocess (argument list,
         shell=False, sys.executable, check=True, timeout as a
         hang-guard).
    """
    _require_sqlite3_cli()

    db = tmp_path / "canon-test.db"
    canon = tmp_path / "canon-test.db.canon.sql"

    import src.models  # noqa: F401 — registers every table in Base.metadata
    from src.seed.seed import seed_data

    manager = DBManager(f"sqlite+aiosqlite:///{db}")
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with manager.engine.connect() as conn:
        result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type = 'table'")
        )
        built = {row[0] for row in result}
    missing = EXPECTED_TABLES - built
    assert not missing, f"real schema is missing canon-relevant tables: {missing}"

    await seed_data(manager)
    async with manager.async_session() as session:
        await session.commit()
    await manager.engine.dispose()

    # The alembic data migration's default template row (see
    # _DEFAULT_TEMPLATE above) — part of the pristine state the real e2e
    # stack snapshots (alembic → seed → canon), so it must be in the DB
    # before the generator runs.
    _exec(
        db,
        (
            "INSERT INTO notify_templates (id, event_type, title, body,"
            " is_default, created_at, updated_at)"
            " VALUES (?, 'new_record', ?, ?, 1, ?, ?)",
            (
                _DEFAULT_TEMPLATE["id"],
                _DEFAULT_TEMPLATE["title"],
                _DEFAULT_TEMPLATE["body"],
                TS,
                TS,
            ),
        ),
    )

    subprocess.run(
        [sys.executable, str(GEN_SEED_CANON), str(db), str(canon)],
        check=True,
        timeout=120,
        shell=False,
    )
    return CanonStack(db=db, canon=canon, sandbox=tmp_path)


async def test_total_restore(canon_stack: CanonStack) -> None:
    """restores deleted/edited seed rows and removes non-seed rows (total restore)"""
    db = canon_stack.db
    polluted = pollute(canon_stack)

    canon_stack.apply()

    # seed rows survive in canonical state (r1 was BOTH edited and deleted)
    assert count(
        db,
        "SELECT COUNT(*) FROM records r "
        "JOIN clients c ON c.id = r.client_id "
        "JOIN activities a ON a.id = r.activity_id "
        "JOIN services s ON s.id = a.service_id "
        "WHERE c.name = 'Анна Иванова' AND s.title = 'Морской пейзаж' "
        "AND r.status = 'visited' AND r.seats = 2",
    ) == 1
    assert scalar(db, f"SELECT amount FROM payments WHERE id = '{polluted['p1_id']}'") == 6000
    assert count(db, "SELECT COUNT(*) FROM records") == 6
    assert count(
        db,
        "SELECT COUNT(*) FROM activities "
        "WHERE start >= '2026-06-15' AND start < '2026-06-22'",
    ) == 10

    # non-seed rows are gone (fixed ids and UUIDs)
    for table, fixed_id in FIXED_IDS.items():
        assert count(db, f"SELECT COUNT(*) FROM {table} WHERE id = '{fixed_id}'") == 0
    for table, uid in polluted["uuid_ids"].items():
        assert count(db, f"SELECT COUNT(*) FROM {table} WHERE id = '{uid}'") == 0


# Canonical dictionary state (src/seed/seed.py): staff sort_order by person
# and location sort_order by title (seed ids are UUIDs → business-key pins);
# position ids are fixed system codes (master/admin/smm).
_CANONICAL_STAFF_ORDER: list[tuple[str, str, int]] = [
    ("Ольга", "Середа", 0),
    ("Юлия", "Большакова", 1),
    ("Анастасия", "П.", 2),
    ("Дарья", "Тюльпина", 3),
    ("Александра", "В.", 4),
    ("Ирина", "Горох", 5),
]
_CANONICAL_LOCATION_ORDER: list[tuple[str, int]] = [
    ("Альпика", 0),
    ("Гранд Отель Поляна", 1),
    ("Поляна 1389", 2),
]


async def test_restores_sort_order_dictionaries_and_staff_positions(
    canon_stack: CanonStack,
) -> None:
    """restores canonical sort_order, dictionary titles and staff_positions"""
    db = canon_stack.db

    # pollute: destroy every sort_order, rename the system dictionary title,
    # detach all positions, plant a non-seed staff card + master_tags link
    _exec(
        db,
        ("UPDATE staff SET sort_order = 99", ()),
        (
            "UPDATE positions SET title = 'Master-renamed', is_system = 0"
            " WHERE id = 'master'",
            (),
        ),
        ("DELETE FROM staff_positions", ()),
        ("UPDATE locations SET sort_order = 42", ()),
        (
            "INSERT INTO staff (id, first_name, last_name, sort_order,"
            " is_active, created_at, updated_at)"
            " VALUES ('polluted-staff', 'Polluted', 'Staffer', 100, 1, ?, ?)",
            (TS, TS),
        ),
        (
            "INSERT INTO master_tags (master_id, tag_id)"
            " VALUES ('polluted-staff', 'tag-polluted')",
            (),
        ),
    )
    # the pollution landed (guards against a vacuous run)
    assert scalar(
        db, "SELECT sort_order FROM staff WHERE first_name = 'Ольга' AND last_name = 'Середа'"
    ) == 99
    assert count(db, "SELECT COUNT(*) FROM staff_positions") == 0

    canon_stack.apply()

    for first_name, last_name, order in _CANONICAL_STAFF_ORDER:
        assert scalar(
            db,
            f"SELECT sort_order FROM staff WHERE first_name = '{first_name}'"
            f" AND last_name = '{last_name}'",
        ) == order, f"canonical sort_order lost for {first_name} {last_name}"
    for title, order in _CANONICAL_LOCATION_ORDER:
        assert scalar(
            db, f"SELECT sort_order FROM locations WHERE title = '{title}'"
        ) == order, f"canonical sort_order lost for location {title}"
    assert scalar(db, "SELECT title FROM positions WHERE id = 'master'") == "Мастер"
    assert scalar(db, "SELECT is_system FROM positions WHERE id = 'master'") == 1
    # every seeded staff member holds the «мастер» position (6 cards)
    assert count(db, "SELECT COUNT(*) FROM staff_positions") == 6
    olga_id = scalar(
        db, "SELECT id FROM staff WHERE first_name = 'Ольга' AND last_name = 'Середа'"
    )
    assert count(
        db,
        f"SELECT COUNT(*) FROM staff_positions WHERE staff_id = '{olga_id}'"
        " AND position_id = 'master'",
    ) == 1
    # non-seed dictionary pollution is gone
    assert count(db, "SELECT COUNT(*) FROM staff WHERE id = 'polluted-staff'") == 0
    assert count(
        db, "SELECT COUNT(*) FROM master_tags WHERE master_id = 'polluted-staff'"
    ) == 0


async def test_restores_users_to_seed(canon_stack: CanonStack) -> None:
    """restores users to seed (non-seed user rows vanish — policy flip of GH #310)"""
    db = canon_stack.db
    # Seed demo users (seed_staff_users): admin +79990000001 (no card),
    # master +79990000002 linked to the first card by sort_order (Ольга).
    olga_id = scalar(
        db, "SELECT id FROM staff WHERE first_name = 'Ольга' AND last_name = 'Середа'"
    )
    irina_id = scalar(
        db, "SELECT id FROM staff WHERE first_name = 'Ирина' AND last_name = 'Горох'"
    )
    yulia_id = scalar(
        db, "SELECT id FROM staff WHERE first_name = 'Юлия' AND last_name = 'Большакова'"
    )
    assert None not in (olga_id, irina_id, yulia_id), "seed staff cards not found"

    # pollute: detach the seed master user to another card (+ role/lock edits)
    # and insert a non-seed user on a free card
    _exec(
        db,
        (
            "UPDATE users SET staff_id = ?, role = 'admin', lock_level = 3"
            " WHERE phone = '+79990000002'",
            (irina_id,),
        ),
        (
            "INSERT INTO users (id, phone, role, staff_id, email_is_confirmed,"
            " phone_is_confirmed, failed_login_attempts, lock_level, is_active,"
            " created_at, updated_at)"
            " VALUES ('polluted-user', '+79990000099', 'master', ?, 0, 0, 0, 0, 1, ?, ?)",
            (yulia_id, TS, TS),
        ),
    )
    assert count(db, "SELECT COUNT(*) FROM users") == 3
    assert scalar(
        db, "SELECT staff_id FROM users WHERE phone = '+79990000002'"
    ) == irina_id

    canon_stack.apply()

    # users is no longer "kept but detached" (the pre-#310 compromise): the
    # canon fully restores the table — the polluter's row is GONE and the
    # seed rows are back with their canonical cards.
    assert count(db, "SELECT COUNT(*) FROM users") == 2
    assert count(db, "SELECT COUNT(*) FROM users WHERE id = 'polluted-user'") == 0
    assert scalar(
        db, "SELECT staff_id FROM users WHERE phone = '+79990000002'"
    ) == olga_id
    assert scalar(db, "SELECT role FROM users WHERE phone = '+79990000002'") == "master"
    assert scalar(db, "SELECT lock_level FROM users WHERE phone = '+79990000002'") == 0
    assert scalar(db, "SELECT staff_id FROM users WHERE phone = '+79990000001'") is None


async def test_wipes_user_settings_whole(canon_stack: CanonStack) -> None:
    """wipes user_settings whole (GH #267)"""
    db = canon_stack.db
    # The real seed creates a defaults row per demo user
    # (UserSettingsService.insert_defaults) — 2 rows is the canonical state.
    assert count(db, "SELECT COUNT(*) FROM user_settings") == 2

    # pollute: flip toggles on the seed rows and leak non-seed rows (a
    # fixed id + a fresh UUID on fake user ids — user_id is UNIQUE)
    polluted_uuid = str(uuid.uuid4())
    _exec(
        db,
        (
            "UPDATE user_settings SET theme = 'dark',"
            " show_archived_masters = 0, show_archived_locations = 1",
            (),
        ),
        (
            "INSERT INTO user_settings (id, user_id, theme, language,"
            " column_order_staff, column_order_locations, show_archived_masters,"
            " show_archived_locations, created_at, updated_at)"
            " VALUES ('polluted-settings', 'fake-user-1', 'dark', 'ru', '[]', '[]',"
            " 0, 1, ?, ?)",
            (TS, TS),
        ),
        (
            "INSERT INTO user_settings (id, user_id, theme, language,"
            " column_order_staff, column_order_locations, show_archived_masters,"
            " show_archived_locations, created_at, updated_at)"
            " VALUES (?, 'fake-user-2', 'dark', 'ru', '[]', '[]', 0, 1, ?, ?)",
            (polluted_uuid, TS, TS),
        ),
    )
    assert count(db, "SELECT COUNT(*) FROM user_settings") == 4

    canon_stack.apply()

    # persisted toggles must not leak between tests: the table is wiped and
    # rebuilt from the canon — exactly the 2 seed defaults rows remain
    assert count(db, "SELECT COUNT(*) FROM user_settings") == 2
    assert count(
        db, "SELECT COUNT(*) FROM user_settings WHERE id = 'polluted-settings'"
    ) == 0
    assert count(
        db, f"SELECT COUNT(*) FROM user_settings WHERE id = '{polluted_uuid}'"
    ) == 0
    assert count(
        db,
        "SELECT COUNT(*) FROM user_settings WHERE theme = 'light'"
        " AND language = 'ru' AND column_order_staff = '[]'"
        " AND column_order_locations = '[]' AND show_archived_masters = 1"
        " AND show_archived_locations = 0",
    ) == 2


async def test_keeps_by_design_exceptions(canon_stack: CanonStack) -> None:
    """keeps the by-design exceptions: audit_logs, sessions and the notify journal tables (#482)"""
    db = canon_stack.db
    admin_id = scalar(
        db, "SELECT id FROM users WHERE phone = '+79990000001'"
    )
    assert isinstance(admin_id, str), "seed admin user not found"

    # Survivor rows inserted AFTER the canon was generated (the fixture has
    # already run) — otherwise the "survived the reset" assertion proves
    # nothing. Fixed readable ids keep the vitest ids verbatim.
    _exec(
        db,
        (
            "INSERT INTO audit_logs (id, created_at, user_id, user_role, action,"
            " entity, entity_label)"
            " VALUES ('aud-1', ?, ?, 'admin', 'create', 'records', 'TEST')",
            (TS, admin_id),
        ),
        (
            "INSERT INTO sessions (token, user_id, created_at, last_extended_at,"
            " idle_deadline, absolute_deadline)"
            " VALUES ('tok-1', ?, ?, ?, ?, ?)",
            (admin_id, TS, TS, TS, TS),
        ),
        (
            "INSERT INTO domain_events (id, created_at, updated_at, type,"
            " occurred_at, snapshot, attempts)"
            " VALUES ('dev-1', ?, ?, 'new_record', ?, '{}', 0)",
            (TS, TS, TS),
        ),
        (
            "INSERT INTO notify_tasks (id, created_at, updated_at, event_id,"
            " scenario, status, reenqueues)"
            " VALUES ('ntk-1', ?, ?, 'dev-1', 'new_record', 'queued', 0)",
            (TS, TS),
        ),
        (
            "INSERT INTO notify_task_attempts (id, task_id, channel, stage,"
            " occurred_at)"
            " VALUES ('nat-1', 'ntk-1', 'telegram', 'sending', ?)",
            (TS,),
        ),
    )
    survivors = {
        "audit_logs": "SELECT COUNT(*) FROM audit_logs WHERE id = 'aud-1'",
        "sessions": "SELECT COUNT(*) FROM sessions WHERE token = 'tok-1'",
        "domain_events": "SELECT COUNT(*) FROM domain_events WHERE id = 'dev-1'",
        "notify_tasks": "SELECT COUNT(*) FROM notify_tasks WHERE id = 'ntk-1'",
        "notify_task_attempts": (
            "SELECT COUNT(*) FROM notify_task_attempts WHERE id = 'nat-1'"
        ),
    }
    for sql in survivors.values():  # the pollution landed
        assert count(db, sql) == 1

    canon_stack.apply()

    # blacklisted tables are untouched by the canon — the survivors stay
    for table, sql in survivors.items():
        assert count(db, sql) == 1, f"survivor row vanished from {table}"
        assert count(db, f"SELECT COUNT(*) FROM {table}") == 1, (
            f"{table} must hold exactly the survivor row"
        )


def snapshot(db: Path) -> dict[str, tuple[int, str]]:
    """Per-table state fingerprint: (row count, content digest) for EVERY
    user table — the "no-op" oracle for the idempotency semantics."""
    conn = sqlite3.connect(str(db))
    try:
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
                " AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        fingerprint: dict[str, tuple[int, str]] = {}
        for t in tables:
            rows = conn.execute(f'SELECT * FROM "{t}" ORDER BY rowid').fetchall()
            fingerprint[t] = (len(rows), hashlib.sha256(repr(rows).encode()).hexdigest())
        return fingerprint
    finally:
        conn.close()


async def test_is_idempotent(canon_stack: CanonStack) -> None:
    """is idempotent (double application is a no-op beyond the first)"""
    db = canon_stack.db
    pollute(canon_stack)

    canon_stack.apply()  # any failure raises — "no errors" of the oracle
    after_first = snapshot(db)

    canon_stack.apply()
    after_second = snapshot(db)

    # the state of every affected table after the second application matches
    # the state after the first (row counts and content digests)
    assert after_second == after_first


async def test_notify_templates_stays_in_canon(canon_stack: CanonStack) -> None:
    """notify_templates stays IN the canon (#482)"""
    db = canon_stack.db
    # The default new_record row — seeded by the alembic data migration
    # (fixed uuid BY DESIGN so it enters the deterministic canon, #482 §5).
    default_id = "27715c0f-1d0f-4895-a555-1cb54f00bc7e"
    assert count(
        db, f"SELECT COUNT(*) FROM notify_templates WHERE id = '{default_id}'"
    ) == 1, "canon-time default template row missing from the fixture DB"

    _exec(
        db,
        (
            "INSERT INTO notify_templates (id, event_type, title, body, is_default,"
            " created_at, updated_at) VALUES (?, 'new_record', ?, ?, 0, ?, ?)",
            ("tpl-polluted", "Загрязнённый шаблон", "x", TS, TS),
        ),
    )
    assert count(db, "SELECT COUNT(*) FROM notify_templates WHERE id = 'tpl-polluted'") == 1

    canon_stack.apply()

    # the deterministic seed row is restored by the canon (total restore) and
    # the polluted non-seed template is wiped — i.e. the table is NOT excluded
    assert count(
        db,
        f"SELECT COUNT(*) FROM notify_templates "
        f"WHERE id = '{default_id}' AND event_type = 'new_record' AND is_default = 1",
    ) == 1
    assert count(db, "SELECT COUNT(*) FROM notify_templates WHERE id = 'tpl-polluted'") == 0
    assert count(db, "SELECT COUNT(*) FROM notify_templates") == 1
