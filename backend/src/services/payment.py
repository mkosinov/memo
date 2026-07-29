"""Business logic for payment CRUD operations."""

from datetime import datetime
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import get_base_repository
from src.models.payment import Payment
from src.schemas.common import PaginatedResponse
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class PaymentService(GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]):
    """Payment service. Strips null for NOT NULL fields (amount) in PATCH.

    Overrides ``create`` to apply an explicit business rule for the optional
    ``created_at`` field: when the client omits it (``None``), the service
    sets it to the current UTC time before delegating to the generic path.
    When the client supplies a value, it is passed through unchanged.

    Overrides ``list`` because Payment has no ``is_active`` column (hard-delete).
    """

    NOT_NULL_FIELDS = {"amount"}

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        **filters,
    ) -> PaginatedResponse[PaymentResponse]:
        """Return a paginated page of payments (no is_active filter)."""
        stmt = select(Payment)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Payment, key) == value)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [self._response_schema.model_validate(o) for o in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    @transactional
    async def create(
        self, db_session: AsyncSession, data: PaymentCreate
    ) -> PaymentResponse:
        """Create a payment with an explicit ``created_at`` default rule.

        Business rule: if the client does not supply ``created_at``, the
        service sets it to ``datetime.utcnow()`` (matching the ORM column
        default on ``AbstractModel``).  After this decision, ``created_at``
        is always present on *data*, so the generic create path handles
        persistence without any special-casing.
        """
        if data.created_at is None:
            data = data.model_copy(update={"created_at": datetime.utcnow()})
        return await super().create(db_session, data)


@lru_cache
def get_payment_service() -> PaymentService:
    return PaymentService(get_base_repository(), Payment, PaymentResponse)
