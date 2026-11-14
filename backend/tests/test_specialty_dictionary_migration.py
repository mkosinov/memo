"""GH #599 Task 1 — R1 migration tests (specialties dictionary structures).

R1 is the structure-only DDL revision of the specialty-dictionary wave
(spec §4.1, plan invariant «дерево зелёное после каждой задачи»):

* ``specialties`` + BOTH indexes — the functional UNIQUE ``lower(title)``
  (handwritten ``op.create_index`` — autogenerate never carries an
  expression index) and the plain ``title`` index (fixed-order lists);
* ``staff_specialties`` M2M — composite PK ``(staff_id, specialty_id)``,
  both FKs ON DELETE CASCADE, plus the dedicated ``specialty_id`` index;
* ``services.specialty_id`` — NULLABLE FK RESTRICT with an explicit
  column index (NOT NULL arrives with R2/Task 3; nothing reads the
  column yet — the Service model maps it in Task 3).

Downgrade drops everything R1 added (dev-only convenience — prod is
empty). The uniqueness SEMANTIC is pinned here too: the functional
index must reject a Cyrillic case-variant (the app's Unicode ``lower``
UDD is registered per-connection by the engine connect listener, so
these inserts go through a SQLAlchemy engine, not a raw sqlite3 one).
"""

import logging
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Revision right BEFORE R1 (the new migration's parent).
LEGACY_REVISION = "c1d3e5f7a9b1"

# R1 itself (structure-only; R2 — services.specialty_id NOT NULL + the
# legacy-column drop — chains after it, GH #599 Task 3).
R1_REVISION = "a5c7e9b1d3f4"

from alembic.script import ScriptDirectory  # noqa: E402

HEAD_REVISION = ScriptDirectory(str(BACKEND_DIR / "alembic")).get_current_head()

pytestmark = pytest.mark.pure_unit  # own tmp-file DB; the session DB is untouched


def _cfg(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def test_r1_upgrade_creates_structures(tmp_path: Path) -> None:
    """upgrade → R1 on an EMPTY DB: all three structures + indexes.

    Pinned to R1 exactly (head keeps moving — R2 flips specialty_id to
    NOT NULL and drops the legacy services.specialty column; the R1
    contract here is the NULLABLE interim state).
    """
    db_path = tmp_path / "specialty_r1.db"
    logging.getLogger("alembic").setLevel(logging.WARNING)
    command.upgrade(_cfg(db_path), R1_REVISION)

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            # At R1.
            rows = [tuple(r) for r in conn.execute(text("SELECT version_num FROM alembic_version"))]
            assert rows == [(R1_REVISION,)]
            assert rows[0][0] != LEGACY_REVISION, "head must have moved past the pre-R1 revision"

            # specialties: both indexes (unique functional + plain title).
            tables = {
                r[0]
                for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
            }
            assert {"specialties", "staff_specialties"} <= tables

            indexes = {
                r[1]: bool(r[2]) for r in conn.execute(text("PRAGMA index_list('specialties')"))
            }
            assert indexes.get("ux_specialties_lower_title") is True, (
                "the functional UNIQUE lower(title) index is missing"
            )
            assert "ix_specialties_title" in indexes

            index_sql = conn.execute(
                text("SELECT sql FROM sqlite_master WHERE name='ux_specialties_lower_title'")
            ).scalar_one()
            assert "lower(title)" in index_sql

            # staff_specialties: composite PK + both FKs CASCADE + the
            # dedicated specialty_id index.
            pk_cols = [
                r[1] for r in conn.execute(text("PRAGMA table_info('staff_specialties')")) if r[5]
            ]
            assert pk_cols == ["staff_id", "specialty_id"]
            fks = {
                (r[2], r[3], r[6]): r[4]
                for r in conn.execute(text("PRAGMA foreign_key_list('staff_specialties')"))
            }
            assert fks.get(("staff", "staff_id", "CASCADE")) == "id"
            assert fks.get(("specialties", "specialty_id", "CASCADE")) == "id"
            join_indexes = {
                r[1] for r in conn.execute(text("PRAGMA index_list('staff_specialties')"))
            }
            assert "ix_staff_specialties_specialty_id" in join_indexes

            # services.specialty_id: NULLABLE FK RESTRICT + explicit index.
            svc_cols = {r[1]: r[3] for r in conn.execute(text("PRAGMA table_info('services')"))}
            assert svc_cols.get("specialty_id") == 0, "R1 column must stay NULLABLE"
            svc_fks = [
                r
                for r in conn.execute(text("PRAGMA foreign_key_list('services')"))
                if r[2] == "specialties"
            ]
            assert svc_fks, "services.specialty_id FK to specialties is missing"
            assert all(r[6] == "RESTRICT" for r in svc_fks)
            svc_indexes = {r[1] for r in conn.execute(text("PRAGMA index_list('services')"))}
            assert "ix_services_specialty_id" in svc_indexes
    finally:
        engine.dispose()


def test_r1_functional_unique_index_rejects_case_variants(tmp_path: Path) -> None:
    """The UNIQUE lower(title) index enforces case-insensitive
    uniqueness at the DB level (the authoritative TOCTOU defense), and
    a rename to the row's own case-variant passes."""
    from sqlalchemy.exc import IntegrityError

    db_path = tmp_path / "specialty_unique.db"
    logging.getLogger("alembic").setLevel(logging.WARNING)
    command.upgrade(_cfg(db_path), "head")

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO specialties (id, title, created_at, updated_at)"
                    " VALUES ('s1', 'Живопись', datetime('now'), datetime('now'))"
                )
            )
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO specialties (id, title, created_at, updated_at)"
                    " VALUES ('s2', 'живопись', datetime('now'), datetime('now'))"
                )
            )
        # Rename-to-self (case-variant of the same row) never conflicts.
        with engine.begin() as conn:
            conn.execute(text("UPDATE specialties SET title = 'ЖИВОПИСЬ' WHERE id = 's1'"))
    finally:
        engine.dispose()


def test_r1_downgrade_drops_structures(tmp_path: Path) -> None:
    """downgrade head → LEGACY_REVISION: everything R1 added is gone."""
    db_path = tmp_path / "specialty_r1_down.db"
    logging.getLogger("alembic").setLevel(logging.WARNING)
    command.upgrade(_cfg(db_path), "head")
    command.downgrade(_cfg(db_path), LEGACY_REVISION)

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            tables = {
                r[0]
                for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
            }
            assert "specialties" not in tables
            assert "staff_specialties" not in tables

            svc_cols = {r[1] for r in conn.execute(text("PRAGMA table_info('services')"))}
            assert "specialty_id" not in svc_cols
    finally:
        engine.dispose()


# ─── GH #599 Task 3 — R2: NOT NULL + the legacy-column drop ────────────────────


def test_r2_upgrade_not_null_and_drops_legacy_column(tmp_path: Path) -> None:
    """upgrade → head on an EMPTY DB: ``specialty_id`` is NOT NULL, the
    legacy free-text ``services.specialty`` column is GONE; FK RESTRICT
    and the explicit index survive the batch recreate."""
    db_path = tmp_path / "specialty_r2.db"
    logging.getLogger("alembic").setLevel(logging.WARNING)
    command.upgrade(_cfg(db_path), "head")

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            rows = [tuple(r) for r in conn.execute(text("SELECT version_num FROM alembic_version"))]
            assert rows == [(HEAD_REVISION,)]

            svc_cols = {r[1]: r[3] for r in conn.execute(text("PRAGMA table_info('services')"))}
            assert "specialty" not in svc_cols, "legacy services.specialty must be dropped"
            assert svc_cols.get("specialty_id") == 1, "specialty_id must be NOT NULL at head"

            svc_fks = [
                r
                for r in conn.execute(text("PRAGMA foreign_key_list('services')"))
                if r[2] == "specialties"
            ]
            assert svc_fks, "services.specialty_id FK to specialties is missing"
            assert all(r[6] == "RESTRICT" for r in svc_fks)
            svc_indexes = {r[1] for r in conn.execute(text("PRAGMA index_list('services')"))}
            assert "ix_services_specialty_id" in svc_indexes
    finally:
        engine.dispose()


def test_r2_downgrade_restores_column_and_relaxes_not_null(tmp_path: Path) -> None:
    """downgrade head → R1: the legacy text column returns (EMPTY — data
    is not restored, dev-only convenience, spec §4.1) and ``specialty_id``
    is nullable again; a second upgrade returns to head (roundtrip green
    — the tree stays walkable in both directions)."""
    db_path = tmp_path / "specialty_r2_down.db"
    logging.getLogger("alembic").setLevel(logging.WARNING)
    cfg = _cfg(db_path)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, R1_REVISION)

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            svc_cols = {r[1]: r[3] for r in conn.execute(text("PRAGMA table_info('services')"))}
            assert "specialty" in svc_cols, "downgrade must return the legacy text column"
            assert svc_cols.get("specialty_id") == 0, "specialty_id back to NULLABLE at R1"
    finally:
        engine.dispose()

    # And back up — green on the empty base.
    command.upgrade(cfg, "head")
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            rows = [tuple(r) for r in conn.execute(text("SELECT version_num FROM alembic_version"))]
            assert rows == [(HEAD_REVISION,)]
            svc_cols = {r[1]: r[3] for r in conn.execute(text("PRAGMA table_info('services')"))}
            assert "specialty" not in svc_cols
            assert svc_cols.get("specialty_id") == 1
    finally:
        engine.dispose()


def test_r2_upgrade_fails_on_legacy_service_rows_not_null(tmp_path: Path) -> None:
    """Negative contract (spec §4.1): on a base with the OLD schema and
    ≥1 service row, upgrading past R1 FAILS with the штатная NOT NULL
    error — the legacy row's ``specialty_id`` is NULL and R2 flips the
    column to NOT NULL. Expected behavior: the dev base is reseeded once
    (Task 7), prod is empty."""
    from sqlalchemy.exc import IntegrityError

    db_path = tmp_path / "specialty_r2_nonempty.db"
    logging.getLogger("alembic").setLevel(logging.WARNING)
    cfg = _cfg(db_path)
    # OLD schema (pre-R1): services.specialty is the free-text column.
    command.upgrade(cfg, LEGACY_REVISION)
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO services (id, title, description, image_url,"
                    " specialty, min_age, max_age, duration, record_info,"
                    " created_at, updated_at, is_active)"
                    " VALUES ('svc-legacy', 'Легаси', 'о', '', 'живопись',"
                    " 6, NULL, 90, '', datetime('now'), datetime('now'), 1)"
                )
            )
    finally:
        engine.dispose()

    # R1 (adds the nullable specialty_id — NULL on the legacy row) is fine…
    command.upgrade(cfg, R1_REVISION)
    # …R2 is NOT: NOT NULL over a NULL column → штатная ошибка базы.
    with pytest.raises(IntegrityError):
        command.upgrade(cfg, "head")

    # The base is left AT R1 with the row intact (transactional alembic).
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            rows = [tuple(r) for r in conn.execute(text("SELECT version_num FROM alembic_version"))]
            assert rows == [(R1_REVISION,)]
            surviving = conn.execute(
                text("SELECT id FROM services WHERE id = 'svc-legacy'")
            ).scalar_one_or_none()
            assert surviving == "svc-legacy"
    finally:
        engine.dispose()
