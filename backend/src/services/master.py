"""Business logic for master CRUD operations."""

from functools import lru_cache

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from src.events.emitter import mark_changed
from src.models.master import Master
from src.models.user import User
from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate
from src.services.decorators import transactional
from src.services.generic import ArchiveService


class MasterService(ArchiveService[MasterCreate, MasterUpdate, MasterResponse]):
    """Master service with NOT NULL field protection on PATCH.

    Master-only cascade (spec §4.2, Change 3): ``archive`` and ``restore``
    OVERRIDE the generic ``ArchiveService`` methods to additionally write the
    linked ``users.is_active`` (where ``users.master_id == master.id``) in the
    SAME transaction as the master's ``is_active`` patch. A Master is a staff
    profile, the linked User is its login account — archiving a master without
    disabling the account leaves an orphan login; restoring reactivates both.

    Implementation note (approach (a), per Task 11 plan): the overrides do
    NOT call ``super().archive()``/``super().restore()`` — that would mean TWO
    ``@transactional`` commits (master first via super, then user via this
    method's own ``@transactional``) and break the atomicity requirement
    (spec §4.2: "ONE transaction"). Instead, the master ``repo.patch`` AND the
    user-cascade ``UPDATE`` are inlined in ONE ``@transactional`` method so the
    decorator commits them together (or rolls back together on error). The
    other 4 entities (Location/Service/Material/Client) do NOT cascade — they
    inherit the generic ``ArchiveService.archive/restore`` unchanged.
    """

    NOT_NULL_FIELDS = {"first_name", "last_name", "color", "position", "specialty", "sort_order"}

    # GH #212 search matrix (spec §5.2): substring on first_name/last_name
    # (each field ilike'd separately — no cross-field concatenation, spec
    # §5.2 note), exact id equality when q parses as a full UUID
    # (deep-link prerequisite #216).
    search_fields = [
        SearchField(Master.first_name),
        SearchField(Master.last_name),
        SearchField(Master.id, kind="uuid"),
    ]

    @transactional
    async def archive(self, db_session: AsyncSession, id: str) -> bool:
        """Archive the master AND cascade-write the linked user's is_active=False.

        Returns ``True`` if the master row was archived, ``False`` if not found.
        The linked user (if any) is unconditionally set to ``is_active=False``
        after the master patch succeeds — atomic via the single outer
        ``@transactional`` boundary (spec §4.2: ONE transaction). When no user
        is linked (master has no login account), the ``UPDATE`` matches zero
        rows and is a no-op.
        """
        orm = await self._repository.patch(
            db_session, self._model, id, {"is_active": False}
        )
        if orm is None:
            return False
        # Master→User cascade (spec §4.2): linked login account is disabled
        # in the SAME transaction as the master's is_active flip.
        await db_session.execute(
            update(User).where(User.master_id == id).values(is_active=False)
        )
        # GH #239 §3.3: users.is_active was rewritten by this cascade
        mark_changed("users")
        return True

    @transactional
    async def restore(self, db_session: AsyncSession, id: str) -> bool:
        """Restore the master AND cascade-write the linked user's is_active=True.

        Returns ``True`` if the master row was restored, ``False`` if not found.
        Mirrors :meth:`archive` with the opposite polarity.
        """
        orm = await self._repository.patch(
            db_session, self._model, id, {"is_active": True}
        )
        if orm is None:
            return False
        # Master→User cascade (spec §4.2): linked login account is re-enabled
        # in the SAME transaction as the master's is_active flip.
        await db_session.execute(
            update(User).where(User.master_id == id).values(is_active=True)
        )
        # GH #239 §3.3: users.is_active was rewritten by this cascade
        mark_changed("users")
        return True


@lru_cache
def get_master_service() -> MasterService:
    return MasterService(get_archive_repository(), Master, MasterResponse)
