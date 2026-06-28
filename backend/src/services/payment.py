"""Business logic for payment CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_generic_repository
from src.models.payment import Payment
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate
from src.services.generic import GenericService


class PaymentService(GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]):
    """Payment service. Strips null for NOT NULL fields (amount) in PATCH."""

    NOT_NULL_FIELDS = {"amount"}


@lru_cache
def get_payment_service() -> PaymentService:
    return PaymentService(get_generic_repository(), Payment, PaymentResponse)
