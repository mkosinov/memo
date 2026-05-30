"""Business logic for payment CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_generic_repository
from src.models.payment import Payment
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate
from src.services.generic import GenericService


@lru_cache
def get_payment_service() -> GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]:
    return GenericService(get_generic_repository(), Payment, PaymentResponse)
