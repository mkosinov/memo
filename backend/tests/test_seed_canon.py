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
