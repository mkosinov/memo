"""Staff restructuring #266 Task 1 — ORM models + migration + seed.

Verifies the new schema shape (staff / masters / positions / staff_positions),
that the per-test alembic circuit raises it without FK errors, and that the
seed populates the new tables with unchanged ids (m1–m5, m7).

The full suite is RED in the declared T1–T3 window (masters routes/services
still reference the old shape); these tests are the GREEN target of Task 1.
"""

from sqlalchemy import text

from src.db.base import Base
from src.models import Master, Position, Staff, User, UserSettings
from src.models.position import staff_positions
from tests.conftest import query_db


def _cols(table: str) -> set[str]:
    """Column names of *table* per PRAGMA (works against the test DB file)."""
    return {r["name"] for r in query_db(f"PRAGMA table_info({table})")}


def _pk(table: str) -> list[str]:
    """PK column names of *table*, in declaration order."""
    rows = sorted(
        (r for r in query_db(f"PRAGMA table_info({table})") if r["pk"]),
        key=lambda r: r["pk"],
    )
    return [r["name"] for r in rows]


def _fks(table: str) -> list[dict]:
    """FK list of *table* (referred table/columns, ondelete)."""
    out: list[dict] = []
    for r in query_db(f"PRAGMA foreign_key_list({table})"):
        out.append(
            {
                "table": r["table"],
                "from": r["from"],
                "to": r["to"],
                "on_delete": r["on_delete"],
            }
        )
    return out


class TestStaffTableShape:
    """staff = renamed masters: people columns only (spec «Модель данных»)."""

    def test_staff_columns(self) -> None:
        cols = _cols("staff")
        expected = {
            "id", "first_name", "last_name", "avatar_url", "sort_order",
            "is_active", "created_at", "updated_at",
        }
        assert expected <= cols
        # specialty/color/position left the table (moved to masters/positions)
        assert not ({"specialty", "color", "position"} & cols)

    def test_masters_is_extension_table(self) -> None:
        """masters: PK staff_id → staff.id CASCADE + specialty/color/is_active."""
        cols = _cols("masters")
        assert cols == {
            "staff_id", "specialty", "color", "is_active",
            "created_at", "updated_at",
        }

    def test_masters_pk_is_staff_id(self) -> None:
        assert _pk("masters") == ["staff_id"]

    def test_masters_fk_cascades_on_staff_delete(self) -> None:
        fks = _fks("masters")
        assert len(fks) == 1
        assert fks[0]["table"] == "staff"
        assert fks[0]["from"] == "staff_id"
        assert fks[0]["to"] == "id"
        assert fks[0]["on_delete"].upper() == "CASCADE"

    def test_positions_table(self) -> None:
        cols = _cols("positions")
        assert {"id", "title", "is_system", "created_at", "updated_at"} <= cols

    def test_staff_positions_join(self) -> None:
        cols = _cols("staff_positions")
        assert cols == {"staff_id", "position_id"}


class TestUsersRetargeted:
    """users.master_id → users.staff_id, FK staff, named unique (D9)."""

    def test_users_column_renamed(self) -> None:
        cols = _cols("users")
        assert "staff_id" in cols
        assert "master_id" not in cols

    def test_users_fk_points_to_staff(self) -> None:
        fks = [fk for fk in _fks("users") if fk["from"] == "staff_id"]
        assert len(fks) == 1
        assert fks[0]["table"] == "staff"

    def test_users_staff_id_unique(self) -> None:
        ddl = query_db(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
        )[0]["sql"]
        assert "UNIQUE (staff_id)" in ddl or "uq_users_staff_id" in ddl, (
            "users.staff_id must carry a unique constraint"
        )


class TestFKRetargeting:
    """activities/master_tags keep master_id, FK → new masters.staff_id (D9)."""

    def test_activities_fk(self) -> None:
        fks = [fk for fk in _fks("activities") if fk["from"] == "master_id"]
        assert len(fks) == 1
        assert fks[0]["table"] == "masters"
        assert fks[0]["to"] == "staff_id"

    def test_master_tags_fk(self) -> None:
        fks = [fk for fk in _fks("master_tags") if fk["from"] == "master_id"]
        assert len(fks) == 1
        assert fks[0]["table"] == "masters"
        assert fks[0]["to"] == "staff_id"

    def test_user_settings_column_renamed(self) -> None:
        cols = _cols("user_settings")
        assert "column_order_staff" in cols
        assert "column_order_masters" not in cols


class TestOrmModels:
    """Python-side: classes exist, register in metadata, right tablenames."""

    def test_staff_model(self) -> None:
        assert Staff.__tablename__ == "staff"
        assert "staff" in Base.metadata.tables

    def test_master_model_is_extension(self) -> None:
        assert Master.__tablename__ == "masters"
        cols = {c.name for c in Master.__table__.columns}
        assert cols == {"staff_id", "specialty", "color", "is_active",
                        "created_at", "updated_at"}

    def test_position_model_and_join(self) -> None:
        assert Position.__tablename__ == "positions"
        assert "staff_positions" in Base.metadata.tables

    def test_user_model_staff_id(self) -> None:
        assert hasattr(User, "staff_id")
        assert not hasattr(User, "master_id")

    def test_user_settings_model(self) -> None:
        assert hasattr(UserSettings, "column_order_staff")
        assert not hasattr(UserSettings, "column_order_masters")

    def test_dead_enums_removed(self) -> None:
        """Position/Specialty str-enums are dead after the dict tables."""
        import src.models.enums as enums

        assert not hasattr(enums, "Position")
        assert not hasattr(enums, "Specialty")


class TestSeed:
    """Seed writes staff/masters/positions rows with unchanged ids."""

    def test_seed_populates_new_tables(self) -> None:
        import asyncio

        from src.db.database import DBManager
        from src.seed.seed import seed_data

        async def _run() -> None:
            manager = DBManager("sqlite+aiosqlite:///:memory:")
            try:
                await seed_data(manager)
                async with manager.async_session() as session:
                    staff_ids = (await session.execute(text(
                        "SELECT id FROM staff ORDER BY sort_order"
                    ))).scalars().all()
                    assert staff_ids == ["m1", "m2", "m3", "m4", "m5", "m7"]

                    masters = (await session.execute(text(
                        "SELECT staff_id, specialty, color, is_active FROM masters"
                        " ORDER BY staff_id"
                    ))).all()
                    assert [m[0] for m in masters] == ["m1", "m2", "m3", "m4", "m5", "m7"]
                    m1 = dict(zip(("staff_id", "specialty", "color", "is_active"), masters[0]))
                    assert m1["specialty"] == "живопись"
                    assert m1["color"] == "#5B8C7A"
                    assert m1["is_active"] == 1

                    positions = dict((await session.execute(text(
                        "SELECT id, title FROM positions"
                    ))).all())
                    assert positions["master"] == "Мастер"
                    assert positions["admin"] == "Администратор"
                    assert "smm" in positions  # user-defined, unassigned

                    links = (await session.execute(text(
                        "SELECT sp.staff_id, sp.position_id FROM staff_positions sp"
                        " ORDER BY sp.staff_id"
                    ))).all()
                    assert links == [
                        ("m1", "master"), ("m2", "master"), ("m3", "master"),
                        ("m4", "master"), ("m5", "master"), ("m7", "master"),
                    ]

                    # users linked via staff_id (demo master account → m1)
                    users = (await session.execute(text(
                        "SELECT phone, staff_id FROM users ORDER BY phone"
                    ))).all()
                    assert ("+79990000002", "m1") in users
            finally:
                await manager.engine.dispose()

        asyncio.run(_run())
