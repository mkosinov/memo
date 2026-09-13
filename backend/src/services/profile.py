"""Composite «Мои данные» profile service (GH #262 Task 1, spec §4).

One ``@transactional`` ``update`` call writes BOTH halves of the flat
profile in a single transaction:

* the staff-card half (``first_name``/``last_name``/``avatar_url``) —
  applied only while the card exists AND is not archived (``has_staff``;
  otherwise name writes are ignored, D7);
* the private half — the lazily created :class:`UserProfile` row (row
  materializes on the first PUT that carries a private field; omitted
  key = keep, explicit ``null`` = clear).

On commit the decorator publishes the EXISTING ``staff`` SSE entity
(``entity_name = "staff"`` — other tabs' staff tables refresh; no new
SSE entity, no new invalidation family, spec §4/D10). The ``me`` query
is invalidated locally by the calling client.

``role``/``has_staff``/``has_master`` are read-only view fields of the
session user, never written here. ``specialties`` is never written here
(the admin owns the master section, #266 D5).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.domain.errors import ProfileOwnerNotFoundError
from src.models.master import Master
from src.models.staff import Staff
from src.models.user import User
from src.models.user_profile import UserProfile
from src.schemas.my import MyProfileResponse, MyProfileUpdate
from src.services.decorators import transactional

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

#: PUT keys that write the staff card (card-only semantics, D7).
_CARD_FIELDS = ("first_name", "last_name", "avatar_url")

#: PUT keys that write the (lazily created) user_profiles row.
_PROFILE_FIELDS = (
    "patronymic",
    "birth_date",
    "residence_address",
    "birth_place",
    "passport_series_number",
    "passport_issued_date",
    "passport_issued_by",
    "registration_address",
)


def _split_specialties_csv(csv: str) -> list[str]:
    """«живопись, керамика» → ``["живопись", "керамика"]``.

    Whitespace-tolerant; empty segments dropped (no phantom values).
    """
    return [part.strip() for part in csv.split(",") if part.strip()]


def _normalize_series_number(value: str) -> str:
    """Trim + collapse inner whitespace runs (spec §3.1)."""
    return " ".join(value.split())


class ProfileService:
    """Composite staff-card + private-profile service for ``/api/v1/my``."""

    # GH #262 spec §4/D10: the transactional emit reuses the EXISTING
    # ``staff`` entity (the card changed) — deliberately NOT a new
    # ``user_profiles`` entity, so the canonical SSE vocabulary and both
    # drift mirrors stay untouched.
    entity_name: str = "staff"

    async def _context(
        self, db_session: AsyncSession, user_id: str
    ) -> tuple[User, Staff | None, Master | None, UserProfile | None]:
        """Fetch user + linked card + master section + profile row.

        ``staff``/``master`` resolve to ``None`` when absent OR archived —
        for ``/my`` an archived card is ``has_staff=false`` (editing gate;
        the own-name display rule for the user block lives in /auth/me,
        spec §4 Display rule).
        """
        user = await self._get_user(db_session, user_id)

        staff: Staff | None = None
        if user.staff_id is not None:
            staff_row = await db_session.execute(
                select(Staff).where(
                    Staff.id == user.staff_id, Staff.is_active == True  # noqa: E712
                )
            )
            staff = staff_row.scalar_one_or_none()

        master: Master | None = None
        if staff is not None:
            master_row = await db_session.execute(
                select(Master).where(
                    Master.staff_id == staff.id,
                    Master.is_active == True,  # noqa: E712
                )
            )
            master = master_row.scalar_one_or_none()

        profile = await self._get_profile(db_session, user_id)
        return user, staff, master, profile

    async def _get_user(
        self, db_session: AsyncSession, user_id: str
    ) -> User:
        """Resolve the /my owner row.

        A session can outlive its user (row deleted server-side) — raise
        the domain error the router maps to 401 ``AUTH_UNAUTHORIZED``
        (explicit check: a runtime ``assert`` would vanish under
        ``python -O``).
        """
        user = await db_session.get(User, user_id)
        if user is None:
            raise ProfileOwnerNotFoundError(user_id)
        return user

    async def _get_profile(
        self, db_session: AsyncSession, user_id: str
    ) -> UserProfile | None:
        """The lazily created private row, or ``None`` before the first
        meaningful PUT (lazy-create seam — see ``_upsert_profile``)."""
        row = await db_session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        return row.scalar_one_or_none()

    async def _upsert_profile(
        self,
        db_session: AsyncSession,
        user_id: str,
        profile: UserProfile | None,
        profile_payload: dict[str, object],
    ) -> UserProfile:
        """Stage *profile_payload* on the owner's row, creating it lazily
        (the caller's flush detects the lost-insert race).

        The new row is only added to the session here — no flush: the
        single flush in ``_apply_update`` surfaces the UNIQUE violation
        to ``update``'s rollback-retry recovery (see its docstring).
        """
        if profile is None:
            profile = UserProfile(user_id=user_id)
            db_session.add(profile)
        for field, value in profile_payload.items():
            if field == "passport_series_number" and value is not None:
                value = _normalize_series_number(cast("str", value))
            setattr(profile, field, value)
        return profile

    async def get(
        self, db_session: AsyncSession, user_id: str
    ) -> MyProfileResponse:
        """Assemble the flat read model (never writes — no lazy create)."""
        user, staff, master, profile = await self._context(
            db_session, user_id
        )
        return self._to_response(user, staff, master, profile)

    async def _apply_update(
        self, db_session: AsyncSession, user_id: str, payload: dict[str, object]
    ) -> tuple[User, Staff | None, Master | None, UserProfile | None]:
        """Apply the sent payload to both halves; flush (no commit).

        Raises IntegrityError to the caller when the lazy-create INSERT
        loses the concurrent-writer race (``user_profiles.user_id``
        UNIQUE) — ``update`` handles the recovery.
        """
        user, staff, master, profile = await self._context(
            db_session, user_id
        )

        # 1. Card half — only while has_staff; ignored otherwise (D7).
        if staff is not None:
            for field in _CARD_FIELDS:
                if field in payload:
                    setattr(staff, field, payload[field])

        # 2. Private half — lazy row create on first meaningful write.
        profile_payload = {
            field: payload[field] for field in _PROFILE_FIELDS
            if field in payload
        }
        if profile_payload:
            profile = await self._upsert_profile(
                db_session, user_id, profile, profile_payload
            )

        # ``specialties`` is accepted-but-ignored (read-only, #266 D5);
        # role/has_staff/has_master are view fields, never written.
        await db_session.flush()
        return user, staff, master, profile

    @transactional
    async def update(
        self, db_session: AsyncSession, user_id: str, data: MyProfileUpdate
    ) -> MyProfileResponse:
        """Apply the sent subset — card half + private half, ONE commit.

        Lazy-create race (review finding): two concurrent PUT /my can both
        SELECT-miss then INSERT; the loser's flush violates the
        ``user_profiles.user_id`` UNIQUE constraint. Recovery: roll the
        whole transaction back (discarding the doomed INSERT), re-run the
        update — the fresh SELECT now sees the winner's row and the write
        lands on it (field-level last-write-wins, exactly one row per
        user). Everything stays inside this one @transactional method, so
        the commit/emit contract is preserved on both paths.
        """
        payload = data.model_dump(exclude_unset=True)
        try:
            user, staff, master, profile = await self._apply_update(
                db_session, user_id, payload
            )
        except IntegrityError:
            await db_session.rollback()
            user, staff, master, profile = await self._apply_update(
                db_session, user_id, payload
            )

        # Re-read the freshly written halves for the response (the ORM
        # objects are in the identity map — plain attribute reads suffice).
        return self._to_response(user, staff, master, profile)

    def _to_response(
        self,
        user: User,
        staff: Staff | None,
        master: Master | None,
        profile: UserProfile | None,
    ) -> MyProfileResponse:
        """Assemble the flat §4 shape from the four source rows."""
        return MyProfileResponse(
            role=user.role,
            has_staff=staff is not None,
            has_master=master is not None,
            first_name=staff.first_name if staff is not None else None,
            last_name=staff.last_name if staff is not None else None,
            avatar_url=staff.avatar_url if staff is not None else None,
            specialties=(
                _split_specialties_csv(master.specialty)
                if master is not None
                else None
            ),
            patronymic=profile.patronymic if profile is not None else None,
            birth_date=profile.birth_date if profile is not None else None,
            residence_address=(
                profile.residence_address if profile is not None else None
            ),
            birth_place=(
                profile.birth_place if profile is not None else None
            ),
            passport_series_number=(
                profile.passport_series_number
                if profile is not None
                else None
            ),
            passport_issued_date=(
                profile.passport_issued_date
                if profile is not None
                else None
            ),
            passport_issued_by=(
                profile.passport_issued_by if profile is not None else None
            ),
            registration_address=(
                profile.registration_address
                if profile is not None
                else None
            ),
        )


def get_profile_service() -> ProfileService:
    """Factory for ProfileService (dependency-free constructor)."""
    return ProfileService()
