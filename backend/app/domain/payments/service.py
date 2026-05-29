"""Business logic for payment CRUD operations."""

from functools import lru_cache

from app.db.models.payment import Payment
from app.db.repository import get_repository
from src.services.generic import GenericService
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate


@lru_cache
def get_payment_service() -> GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]:
    return GenericService(get_repository(), Payment, PaymentResponse)
