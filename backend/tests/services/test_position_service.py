"""PositionService tests — GH #266 Task 3.

Dictionary CRUD (D4): built-ins (``is_system``) have a fixed string id
anchor, freely editable title, deletion forbidden (``POSITION_IS_SYSTEM``);
user-defined ones live a free lifecycle. Positions affect nothing but the
card list and the future payroll module.

Spec: docs/specs/2026-09-10-staff-restructuring-design.md (D4, «Контракты
ошибок»), docs/domain-rules/staff.md («Fields»).
"""

from __future__ import annotations

import pytest

from src.domain.errors import PositionIsSystemError
from src.models.position import Position
from src.schemas.position import PositionCreate, PositionUpdate
from src.services.position import get_position_service

pytestmark = pytest.mark.asyncio


async def test_create_position_returns_response(db_session) -> None:
    """POST-level create: a user-defined position row lands in the DB."""
    created = await get_position_service().create(
        db_session, PositionCreate(title="СММ")
    )
    assert created.title == "СММ"
    assert created.is_system is False
    row = await db_session.get(Position, created.id)
    assert row is not None and row.title == "СММ"


async def test_update_position_title_editable_even_for_system(db_session) -> None:
    """Built-in title is freely editable (D4) — only deletion is blocked."""
    service = get_position_service()

    db_session.add(Position(id="master", title="Мастер", is_system=True))
    await db_session.flush()

    updated = await service.update(
        db_session, "master", PositionUpdate(title="Ведущий мастер")
    )
    assert updated is not None
    assert updated.title == "Ведущий мастер"
    assert updated.is_system is True


async def test_delete_user_defined_position_succeeds(db_session) -> None:
    """User-defined positions delete freely (bool contract: True)."""
    service = get_position_service()

    created = await service.create(db_session, PositionCreate(title="Уборка"))

    assert await service.delete(db_session, created.id) is True
    assert await db_session.get(Position, created.id) is None


async def test_delete_system_position_raises_position_is_system(db_session) -> None:
    """Deleting a built-in (is_system) position → PositionIsSystemError (422
    ``POSITION_IS_SYSTEM`` in the router), row survives."""
    db_session.add(Position(id="admin", title="Администратор", is_system=True))
    await db_session.flush()

    with pytest.raises(PositionIsSystemError):
        await get_position_service().delete(db_session, "admin")

    assert await db_session.get(Position, "admin") is not None


async def test_delete_missing_position_returns_false(db_session) -> None:
    """delete(nonexistent) → False (router maps to 404 POSITION_NOT_FOUND)."""
    assert await get_position_service().delete(db_session, "nope") is False


async def test_list_positions(db_session) -> None:
    """list() returns every dictionary row (no archive semantics here)."""
    db_session.add_all([
        Position(id="master", title="Мастер", is_system=True),
        Position(title="СММ"),
    ])
    await db_session.flush()

    result = await get_position_service().list(db_session, page=1, per_page=20)
    assert result.total == 2
    titles = {p.title for p in result.items}
    assert titles == {"Мастер", "СММ"}


async def test_get_position_returns_none_for_missing(db_session) -> None:
    """get(nonexistent) → None (router maps to 404)."""
    assert await get_position_service().get(db_session, "master") is None
