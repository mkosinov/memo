"""Staff restructuring #266 Task 10 — migration DATA-preservation smoke (S3).

The e2e stack never exercises the alembic CHAIN: scripts/e2e-shard-start.sh
wipes the DB file, the backend stamps ``alembic_version`` to head (legacy
bootstrap in ``run_alembic_upgrade`` — no tables exist, so there is nothing
to upgrade) and seed.py's ``create_all`` builds the schema. The e2e S3 spec
(staff-s3-migration-seed-smoke.spec.ts) pins the post-migration seed
contract on that fresh stack.

This test covers the OTHER half of the Task 10 NOTE — «заверить миграционный
путь отдельным блоком»: a file-copy DB built at the pre-#266 revision
(``91069ac9acba``), populated with legacy masters/users/activities/tags/
user_settings rows, then ``alembic upgrade head`` — mirroring the manual T1
smoke (file-копия dev-БД → upgrade → данные на месте). It asserts every
«Миграция» spec step that touches DATA:

* step 1 — rename masters → staff preserves ids/names/sort_order;
* step 2 — masters extension rows for EVERY former master (incl. archived),
  specialty/color/is_active carried over;
* steps 3–4 — positions dictionary populated on a data-bearing DB;
  «мастер» → master, «администратор» → admin links;
* step 5 — users.master_id → users.staff_id, value preserved;
* step 6 — activities / master_tags values preserved (FK retarget);
* step 7 — user_settings.column_order_masters → column_order_staff, data kept;
* post — specialty/color/position dropped from staff; FK-clean result
  (``PRAGMA foreign_key_check``).
"""

import logging
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Revision right BEFORE the #266 restructuring (staff chain parent).
LEGACY_REVISION = "91069ac9acba"
HEAD_REVISION = "e5f7a9c3b1d8"

pytestmark = pytest.mark.pure_unit  # own tmp-file DB; the session DB is untouched


def _cfg(db_path: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _legacy_data(db_path: Path) -> None:
    """Insert pre-#266 rows: masters (active/archived/admin), a linked user,
    an activity, a master_tag and user_settings (the columns the migration
    renames/retargets)."""
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO masters (id, first_name, last_name, color, position,"
            " specialty, avatar_url, sort_order, created_at, updated_at, is_active)"
            " VALUES"
            " ('m1', 'Ольга', 'Середа', '#5B8C7A', 'мастер', 'живопись', '', 0,"
            "  datetime('now'), datetime('now'), 1),"
            " ('m2', 'Юлия', 'Большакова', '#6B7E9C', 'мастер', 'керамика', '', 1,"
            "  datetime('now'), datetime('now'), 1),"
            " ('m9', 'Архивный', 'Мастеров', '#111111', 'мастер', 'живопись', '', 2,"
            "  datetime('now'), datetime('now'), 0),"
            " ('a1', 'Админ', 'Админов', '#222222', 'администратор', '', NULL, 3,"
            "  datetime('now'), datetime('now'), 1)"
        ))
        conn.execute(text(
            "INSERT INTO services (id, title, description, image_url, specialty,"
            " min_age, max_age, duration, record_info, created_at, updated_at,"
            " is_active) VALUES ('s1', 't', 'd', '', '', 5, NULL, 90, '',"
            " datetime('now'), datetime('now'), 1)"
        ))
        conn.execute(text(
            "INSERT INTO locations (id, name, capacity, sort_order, created_at,"
            " updated_at, is_active) VALUES ('loc1', 'L', 8, 0,"
            " datetime('now'), datetime('now'), 1)"
        ))
        conn.execute(text(
            "INSERT INTO activities (id, master_id, service_id, location_id,"
            " start, duration, capacity, is_private, created_at, updated_at)"
            " VALUES ('ev1', 'm1', 's1', 'loc1', datetime('now'), 90, 8, 0,"
            " datetime('now'), datetime('now'))"
        ))
        conn.execute(text(
            "INSERT INTO users (id, phone, password_hash, role, master_id,"
            " email_is_confirmed, phone_is_confirmed, failed_login_attempts,"
            " lock_level, is_active, created_at, updated_at)"
            " VALUES ('u1', '+79990000001', 'x', 'master', 'm1', 0, 0, 0, 0, 1,"
            " datetime('now'), datetime('now'))"
        ))
        conn.execute(text(
            "INSERT INTO tags (id, tag, created_at, updated_at)"
            " VALUES ('t1', 'tag', datetime('now'), datetime('now'))"
        ))
        conn.execute(text(
            "INSERT INTO master_tags (master_id, tag_id) VALUES ('m1', 't1')"
        ))
        conn.execute(text(
            "INSERT INTO user_settings (id, user_id, theme, language,"
            " column_order_masters, column_order_locations, created_at,"
            " updated_at) VALUES ('us1', 'u1', 'light', 'ru', '[\"m1\",\"m2\"]',"
            " '[]', datetime('now'), datetime('now'))"
        ))
    engine.dispose()


def test_upgrade_head_preserves_legacy_staff_data(tmp_path: Path) -> None:
    """File-copy migration smoke: legacy rows survive `alembic upgrade head`."""
    db_path = tmp_path / "migration_copy.db"

    # 1. Build the pre-#266 schema and populate it (the dev-copy stand-in).
    logging.getLogger("alembic").setLevel(logging.WARNING)
    cfg = _cfg(db_path)
    command.upgrade(cfg, LEGACY_REVISION)
    _legacy_data(db_path)

    # 2. THE migration under test.
    command.upgrade(cfg, "head")

    # 3. Verify — every spec «Миграция» data step.
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.connect() as conn:
        def rows(sql: str) -> list[tuple[object, ...]]:
            return [tuple(r) for r in conn.execute(text(sql))]

        # At head.
        assert rows("SELECT version_num FROM alembic_version") == [(HEAD_REVISION,)]

        # Step 1 — rename preserved ids/names/sort order.
        assert rows(
            "SELECT id, first_name, last_name, sort_order FROM staff"
            " ORDER BY sort_order"
        ) == [
            ("m1", "Ольга", "Середа", 0),
            ("m2", "Юлия", "Большакова", 1),
            ("m9", "Архивный", "Мастеров", 2),
            ("a1", "Админ", "Админов", 3),
        ]
        # Post-step — specialty/color/position left the person table.
        staff_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(staff)"))}
        assert not staff_cols & {"specialty", "color", "position"}

        # Step 2 — one masters row per former master, INCLUDING the archived
        # one and the «администратор» (is_active carried over verbatim, D3).
        assert rows(
            "SELECT staff_id, specialty, color, is_active FROM masters"
            " ORDER BY staff_id"
        ) == [
            ("a1", "", "#222222", 1),
            ("m1", "живопись", "#5B8C7A", 1),
            ("m2", "керамика", "#6B7E9C", 1),
            ("m9", "живопись", "#111111", 0),
        ]

        # Steps 3–4 — dictionary populated on a data-bearing DB; links follow
        # the old position strings.
        assert rows("SELECT id, title, is_system FROM positions ORDER BY id") == [
            ("admin", "Администратор", 1),
            ("master", "Мастер", 1),
            ("smm", "СММ", 0),
        ]
        assert rows(
            "SELECT staff_id, position_id FROM staff_positions ORDER BY staff_id"
        ) == [("a1", "admin"), ("m1", "master"), ("m2", "master"), ("m9", "master")]

        # Step 5 — users.master_id renamed, value preserved.
        assert rows("SELECT id, staff_id FROM users") == [("u1", "m1")]

        # Step 6 — activities / master_tags values preserved under the
        # retargeted FKs.
        assert rows("SELECT id, master_id FROM activities") == [("ev1", "m1")]
        assert rows("SELECT master_id, tag_id FROM master_tags") == [("m1", "t1")]

        # Step 7 — user_settings column renamed, DATA preserved.
        assert rows("SELECT user_id, column_order_staff FROM user_settings") == [
            ("u1", '["m1","m2"]'),
        ]

        # The whole result is FK-clean (spec «Миграция» step 6 requirement).
        assert rows("PRAGMA foreign_key_check") == []
    engine.dispose()
