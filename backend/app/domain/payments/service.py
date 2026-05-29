"""Business logic for payment CRUD operations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.payment import Payment
from app.domain.payments.schemas import PaymentCreate, PaymentUpdate


class PaymentService:
    """Handles payment entity operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[Payment]:
        """Return all active payments."""
        result = await self._session.execute(
            select(Payment).where(Payment.is_active)
        )
        return list(result.scalars().all())

    async def get_by_id(self, payment_id: str) -> Payment | None:
        """Return a payment by ID, or None if not found."""
        result = await self._session.execute(
            select(Payment).where(Payment.id == payment_id)
        )
        return result.scalar_one_or_none()

    async def create(self, data: PaymentCreate) -> Payment:
        """Create a new payment and persist it."""
        payment = Payment(**data.model_dump())
        self._session.add(payment)
        await self._session.flush()
        await self._session.refresh(payment)
        return payment

    async def update(self, payment_id: str, data: PaymentUpdate) -> Payment | None:
        """Full-update a payment by ID. Returns None if not found."""
        payment = await self.get_by_id(payment_id)
        if not payment:
            return None
        for key, value in data.model_dump().items():
            setattr(payment, key, value)
        await self._session.flush()
        await self._session.refresh(payment)
        return payment

    async def delete(self, payment_id: str) -> bool:
        """Soft-delete a payment (set is_active=False). Returns False if not found."""
        payment = await self.get_by_id(payment_id)
        if not payment:
            return False
        payment.is_active = False
        await self._session.flush()
        return True
