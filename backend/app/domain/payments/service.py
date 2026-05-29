"""Business logic for payment CRUD operations."""

from functools import lru_cache

from app.db.models.payment import Payment
from app.db.repository import get_repository
from app.domain.base import GenericService
from app.domain.payments.schemas import PaymentCreate, PaymentUpdate


@lru_cache
def get_payment_service() -> GenericService[Payment, PaymentCreate, PaymentUpdate]:
    return GenericService(get_repository(), Payment)
