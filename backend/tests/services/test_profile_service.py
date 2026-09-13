"""GH #262 Task 1 fix-round — ProfileService service-level regression tests.

Covers two quality-review findings (the third — the staff-delete cascade
over ``user_profiles`` — is covered API-level in
``test_api_staff.py::TestStaffDelete``):

1. **Lazy-create race** — two concurrent ``PUT /my`` both SELECT-miss
   then INSERT; the loser's INSERT hits ``user_profiles.user_id`` UNIQUE.
   The service must recover (apply fields onto the surviving row), not
   raise an unhandled IntegrityError. The race is reproduced
   deterministically by making the service's profile SELECT return a
   stale miss once, with the winner's row already committed.
2. **Deleted-user 401** — ``update``/``get`` for a user id that no longer
   resolves raise ``ProfileOwnerNotFoundError`` (mapped to 401
   ``AUTH_UNAUTHORIZED`` by the router) instead of a runtime ``assert``
   that ``python -O`` strips.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.domain.errors import ProfileOwnerNotFoundError
from src.models.user import User
from src.models.user_profile import UserProfile
from src.schemas.my import MyProfileUpdate
from src.services.profile import ProfileService, get_profile_service

pytestmark = pytest.mark.unit


async def _add_user(db_session) -> User:
    user = User(
        phone=f"+7999{uuid.uuid4().hex[:7]}",
        password_hash="x",
        role="admin",
    )
    db_session.add(user)
    await db_session.flush()
    return user


class TestLazyCreateRace:
    async def test_stale_select_miss_recovers_instead_of_integrity_error(
        self, db_session, monkeypatch
    ) -> None:
        """The race loser: the profile SELECT misses a row a concurrent
        winner already committed, so the lazy INSERT conflicts on
        ``user_id`` UNIQUE. Expected: no IntegrityError — the write lands
        on the surviving row and exactly one row exists per user."""
        service = get_profile_service()
        user = await _add_user(db_session)

        # Winner: first PUT creates the lazy row (committed).
        first = await service.update(
            db_session, user.id, MyProfileUpdate(patronymic="Петровна")
        )
        assert first.patronymic == "Петровна"

        # Reproduce the loser's stale read: the service's profile SELECT
        # misses ONCE (the row is committed and visible — the miss is the
        # race artifact), then delegates to the real SELECT.
        real_select = ProfileService._get_profile
        stale: dict[str, bool] = {"once": True}

        async def _stale_once(self, session, user_id):
            if stale["once"]:
                stale["once"] = False
                return None
            return await real_select(self, session, user_id)

        monkeypatch.setattr(ProfileService, "_get_profile", _stale_once)

        # Loser: SELECT missed → lazy INSERT → UNIQUE conflict → recovery.
        second = await service.update(
            db_session, user.id, MyProfileUpdate(birth_place="Москва")
        )

        assert second.patronymic == "Петровна"  # winner's data kept
        assert second.birth_place == "Москва"  # loser's write applied

        rows = (
            await db_session.execute(select(UserProfile))
        ).scalars().all()
        assert len(rows) == 1  # still exactly one row per user


class TestMissingUser:
    async def test_update_missing_user_raises_domain_error(
        self, db_session
    ) -> None:
        """A user id that resolves to no row raises the domain error the
        router maps to 401 — no assert-stripping under ``python -O``."""
        service = get_profile_service()
        with pytest.raises(ProfileOwnerNotFoundError):
            await service.update(
                db_session,
                f"{uuid.uuid4()}",
                MyProfileUpdate(patronymic="X"),
            )

    async def test_get_missing_user_raises_domain_error(
        self, db_session
    ) -> None:
        service = get_profile_service()
        with pytest.raises(ProfileOwnerNotFoundError):
            await service.get(db_session, f"{uuid.uuid4()}")
