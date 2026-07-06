"""Business logic for payment CRUD operations."""

from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.generic import get_generic_repository
from src.models.payment import Payment
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate
from src.services.generic import GenericService


class PaymentService(GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]):
    """Payment service. Strips null for NOT NULL fields (amount) in PATCH.

    Overrides ``create`` to handle the optional ``created_at`` field:
    when the client omits it (``None``), the field is excluded from the
    ORM constructor so the DB default (``datetime.utcnow``) fires.
    When the client supplies a value, it is passed through normally.
    """

    NOT_NULL_FIELDS = {"amount"}

    async def create(
        self, db_session: AsyncSession, data: PaymentCreate
    ) -> PaymentResponse:
        """Create a payment, respecting optional client-supplied ``created_at``.

        Approach: when ``created_at`` is ``None``, exclude it from the model
        dump so SQLAlchemy's column default fires.  This override is narrow
        to PaymentService and does not affect the generic create path used
        by other entities.
        """
        if data.created_at is None:
            # Exclude created_at so the DB default (datetime.utcnow) applies
            dump = data.model_dump(exclude={"created_at"})
            instance = self._model(**dump)
            db_session.add(instance)
            await db_session.flush()
            await db_session.refresh(instance)
            return self._response_schema.model_validate(instance)
        # created_at provided — let it flow through the generic path
        return await super().create(db_session, data)


@lru_cache
def get_payment_service() -> PaymentService:
    return PaymentService(get_generic_repository(), Payment, PaymentResponse)
