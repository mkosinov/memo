"""Tests for the PaymentService subclass."""

import pytest

from src.services.generic import GenericService
from src.services.payment import PaymentService


class TestPaymentServiceClass:
    """Verify PaymentService has the correct NOT_NULL_FIELDS configuration."""

    def test_payment_service_is_subclass_of_generic_service(self) -> None:
        """PaymentService must be a subclass of GenericService."""
        assert issubclass(PaymentService, GenericService)

    def test_not_null_fields_contains_amount(self) -> None:
        """NOT_NULL_FIELDS must include 'amount' to prevent null-amount patches."""
        assert "amount" in PaymentService.NOT_NULL_FIELDS

    def test_not_null_fields_is_only_amount(self) -> None:
        """NOT_NULL_FIELDS should only contain 'amount' — nothing else."""
        assert PaymentService.NOT_NULL_FIELDS == {"amount"}
