"""#348 Task 3 — passwordless account creation + phone editing (S1/S5).

Creation side (spec §4/§5 docs/specs/2026-09-27-user-accounts-348-design.md,
canon auth.md «User lifecycle»):

* the composite staff-creation account block (``UserService
  .create_staff_account``) creates the row WITHOUT a password —
  ``password_hash`` NULL; the owner sets it later via the one-time
  setup link (#348 Task 2); the GH #319 UserSettings guarantee stays
  with the composing ``create_staff`` scenario (same transaction);
* the phone runs through the SHARED domain validator
  (``src/domain/phones.py::validate_phone`` — 1–20 chars after trim);
* an EXPLICIT duplicate probe (exact string, archived rows included —
  DB unique-constraint parity) raises ``PhoneTakenError`` BEFORE any
  write: the composite path previously surfaced duplicates only through
  the global DB-integrity handler.

Edit side — the ``update_user_phone`` scenario (S5):

* unknown user → ``None`` (route → 404); invalid phone →
  ``PhoneInvalidError``; another account holding the exact string →
  ``PhoneTakenError``;
* same-string no-op: nothing written, NO journal row (audit §5.1);
* success: ONE audit ``update`` row (entity ``users``) whose ``phone``
  pair is MASKED by the canon serializer (§5.1 — last 4 digits);
* sessions are NOT revoked (spec §4: cookie sessions are not tied to
  the phone).

The CLI ``create_user`` scenario keeps its password — the dev surface
is untouched (spec §7; guarded by tests/usecases/test_user_create.py).

Calling convention: selfless ``@transactional`` scenarios — leading
``None`` + keyword arguments (``usecases/user.py`` docstring).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import select

from src.auth.scope import mask_phone
from src.models.user_settings import UserSettings
from tests.conftest import insert_user, query_db

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.user import User

pytestmark = pytest.mark.integration


# ─── helpers ───────────────────────────────────────────────────────────────────

_PHONE_A = "+79990001441"  # the account under edit
_PHONE_B = "+79990001442"  # the new phone


async def _add_staff(db_session: Any, **kwargs: Any) -> Any:
    from src.models.staff import Staff

    kwargs.setdefault("first_name", "А")
    kwargs.setdefault("last_name", "Б")
    staff = Staff(**kwargs)
    db_session.add(staff)
    await db_session.flush()
    return staff


def _audit_rows() -> list[dict]:
    return query_db(
        "SELECT user_id, user_role, action, entity, entity_id, entity_label,"
        " changes FROM audit_logs ORDER BY rowid"
    )


@pytest.fixture
def actor() -> Iterator[dict]:
    """A real users row + the staged audit actor (the §4.1 author slot)."""
    from src.events import audit

    admin = insert_user("+79990007771", "x", role="admin")
    token = audit.set_actor(user_id=admin["id"], role="admin")
    yield admin
    audit.reset_actor(token)


# ─── validate_phone — the shared domain rule (pure) ────────────────────────────


class TestValidatePhone:
    def test_returns_trimmed_phone(self) -> None:
        from src.domain.phones import validate_phone

        assert validate_phone(f"  {_PHONE_A}  ") == _PHONE_A

    def test_exactly_20_chars_passes(self) -> None:
        from src.domain.phones import validate_phone

        phone = "+7" + "9" * 18  # exactly String(20)
        assert len(phone) == 20
        assert validate_phone(phone) == phone

    def test_over_20_chars_after_trim_raises(self) -> None:
        from src.domain.phones import PhoneInvalidError, validate_phone

        phone = "+7" + "9" * 19  # 21 chars — over the String(20) ceiling
        with pytest.raises(PhoneInvalidError):
            validate_phone(f"   {phone}   ")

    def test_blank_after_trim_raises(self) -> None:
        from src.domain.phones import PhoneInvalidError, validate_phone

        with pytest.raises(PhoneInvalidError):
            validate_phone("   ")


# ─── create_staff_account — the passwordless building block ───────────────────


class TestCreateStaffAccountPasswordless:
    async def test_creates_account_without_password(
        self, db_session: AsyncSession
    ) -> None:
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)

        user = await get_user_service().create_staff_account(
            db_session,
            staff_id=staff.id,
            phone=f"  {_PHONE_A}  ",
            role=UserRole.MASTER,
        )

        # #348: the row lands PASSWORDLESS — the owner sets it via the
        # one-time link; the stored phone is the trimmed string.
        assert user.password_hash is None
        assert user.phone == _PHONE_A
        assert user.staff_id == staff.id
        assert user.role == "master"
        assert user.is_active is True

    async def test_duplicate_phone_raises_domain_error(
        self, db_session: AsyncSession
    ) -> None:
        """Explicit probe BEFORE any write — the composite path used to
        rely on the global DB-integrity handler only."""
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        insert_user(_PHONE_B, "x")  # committed by another connection
        staff = await _add_staff(db_session)

        from src.domain.phones import PhoneTakenError

        with pytest.raises(PhoneTakenError):
            await get_user_service().create_staff_account(
                db_session,
                staff_id=staff.id,
                phone=_PHONE_B,
                role=UserRole.ADMIN,
            )

    async def test_invalid_phone_raises(
        self, db_session: AsyncSession
    ) -> None:
        from src.domain.phones import PhoneInvalidError
        from src.models.enums import UserRole
        from src.services.user import get_user_service

        staff = await _add_staff(db_session)

        with pytest.raises(PhoneInvalidError):
            await get_user_service().create_staff_account(
                db_session,
                staff_id=staff.id,
                phone="+7" + "9" * 19,  # 21 chars after trim
                role=UserRole.ADMIN,
            )


class TestCompositeCreatePasswordless:
    async def test_create_staff_account_section_is_passwordless_with_settings(
        self, db_session: AsyncSession
    ) -> None:
        """S1: the composite path (card + account checkbox) lands a
        passwordless account AND keeps the GH #319 UserSettings guarantee
        in the same transaction."""
        from src.models.user import User
        from src.schemas.staff import StaffCreate
        from src.usecases.staff import create_staff

        created = await create_staff(
            None,
            db_session=db_session,
            data=StaffCreate(
                first_name="Ольга",
                last_name="Иванова",
                create_user={"phone": _PHONE_A},
            ),
        )

        user = (
            await db_session.execute(
                select(User).where(User.staff_id == created.id)
            )
        ).scalar_one()
        assert user.password_hash is None
        assert user.phone == _PHONE_A

        settings = (
            await db_session.execute(
                select(UserSettings).where(UserSettings.user_id == user.id)
            )
        ).scalar_one_or_none()
        assert settings is not None, (
            "GH #319 invariant broken: passwordless «Учётка» created the "
            "account without a user_settings row"
        )


# ─── update_user_phone — the phone-edit scenario (S5) ─────────────────────────


class TestUpdateUserPhone:
    async def test_unknown_user_returns_none(
        self, db_session: AsyncSession
    ) -> None:
        from src.usecases.user import update_user_phone

        assert (
            await update_user_phone(
                None, db_session=db_session, user_id="no-such-user",
                phone=_PHONE_B,
            )
            is None
        )

    async def test_updates_phone_and_returns_user(
        self, db_session: AsyncSession
    ) -> None:
        from src.usecases.user import update_user_phone

        user = insert_user(_PHONE_A, "x", role="master")

        updated = await update_user_phone(
            None, db_session=db_session, user_id=user["id"],
            phone=f"  {_PHONE_B}  ",
        )

        assert updated is not None
        assert updated.id == user["id"]
        assert updated.phone == _PHONE_B  # trimmed
        # Only the phone moves — the hash is not the scenario's business.
        assert updated.password_hash == "x"
        assert updated.role == "master"

    async def test_sessions_are_not_revoked(
        self, db_session: AsyncSession
    ) -> None:
        """Spec §4: cookie sessions are not tied to the phone — an edit
        never revokes them (contrast: set_password_by_link, S8)."""
        from src.auth.session import new_session
        from src.usecases.user import update_user_phone

        user = insert_user(_PHONE_A, "x", role="master")
        db_session.add(new_session(user["id"]))
        db_session.add(new_session(user["id"]))
        await db_session.commit()

        await update_user_phone(
            None, db_session=db_session, user_id=user["id"], phone=_PHONE_B,
        )

        rows = query_db(
            f"SELECT COUNT(*) AS c FROM sessions WHERE user_id = '{user['id']}'"
        )
        assert rows[0]["c"] == 2, "phone edit must NOT revoke sessions"

    async def test_duplicate_phone_raises(
        self, db_session: AsyncSession
    ) -> None:
        from src.domain.phones import PhoneTakenError
        from src.usecases.user import update_user_phone

        user = insert_user(_PHONE_A, "x", role="master")
        other = insert_user(_PHONE_B, "x", role="admin")

        with pytest.raises(PhoneTakenError):
            await update_user_phone(
                None, db_session=db_session, user_id=user["id"],
                phone=_PHONE_B,
            )

        # The failed edit left the row untouched.
        stored = query_db(
            f"SELECT phone FROM users WHERE id = '{user['id']}'"
        )
        assert stored[0]["phone"] == _PHONE_A
        assert other["phone"] == _PHONE_B

    async def test_same_phone_is_noop_without_audit(
        self, db_session: AsyncSession
    ) -> None:
        """Same trimmed string → nothing written, no journal row (§5.1)."""
        from src.usecases.user import update_user_phone

        user = insert_user(_PHONE_A, "x", role="master")

        updated = await update_user_phone(
            None, db_session=db_session, user_id=user["id"],
            phone=f"  {_PHONE_A}  ",  # same string, padded
        )

        assert updated is not None
        assert updated.phone == _PHONE_A
        assert _audit_rows() == []

    async def test_invalid_phone_raises(
        self, db_session: AsyncSession
    ) -> None:
        from src.domain.phones import PhoneInvalidError
        from src.usecases.user import update_user_phone

        user = insert_user(_PHONE_A, "x", role="master")

        with pytest.raises(PhoneInvalidError):
            await update_user_phone(
                None, db_session=db_session, user_id=user["id"],
                phone="+7" + "9" * 19,  # 21 chars after trim
            )

        stored = query_db(
            f"SELECT phone FROM users WHERE id = '{user['id']}'"
        )
        assert stored[0]["phone"] == _PHONE_A

    async def test_audit_row_written_with_masked_phone(
        self, db_session: AsyncSession, actor: dict
    ) -> None:
        """§8: the phone change journals ONE ``update`` row; the phone
        pair is masked by the canon serializer (§5.1 — last 4 digits)."""
        from src.usecases.user import update_user_phone

        user = insert_user(_PHONE_A, "x", role="master")
        await update_user_phone(
            None, db_session=db_session, user_id=user["id"], phone=_PHONE_B,
        )

        rows = _audit_rows()
        assert len(rows) == 1, f"exactly one journal row expected, got {rows}"
        row = rows[0]
        assert row["action"] == "update"
        assert row["entity"] == "users"
        assert row["entity_id"] == user["id"]
        assert row["user_id"] == actor["id"], "author = the editing admin"
        assert row["user_role"] == "admin"
        # Masked BOTH ways — the full number never enters the snapshot.
        assert json.loads(row["changes"]) == {
            "phone": [mask_phone(_PHONE_A), mask_phone(_PHONE_B)]
        }
        assert mask_phone(_PHONE_A) != _PHONE_A

    async def test_no_audit_row_without_actor(
        self, db_session: AsyncSession
    ) -> None:
        """§4.1: no staged author → no journal row (the edit stands)."""
        from src.usecases.user import update_user_phone

        user = insert_user(_PHONE_A, "x", role="master")
        await update_user_phone(
            None, db_session=db_session, user_id=user["id"], phone=_PHONE_B,
        )

        assert _audit_rows() == []
        stored = query_db(
            f"SELECT phone FROM users WHERE id = '{user['id']}'"
        )
        assert stored[0]["phone"] == _PHONE_B, "the action itself must run"
