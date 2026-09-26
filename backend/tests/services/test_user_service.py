"""Unit tests for UserService — the ``users`` writing owner (GH #326 Task 1).

Covers the three scenario building blocks (canon rules 1/3 — no
``@transactional``: flush only, ``mark_changed`` by fact) and the pure
role resolver ``resolve_account_role`` (the computation moved out of
``StaffService``; ``staff.py`` keeps its working copy until the Task 3
demolition):

* ``create_staff_account`` — password validated + hashed INSIDE the
  operation, only the hash stored, unconditional ``mark_changed("users")``;
* ``set_role_by_staff`` / ``deactivate_active_by_staff`` — rowcount
  semantics (deactivate touches ONLY active accounts); the mark fires
  only on a real change (rowcount > 0);
* no method commits — a rollback after the call restores prior state.
"""

from __future__ import annotations

import uuid as _uuid
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import select

from src.auth.passwords import PasswordPolicyError, verify_password
from src.models.staff import Staff
from src.models.user import User

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


# ─── helpers ────────────────────────────────────────────────────────────────


async def _add_staff(db_session: Any, **kwargs: Any) -> Staff:
    kwargs.setdefault("first_name", "А")
    kwargs.setdefault("last_name", "Б")
    staff = Staff(**kwargs)
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _add_user(db_session: Any, staff_id: str, **kwargs: Any) -> User:
    defaults: dict[str, Any] = {
        "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "password_hash": "x",
        "role": "admin",
    }
    defaults.update(kwargs)
    user = User(staff_id=staff_id, **defaults)
    db_session.add(user)
    await db_session.flush()
    return user


# ─── resolve_account_role — pure function, every branch ─────────────────────


@pytest.mark.pure_unit
class TestResolveAccountRole:
    """GH #263 D10 role selection: explicit → position template → fallback."""

    def test_explicit_role_beats_template_and_fallback(self) -> None:
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert (
            resolve_account_role(UserRole.ADMIN, ["master"], False)
            is UserRole.ADMIN
        )
        assert (
            resolve_account_role(UserRole.MASTER, ["admin"], True)
            is UserRole.MASTER
        )

    def test_template_master_position(self) -> None:
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert resolve_account_role(None, ["master"], False) is UserRole.MASTER

    def test_template_admin_position(self) -> None:
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert resolve_account_role(None, ["admin"], False) is UserRole.ADMIN

    def test_template_senior_wins_admin_over_master(self) -> None:
        """Several anchored positions → the SENIOR one wins (admin > master)."""
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert (
            resolve_account_role(None, ["master", "admin"], False)
            is UserRole.ADMIN
        )
        assert (
            resolve_account_role(None, ["admin", "master"], False)
            is UserRole.ADMIN
        )

    def test_template_ignores_duplicates_and_non_anchored_ids(self) -> None:
        """Custom (СММ) positions never influence the role; repeated ids are
        set-semantics noise."""
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert (
            resolve_account_role(None, ["master", "master", "smm-1"], True)
            is UserRole.MASTER
        )

    def test_fallback_master_section_present(self) -> None:
        """No anchored position + master section → legacy #247 fallback:
        master."""
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert resolve_account_role(None, ["smm-1"], True) is UserRole.MASTER

    def test_fallback_no_section_no_anchors(self) -> None:
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert resolve_account_role(None, ["smm-1"], False) is UserRole.ADMIN

    def test_fallback_empty_positions(self) -> None:
        from src.models.enums import UserRole
        from src.services.user import resolve_account_role

        assert resolve_account_role(None, [], True) is UserRole.MASTER
        assert resolve_account_role(None, [], False) is UserRole.ADMIN


# ─── canon shape: standalone owner, scenario building blocks ────────────────


@pytest.mark.pure_unit
def test_entity_name_is_users() -> None:
    from src.services.user import UserService

    assert UserService.entity_name == "users"


@pytest.mark.pure_unit
def test_factory_returns_singleton() -> None:
    from src.services.user import UserService, get_user_service

    service = get_user_service()
    assert isinstance(service, UserService)
    assert get_user_service() is service


@pytest.mark.pure_unit
def test_no_method_is_transactional() -> None:
    """Scenario building blocks — none may commit (canon rule 3)."""
    from src.services.decorators import _TRANSACTIONAL_MARKER
    from src.services.user import UserService

    for name in (
        "create_staff_account",
        "set_role_by_staff",
        "deactivate_active_by_staff",
    ):
        assert not hasattr(getattr(UserService, name), _TRANSACTIONAL_MARKER), (
            f"{name} is a scenario building block — it must NOT commit; "
            "the usecases layer owns the transaction boundary"
        )


# ─── create_staff_account ────────────────────────────────────────────────────


class TestCreateStaffAccount:
    async def test_creates_linked_account_with_hash(self, db_session: AsyncSession) -> None:
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)

        user = await get_user_service().create_staff_account(
            db_session,
            staff_id=staff.id,
            phone="+79995550001",
            password="secret12345",
            role=UserRole.MASTER,
        )

        assert user.staff_id == staff.id
        assert user.phone == "+79995550001"
        assert user.role == "master"
        assert user.is_active is True
        # Only the HASH is stored — the plaintext never lands on the row.
        assert user.password_hash != "secret12345"
        assert verify_password("secret12345", user.password_hash)
        # Row is persisted (flushed) inside the caller's transaction.
        row = (
            await db_session.execute(
                select(User).where(User.staff_id == staff.id)
            )
        ).scalar_one()
        assert row.phone == "+79995550001"

    async def test_short_password_raises_policy_error(self, db_session: AsyncSession) -> None:
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)

        with pytest.raises(PasswordPolicyError):
            await get_user_service().create_staff_account(
                db_session,
                staff_id=staff.id,
                phone="+79995550002",
                password="short",
                role=UserRole.ADMIN,
            )

    async def test_marks_users(self, db_session: AsyncSession) -> None:
        """A created row is a fact — the mark is unconditional."""
        from src.events import emitter
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)
        token = emitter.start_accumulation(set())
        try:
            await get_user_service().create_staff_account(
                db_session,
                staff_id=staff.id,
                phone="+79995550003",
                password="secret12345",
                role=UserRole.ADMIN,
            )
            assert emitter.accumulated() == {"users"}
        finally:
            emitter.reset_accumulation(token)

    async def test_does_not_commit(self, db_session: AsyncSession) -> None:
        from src.models.enums import UserRole
        from src.services.user import get_user_service
        from tests.conftest import query_db

        staff = await _add_staff(db_session)
        await db_session.commit()  # persist the fixture — rollback below must
        staff_id = staff.id       # only undo the service call

        await get_user_service().create_staff_account(
            db_session,
            staff_id=staff_id,
            phone="+79995550004",
            password="secret12345",
            role=UserRole.ADMIN,
        )
        await db_session.rollback()

        assert query_db(
            f"SELECT COUNT(*) AS c FROM users WHERE staff_id='{staff_id}'"
        )[0]["c"] == 0, (
            "create_staff_account must NOT commit — the scenario layer "
            "owns the transaction boundary (canon rule 3)"
        )


# ─── set_role_by_staff — rowcount semantics ─────────────────────────────────


class TestSetRoleByStaff:
    async def test_returns_rowcount_and_marks_on_change(self, db_session: AsyncSession) -> None:
        from src.events import emitter
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)
        await _add_user(db_session, staff.id, role="master")

        token = emitter.start_accumulation(set())
        try:
            rowcount = await get_user_service().set_role_by_staff(
                db_session, staff.id, UserRole.ADMIN
            )
            assert rowcount == 1
            assert emitter.accumulated() == {"users"}
        finally:
            emitter.reset_accumulation(token)

        role = (
            await db_session.execute(
                select(User.role).where(User.staff_id == staff.id)
            )
        ).scalar_one()
        assert role == "admin"

    async def test_missing_account_rowcount_zero_no_mark(
        self, db_session: AsyncSession
    ) -> None:
        """No linked account → nothing to template; no spurious mark."""
        from src.events import emitter
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)

        token = emitter.start_accumulation(set())
        try:
            rowcount = await get_user_service().set_role_by_staff(
                db_session, staff.id, UserRole.ADMIN
            )
            assert rowcount == 0
            assert emitter.accumulated() == set()
        finally:
            emitter.reset_accumulation(token)

    async def test_applies_to_inactive_account_too(self, db_session: AsyncSession) -> None:
        """Role templating (unlike the D6 deactivation checkbox) writes by
        card, not by active-flag — same semantics as the pre-refactor
        ``_apply_role_template``."""
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)
        await _add_user(db_session, staff.id, role="master", is_active=False)

        rowcount = await get_user_service().set_role_by_staff(
            db_session, staff.id, UserRole.ADMIN
        )

        assert rowcount == 1
        role = (
            await db_session.execute(
                select(User.role).where(User.staff_id == staff.id)
            )
        ).scalar_one()
        assert role == "admin"


# ─── deactivate_active_by_staff — rowcount ONLY over active rows ────────────


class TestDeactivateActiveByStaff:
    async def test_deactivates_active_account_and_marks(
        self, db_session: AsyncSession
    ) -> None:
        from src.events import emitter
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)
        await _add_user(db_session, staff.id)

        token = emitter.start_accumulation(set())
        try:
            rowcount = await get_user_service().deactivate_active_by_staff(
                db_session, staff.id
            )
            assert rowcount == 1
            assert emitter.accumulated() == {"users"}
        finally:
            emitter.reset_accumulation(token)

        is_active = (
            await db_session.execute(
                select(User.is_active).where(User.staff_id == staff.id)
            )
        ).scalar_one()
        assert is_active is False

    async def test_already_inactive_rowcount_zero_no_mark(
        self, db_session: AsyncSession
    ) -> None:
        """The D6 checkbox applies ONLY to existing ACTIVE links — an
        already-archived account is untouched (never silently restored)."""
        from src.events import emitter
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)
        await _add_user(db_session, staff.id, is_active=False)

        token = emitter.start_accumulation(set())
        try:
            rowcount = await get_user_service().deactivate_active_by_staff(
                db_session, staff.id
            )
            assert rowcount == 0
            assert emitter.accumulated() == set()
        finally:
            emitter.reset_accumulation(token)

        is_active = (
            await db_session.execute(
                select(User.is_active).where(User.staff_id == staff.id)
            )
        ).scalar_one()
        assert is_active is False  # untouched

    async def test_missing_account_rowcount_zero(self, db_session: AsyncSession) -> None:
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)

        rowcount = await get_user_service().deactivate_active_by_staff(
            db_session, staff.id
        )

        assert rowcount == 0

    async def test_does_not_commit(self, db_session: AsyncSession) -> None:
        from src.services.user import get_user_service
        from tests.conftest import query_db

        staff = await _add_staff(db_session)
        await _add_user(db_session, staff.id)
        await db_session.commit()  # persist setup — rollback below must only
        staff_id = staff.id       # undo the deactivation, not the fixture

        await get_user_service().deactivate_active_by_staff(db_session, staff_id)
        await db_session.rollback()

        assert query_db(
            f"SELECT is_active FROM users WHERE staff_id='{staff_id}'"
        )[0]["is_active"] == 1, (
            "deactivate_active_by_staff must NOT commit — the scenario "
            "layer owns the transaction boundary (canon rule 3)"
        )
