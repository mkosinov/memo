"""Tests for the PaymentService subclass."""

import pytest

from src.services.decorators import _TRANSACTIONAL_MARKER
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
        assert {"amount"} == PaymentService.NOT_NULL_FIELDS


# ── GH #171 Task 2 — delete_by_record (scenario building block) ─────────────


@pytest.mark.asyncio
async def test_delete_by_record_is_not_transactional():
    """The scenario-helper must NOT be wrapped by @transactional."""
    assert not hasattr(PaymentService.delete_by_record, _TRANSACTIONAL_MARKER), (
        "delete_by_record is a scenario building block — it must NOT commit; "
        "the usecases layer owns the transaction boundary"
    )


@pytest.mark.asyncio
async def test_delete_by_record_removes_all_payments_of_record(
    db_session, api_client, create_record
):
    """ONE set-based delete: every payment of the record is gone, others stay."""
    from sqlalchemy import select

    from src.models.payment import Payment

    record = create_record()
    other_record = create_record()
    for amount in (1000, 2000):
        resp = api_client.post("/api/v1/payments", json={
            "record_id": record["id"], "amount": amount, "method": "cash",
        })
        assert resp.status_code == 201, resp.text
    resp = api_client.post("/api/v1/payments", json={
        "record_id": other_record["id"], "amount": 3000, "method": "card",
    })
    assert resp.status_code == 201, resp.text

    from src.services.payment import get_payment_service
    service = get_payment_service()
    await service.delete_by_record(db_session, record["id"])

    rows = (await db_session.execute(
        select(Payment).where(Payment.record_id == record["id"])
    )).scalars().all()
    assert rows == []
    kept = (await db_session.execute(
        select(Payment).where(Payment.record_id == other_record["id"])
    )).scalars().all()
    assert len(kept) == 1  # чужой record's payments untouched


@pytest.mark.asyncio
async def test_delete_by_record_no_record_is_noop(db_session):
    """Deleting payments of a record without payments removes nothing, no raise."""
    from sqlalchemy import func, select

    from src.models.payment import Payment
    from src.services.payment import get_payment_service
    service = get_payment_service()
    await service.delete_by_record(db_session, "no-such-record")

    total = (await db_session.execute(select(func.count()).select_from(Payment))).scalar_one()
    assert total == 0


@pytest.mark.asyncio
async def test_delete_by_record_does_not_commit(db_session, api_client, create_record):
    """No-commit property: rollback after the bulk delete restores payments."""
    from tests.conftest import query_db

    record = create_record()
    resp = api_client.post("/api/v1/payments", json={
        "record_id": record["id"], "amount": 500, "method": "cash",
    })
    assert resp.status_code == 201, resp.text

    from src.services.payment import get_payment_service
    service = get_payment_service()
    await service.delete_by_record(db_session, record["id"])
    await db_session.rollback()

    assert query_db(
        f"SELECT COUNT(*) AS c FROM payments WHERE record_id='{record['id']}'"
    )[0]["c"] == 1, (
        "delete_by_record must NOT commit — the scenario layer owns the "
        "transaction boundary (canon rule 3)"
    )
