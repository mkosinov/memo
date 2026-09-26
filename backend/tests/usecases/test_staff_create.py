"""Unit tests for the ``create_staff`` scenario (GH #326 Task 3).

Pin-first oracle (plan #326 Task 3): these tests pin TODAY's composite
``StaffService.create`` behavior — branch grids, step order, atomicity —
BEFORE the StaffService demolition; the scenario must stay
behavior-identical (spec §Behavioral Delta: до = после).

Corridor 2 (canon docs/domain-rules/service-layer.md rule 2): ONE
``@transactional`` boundary + ONE event batch per action, composing the
non-transactional building blocks of the owners:

- card row + own ``staff_positions`` bundle — ``StaffService`` blocks;
- masters extension — ``MasterService`` (Task 2);
- account — ``UserService`` + ``resolve_account_role`` (Task 1).

CALLING CONVENTION: the scenario is a selfless function — the
``@transactional`` wrapper binds the first positional arg as ``self``, so
it is invoked with a leading ``None`` and keyword arguments (see the
module docstring of ``src/usecases/records.py``).

Authorization negative case (role ``master`` → 403 on every mutating
staff endpoint) is ALREADY covered by ``tests/test_master_scope_contract.py``
(the ``/api/v1/staff`` 403 allowlist entries) and
``tests/test_auth_guards.py::test_master_dictionary_write_forbidden`` —
not duplicated here, per the task's by-reference rule.
"""

from __future__ import annotations

import uuid as _uuid
from typing import Any

import pytest
from sqlalchemy import select

from src.auth.passwords import verify_password
from src.domain.errors import (
    ColorRequiredError,
    PositionNotFoundError,
    SpecialtyRequiredError,
)
from src.models.master import Master
from src.models.position import Position, staff_positions
from src.models.staff import Staff
from src.models.user import User
from src.schemas.staff import StaffCreate
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


# ─── helpers (direct ORM seeding, per the sibling records/usecases pattern) ──


async def _add_position(db_session: Any, **kwargs: Any) -> Position:
    position = Position(**kwargs) if kwargs else Position(title="СММ")
    db_session.add(position)
    await db_session.flush()
    return position


def _create_payload(**overrides: Any) -> StaffCreate:
    return StaffCreate(first_name="Ольга", last_name="Иванова", **overrides)


def _drain(q: Any) -> list[tuple[set[str], object]]:
    """Collect everything currently sitting in the hub queue."""
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


@pytest.fixture
def subscriber():
    """Subscribe to the module-level event hub for ONE test; drain on exit."""
    from src.events.hub import hub

    q = hub.subscribe()
    try:
        yield q
    finally:
        hub.unsubscribe(q)


class StepBoomError(RuntimeError):
    """Injected mid-scenario failure — must propagate, never be swallowed."""


# ─── canon shape ─────────────────────────────────────────────────────────────


async def test_create_staff_is_transactional() -> None:
    """The scenario owns the transaction boundary — it must be wrapped."""
    from src.usecases.staff import create_staff

    assert hasattr(create_staff, _TRANSACTIONAL_MARKER), (
        "create_staff is a Corridor-2 scenario — it must be wrapped by "
        "@transactional (one transaction + one event batch per action)"
    )


async def test_usecases_staff_module_has_no_runtime_orm_imports() -> None:
    """Canon rule 2: scenarios import services/events/schemas/domain —
    never ORM models at runtime (TYPE_CHECKING-only annotations are OK)."""
    import ast
    import inspect
    import sys

    import src.usecases.staff as staff_module

    source = inspect.getsource(sys.modules[staff_module.__name__])
    tree = ast.parse(source)

    def _is_type_checking_guard(node: ast.expr) -> bool:
        return (isinstance(node, ast.Name) and node.id == "TYPE_CHECKING") or (
            isinstance(node, ast.Attribute) and node.attr == "TYPE_CHECKING"
        )

    def visit(node: ast.AST, guarded: bool, found: list[str]) -> None:
        if isinstance(node, ast.ImportFrom) and node.module:
            if not guarded and node.module.startswith("src.models"):
                found.append(f"line {node.lineno}: from {node.module}")
            return
        if isinstance(node, ast.Import):
            if not guarded:
                for alias in node.names:
                    if alias.name.startswith("src.models"):
                        found.append(f"line {node.lineno}: import {alias.name}")
            return
        if isinstance(node, ast.If) and _is_type_checking_guard(node.test):
            for child in node.body:
                visit(child, guarded=True, found=found)
            for child in node.orelse:
                visit(child, guarded=False, found=found)
            return
        for child in ast.iter_child_nodes(node):
            visit(child, guarded, found)

    offenders: list[str] = []
    visit(tree, guarded=False, found=offenders)
    assert offenders == [], (
        "usecases/staff.py has runtime ORM-model imports — canon rule 2 "
        "(docs/domain-rules/service-layer.md): scenarios compose service "
        f"and domain calls only. Offenders: {offenders}"
    )


# ─── branches: card / section / positions / user ────────────────────────────


async def test_plain_card_creates_staff_row_only(db_session) -> None:
    """S1: bare card — one staff row, no masters row, no user, no links."""
    from src.usecases.staff import create_staff

    created = await create_staff(None, db_session=db_session, data=_create_payload())

    assert created.first_name == "Ольга"
    assert created.last_name == "Иванова"
    assert created.master is None
    assert created.position_ids == []
    assert created.archived is False
    assert created.has_user is False
    staff_id = created.id
    assert await db_session.get(Staff, staff_id) is not None
    assert (await db_session.execute(
        select(Master).where(Master.staff_id == staff_id)
    )).scalar_one_or_none() is None
    assert (await db_session.execute(
        select(User).where(User.staff_id == staff_id)
    )).scalar_one_or_none() is None


async def test_with_master_section_creates_active_extension(db_session) -> None:
    """S7: card + section payload → masters row lands ACTIVE with the sent
    specialty/color; the response echoes the section."""
    from src.usecases.staff import create_staff

    created = await create_staff(None, db_session=db_session, data=_create_payload(
        master={"specialty": "керамика", "color": "#FF0000"},
    ))

    assert created.master is not None
    assert created.master.specialty == "керамика"
    assert created.master.color == "#FF0000"
    assert created.master.archived is False
    ext = (await db_session.execute(
        select(Master).where(Master.staff_id == created.id)
    )).scalar_one()
    assert ext.is_active is True


async def test_with_archived_section_creates_inactive_extension(db_session) -> None:
    """T8 Gap A: ``archived=True`` on create → the section is BORN archived."""
    from src.usecases.staff import create_staff

    created = await create_staff(None, db_session=db_session, data=_create_payload(
        master={"specialty": "с", "color": "#112233", "archived": True},
    ))

    ext = (await db_session.execute(
        select(Master).where(Master.staff_id == created.id)
    )).scalar_one()
    assert ext.is_active is False
    assert created.master is not None
    assert created.master.archived is True


async def test_with_positions_links_and_dedupes(db_session) -> None:
    """position_ids land as M2M rows; a repeated id collapses (set
    semantics, no IntegrityError on the composite PK)."""
    from src.usecases.staff import create_staff

    p1 = await _add_position(db_session, id="master", title="Мастер", is_system=True)
    p2 = await _add_position(db_session)

    created = await create_staff(None, db_session=db_session, data=_create_payload(
        position_ids=[p1.id, p2.id, p2.id],
    ))

    assert sorted(created.position_ids) == sorted([p1.id, p2.id])
    linked = (await db_session.execute(
        select(staff_positions.c.position_id)
        .where(staff_positions.c.staff_id == created.id)
    )).scalars().all()
    assert sorted(linked) == sorted([p1.id, p2.id])  # dedupe → exactly 2 rows


async def test_with_user_creates_linked_hashed_account(db_session) -> None:
    """D6 checkbox: account row lands linked to the card, password hashed;
    master-section card → role "master" (the #247 fallback)."""
    from src.usecases.staff import create_staff

    phone = f"+7999{_uuid.uuid4().hex[:7]}"
    created = await create_staff(None, db_session=db_session, data=_create_payload(
        master={"specialty": "живопись", "color": "#5B8C7A"},
        create_user={"phone": phone, "password": "secret12345"},
    ))

    assert created.has_user is True
    user = (await db_session.execute(
        select(User).where(User.staff_id == created.id)
    )).scalar_one()
    assert user.phone == phone
    assert user.is_active is True
    assert user.role == "master"
    assert verify_password("secret12345", user.password_hash)


async def test_with_user_guarantees_settings_row(db_session) -> None:
    """GH #319 invariant: the «Учётка» creation path lands the UserSettings
    defaults row in the SAME transaction as the account insert (moved from
    the former ``StaffService.create`` composite test — the scenario is the
    account-creation path since #326)."""
    from src.models.user_settings import UserSettings
    from src.usecases.staff import create_staff

    created = await create_staff(None, db_session=db_session, data=_create_payload(
        create_user={
            "phone": f"+7999{_uuid.uuid4().hex[:7]}", "password": "secret12345",
        },
    ))

    user = (await db_session.execute(
        select(User).where(User.staff_id == created.id)
    )).scalar_one()
    settings = (await db_session.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )).scalar_one_or_none()
    assert settings is not None, (
        "GH #319 invariant broken: «Учётка» created the account without "
        "a user_settings row"
    )


async def test_user_without_section_gets_admin_fallback(db_session) -> None:
    from src.usecases.staff import create_staff

    created = await create_staff(None, db_session=db_session, data=_create_payload(
        create_user={
            "phone": f"+7999{_uuid.uuid4().hex[:7]}", "password": "secret12345",
        },
    ))
    user = (await db_session.execute(
        select(User).where(User.staff_id == created.id)
    )).scalar_one()
    assert user.role == "admin"


async def test_user_position_template_roles(db_session) -> None:
    """D10 template on create: anchored «мастер» position → master;
    «админ» → admin; both → SENIOR admin wins; explicit beats template."""
    from src.models.enums import UserRole
    from src.usecases.staff import create_staff

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    await _add_position(db_session, id="admin", title="Админ", is_system=True)

    phone = f"+7999{_uuid.uuid4().hex[:7]}"
    created = await create_staff(None, db_session=db_session, data=_create_payload(
        position_ids=["master"],
        create_user={"phone": phone, "password": "secret12345"},
    ))
    role = (await db_session.execute(
        select(User.role).where(User.staff_id == created.id)
    )).scalar_one()
    assert role == UserRole.MASTER.value

    phone = f"+7999{_uuid.uuid4().hex[:7]}"
    created = await create_staff(None, db_session=db_session, data=_create_payload(
        position_ids=["admin"],
        create_user={"phone": phone, "password": "secret12345"},
    ))
    role = (await db_session.execute(
        select(User.role).where(User.staff_id == created.id)
    )).scalar_one()
    assert role == UserRole.ADMIN.value

    phone = f"+7999{_uuid.uuid4().hex[:7]}"
    created = await create_staff(None, db_session=db_session, data=_create_payload(
        position_ids=["master", "admin"],
        create_user={"phone": phone, "password": "secret12345"},
    ))
    role = (await db_session.execute(
        select(User.role).where(User.staff_id == created.id)
    )).scalar_one()
    assert role == UserRole.ADMIN.value  # senior wins

    # Explicit role beats the template (master position, manual admin).
    phone = f"+7999{_uuid.uuid4().hex[:7]}"
    created = await create_staff(None, db_session=db_session, data=_create_payload(
        position_ids=["master"],
        create_user={
            "phone": phone, "password": "secret12345", "role": "admin",
        },
    ))
    role = (await db_session.execute(
        select(User.role).where(User.staff_id == created.id)
    )).scalar_one()
    assert role == UserRole.ADMIN.value


# ─── domain errors (422 semantics, same error types as today) ───────────────


async def test_blank_specialty_raises(db_session) -> None:
    from src.usecases.staff import create_staff

    with pytest.raises(SpecialtyRequiredError):
        await create_staff(None, db_session=db_session, data=_create_payload(
            master={"specialty": "   ", "color": "#FF0000"},
        ))


async def test_blank_color_raises(db_session) -> None:
    from src.usecases.staff import create_staff

    with pytest.raises(ColorRequiredError):
        await create_staff(None, db_session=db_session, data=_create_payload(
            master={"specialty": "живопись", "color": "  "},
        ))


async def test_unknown_position_raises(db_session) -> None:
    from src.usecases.staff import create_staff

    with pytest.raises(PositionNotFoundError):
        await create_staff(None, db_session=db_session, data=_create_payload(
            position_ids=["ghost-id"],
        ))


async def test_short_password_raises_policy_error(db_session) -> None:
    from src.auth.passwords import PasswordPolicyError
    from src.usecases.staff import create_staff

    with pytest.raises(PasswordPolicyError):
        await create_staff(None, db_session=db_session, data=_create_payload(
            create_user={
                "phone": f"+7999{_uuid.uuid4().hex[:7]}", "password": "short",
            },
        ))


# ─── event grids (GH #239, pinned BEFORE the demolition — the oracle) ───────


async def test_grid_plain_card_is_staff_only(db_session, subscriber) -> None:
    from src.usecases.staff import create_staff

    created = await create_staff(None, db_session=db_session, data=_create_payload())
    assert created is not None

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE @transactional = ONE event batch, got {events}"
    entities, origin = events[0]
    assert entities == {"staff"}, (
        f"bare card must publish exactly {{'staff'}}, got {events}"
    )
    assert origin is None


async def test_grid_full_composite(db_session, subscriber) -> None:
    """Section + positions + user → exactly {staff, masters,
    staff_positions, users} — byte-parity with today's conditional marks."""
    from src.usecases.staff import create_staff

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    created = await create_staff(None, db_session=db_session, data=_create_payload(
        master={"specialty": "живопись", "color": "#5B8C7A"},
        position_ids=["master"],
        create_user={
            "phone": f"+7999{_uuid.uuid4().hex[:7]}", "password": "secret12345",
        },
    ))
    assert created is not None

    events = _drain(subscriber)
    assert len(events) == 1, f"ONE event batch expected, got {events}"
    assert events[0][0] == {"staff", "masters", "staff_positions", "users"}


async def test_grid_empty_positions_not_marked(db_session, subscriber) -> None:
    """Card + section WITHOUT positions: empty position list is NOT a
    change → no staff_positions mark (parity with today's `if
    data.position_ids`)."""
    from src.usecases.staff import create_staff

    created = await create_staff(None, db_session=db_session, data=_create_payload(
        master={"specialty": "живопись", "color": "#5B8C7A"},
    ))
    assert created is not None

    events = _drain(subscriber)
    assert events[0][0] == {"staff", "masters"}


async def test_grid_failure_publishes_nothing(db_session, subscriber) -> None:
    from src.usecases.staff import create_staff

    with pytest.raises(PositionNotFoundError):
        await create_staff(None, db_session=db_session, data=_create_payload(
            master={"specialty": "живопись", "color": "#5B8C7A"},
            position_ids=["ghost-id"],
        ))

    await db_session.rollback()
    assert _drain(subscriber) == [], "a failed create must publish NOTHING"


# ─── step order (as today: card → section → positions → user) ───────────────


def _recording_proxy(real: Any, tag: str, calls: list[str]) -> Any:
    """Wrap every public method of *real* with a call recorder."""

    class _Proxy:
        def __getattr__(self, name: str) -> Any:
            attr = getattr(real, name)
            if callable(attr) and not name.startswith("_"):
                async def wrapped(*args: Any, **kwargs: Any) -> Any:
                    calls.append(f"{tag}.{name}")
                    return await attr(*args, **kwargs)
                return wrapped
            return attr

    return _Proxy()


async def test_step_order_card_section_positions_user(
    db_session, monkeypatch,
) -> None:
    import src.usecases.staff as staff_module
    from src.services.master import get_master_service
    from src.services.staff import get_staff_service
    from src.services.user import get_user_service

    calls: list[str] = []
    monkeypatch.setattr(staff_module, "get_staff_service", lambda: _recording_proxy(
        get_staff_service(), "staff", calls,
    ))
    monkeypatch.setattr(staff_module, "get_master_service", lambda: _recording_proxy(
        get_master_service(), "masters", calls,
    ))
    monkeypatch.setattr(staff_module, "get_user_service", lambda: _recording_proxy(
        get_user_service(), "users", calls,
    ))

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    await staff_module.create_staff(None, db_session=db_session, data=_create_payload(
        master={"specialty": "живопись", "color": "#5B8C7A"},
        position_ids=["master"],
        create_user={
            "phone": f"+7999{_uuid.uuid4().hex[:7]}", "password": "secret12345",
        },
    ))

    assert calls == [
        "staff.create_card",             # 1. person card
        "masters.upsert_extension",      # 2. section (optional)
        "staff.replace_positions",       # 3. own M2M bundle
        "users.create_staff_account",    # 4. account (create-only checkbox)
        "staff.get",                     # 5. response assembly (reader)
    ], f"step order drifted: {calls}"


# ─── atomicity: mid-chain failure → NOTHING persists ────────────────────────


async def test_atomicity_user_boom_rolls_back_everything(
    db_session, monkeypatch,
) -> None:
    """The account step explodes AFTER card + section + positions are
    already pending → rollback leaves NO staff/masters/user/link rows."""
    import src.usecases.staff as staff_module
    from src.services.user import get_user_service as real_user_getter

    class _UserBoom:
        def __getattr__(self, name: str) -> Any:
            return getattr(real_user_getter(), name)

        async def create_staff_account(self, *args: Any, **kwargs: Any) -> Any:
            raise StepBoomError("injected: account creation failed")

    monkeypatch.setattr(
        staff_module, "get_user_service", lambda: _UserBoom(),
    )

    await _add_position(db_session, id="master", title="Мастер", is_system=True)
    baseline_staff = len((await db_session.execute(select(Staff))).scalars().all())

    with pytest.raises(StepBoomError):
        await staff_module.create_staff(
            None, db_session=db_session,
            data=_create_payload(
                master={"specialty": "живопись", "color": "#5B8C7A"},
                position_ids=["master"],
                create_user={
                    "phone": f"+7999{_uuid.uuid4().hex[:7]}",
                    "password": "secret12345",
                },
            ),
        )

    await db_session.rollback()
    assert len((await db_session.execute(select(Staff))).scalars().all()) == baseline_staff
    assert (await db_session.execute(select(Master))).scalars().all() == []
    assert (await db_session.execute(select(User))).scalars().all() == []
    assert (await db_session.execute(
        select(staff_positions)
    )).all() == [], "no staff_positions links may survive the failed create"
