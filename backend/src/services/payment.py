"""Business logic for payment CRUD operations."""

from datetime import datetime
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import get_base_repository
from src.models.payment import Payment
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class PaymentService(GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]):
    """Payment service. Strips null for NOT NULL fields (amount) in PATCH.

    Overrides ``create`` to apply an explicit business rule for the optional
    ``created_at`` field: when the client omits it (``None``), the service
    sets it to the current UTC time before delegating to the generic path.
    When the client supplies a value, it is passed through unchanged.
    """

    NOT_NULL_FIELDS = {"amount"}

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
