"""Payment persistence — owner repository for the payments table (GH #171 T1).

Canon (docs/domain-rules/service-layer.md, rules 1 and 4): the ONLY home of
tabular commands for payments. Bulk commands filter on the entity's OWN
reference column (``payments.record_id``) and run as ONE set-based
statement — never a Python loop over rows. Called only by PaymentService
methods.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from sqlalchemy import delete

from src.models.payment import Payment
from src.repositories.generic import BaseRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class PaymentRepository(BaseRepository):
    """Repository for payments — hard delete plus bulk-by-record commands."""

    async def delete_by_record_id(self, session: AsyncSession, record_id: str) -> None:
        """Remove ALL payments of one record in a single DELETE statement.

        Set-based bulk command (canon rule 4): one
        ``DELETE FROM payments WHERE record_id = :record_id`` — no
        per-row loop. Does NOT commit — the caller's transaction owns
        the commit boundary.
        """
        await session.execute(delete(Payment).where(Payment.record_id == record_id))

    async def delete_by_record_ids(
        self, session: AsyncSession, record_ids: list[str]
    ) -> None:
        """Remove ALL payments of the given records in a single DELETE.

        Set-based bulk command (canon rule 4, GH #325): one
        ``DELETE FROM payments WHERE record_id IN (:ids)`` — no per-row
        loop. An EMPTY id set is a no-op — no query is issued at all.
        Does NOT commit — the caller's transaction owns the commit
        boundary.
        """
        if not record_ids:
            return
        await session.execute(delete(Payment).where(Payment.record_id.in_(record_ids)))


@lru_cache
def get_payment_repository() -> PaymentRepository:
    """Return a singleton PaymentRepository."""
    return PaymentRepository()
