"""CallcheckStore — callcheck storage seam (#593 Task 2, spec §Хранение).

Storage layer only: Task 3's initiate endpoint calls ``save_initiated``
AFTER the provider accepts the check (one caller-owned transaction:
the row upsert + the journal row), Task 4's status endpoint resolves
handles via ``find_by_handle`` (None is the 404) and owns the atomic
pending→consumed transition.

- ``save_initiated`` rotates — one live row per phone, a new initiate
  REPLACES the old (the phone is the PK, "last request wins": the old
  handle_hash disappears with the replaced row, so the old handle is
  dead). The raw one-time handle is generated here, persisted only as
  its pepper-keyed HMAC digest, and returned to the caller for the
  response body — it never crosses any other boundary.
- ``find_by_handle`` purges on touch (the ``otp_codes`` pattern): a
  row past window+margin is hard-deleted and reported missing; the
  margin guards the late-call tail (a check past the window but inside
  the margin is still returned so Task 4 can confirm a late call).

Commit discipline mirrors ``otp_service``: nothing here commits — the
caller-owned session commits on success (``get_db_session``).
Rate gates are NOT here — they are initiate-flow state (Task 3).

Spec: docs/specs/2026-11-11-auth-callcheck-design.md §Хранение
Domain rules: docs/domain-rules/auth.md «Методы авторизации клиента (#593)»
"""

from __future__ import annotations

from datetime import timedelta
from functools import lru_cache
from typing import TYPE_CHECKING

from sqlalchemy import delete as sa_delete
from sqlalchemy import select

from src.auth.callcheck import (
    ATTEMPT_OUTCOME_CREATED,
    AUTH_CALL_STATUS_PENDING,
    AuthCall,
    AuthCallAttempt,
    hash_handle,
    hash_ip,
    new_handle,
)
from src.auth.callcheck_provider import CALLCHECK_WINDOW_SECONDS
from src.util.utc import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

#: The purge margin over the check window. The status flow honours the
#: PROVIDER answer before local expiry and must not cut the window tail
#: (spec §Эндпоинты: a call in the last seconds is still confirmed), so
#: the janitor TTL outlives the window by headroom for debounce (3 s),
#: provider latency and clock skew — purging at the window edge would
#: 404 a confirmable check.
_AUTH_CALL_PURGE_MARGIN = timedelta(seconds=60)

#: Rows past this age are purged on touch (the ``otp_codes`` pattern:
#: no background job; expired rows are deleted when accessed).
#: Window + margin — lives HERE (not in callcheck.py) because that
#: module is a registration-import leaf and cannot import the window
#: constant from callcheck_provider without a cycle.
AUTH_CALL_PURGE_TTL = timedelta(seconds=CALLCHECK_WINDOW_SECONDS) + _AUTH_CALL_PURGE_MARGIN


class CallcheckStore:
    """Persist initiated checks; resolve status handles (§Хранение)."""

    async def save_initiated(
        self,
        db_session: AsyncSession,
        *,
        phone: str,
        provider_check_id: str,
        call_phone: str,
        client_ip: str,
    ) -> str:
        """Replace the phone's row + append the ``created`` journal entry.

        Called only after the provider accepted the check (spec
        §Эндпоинты: one transaction — row upsert, journal row, limits).
        Returns the RAW one-time handle for the initiate response; only
        its digest is persisted.
        """
        handle = new_handle()
        now = utc_now()

        # Replacement semantics (PK — last request wins): the delete
        # kills the previous check AND its handle_hash in this
        # transaction — the old handle answers 404 from now on.
        await db_session.execute(sa_delete(AuthCall).where(AuthCall.phone == phone))
        db_session.add(
            AuthCall(
                phone=phone,
                provider_check_id=provider_check_id,
                call_phone=call_phone,
                handle_hash=hash_handle(handle),
                status=AUTH_CALL_STATUS_PENDING,
                created_at=now,
            )
        )
        db_session.add(
            AuthCallAttempt(
                phone=phone,
                ip_hash=hash_ip(client_ip),
                provider_check_id=provider_check_id,
                outcome=ATTEMPT_OUTCOME_CREATED,
                created_at=now,
            )
        )
        await db_session.flush()
        return handle

    async def find_by_handle(
        self, db_session: AsyncSession, handle: str,
    ) -> AuthCall | None:
        """Resolve a status handle to the live check row; None = 404.

        Purges on touch (the ``otp_codes`` pattern): a row past
        window+margin is hard-deleted — the check is long unanswerable,
        keeping it would only leak dead handles. Rows inside the margin
        are returned even past the window: Task 4 decides expiry AFTER
        the provider answer, and a late call must still confirm.
        """
        row = (
            await db_session.execute(
                select(AuthCall).where(AuthCall.handle_hash == hash_handle(handle))
            )
        ).scalar_one_or_none()

        if row is not None and row.created_at + AUTH_CALL_PURGE_TTL <= utc_now():
            await db_session.execute(
                sa_delete(AuthCall).where(AuthCall.phone == row.phone)
            )
            await db_session.flush()
            return None

        return row


@lru_cache
def get_callcheck_store() -> CallcheckStore:
    """Process-singleton CallcheckStore (the ``get_otp_service`` pattern)."""
    return CallcheckStore()
