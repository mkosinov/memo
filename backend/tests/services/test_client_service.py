"""Unit tests for ClientService.get_or_create_by_phone (GH #171 Task 2).

The «find or create client by phone» helper moves BEHAVIOR-FOR-BEHAVIOR from
``RecordService._resolve_client_by_phone`` (record.py:588-607) to the owner
service (canon docs/domain-rules/service-layer.md rule 3: non-transactional
service methods for scenarios). Contract preserved exactly:

- lookup by exact ``phone`` equality — found → return the existing row,
  NO insert, NO cache mark;
- not found → create with the caller-supplied display name (``None`` →
  "Гость" — the legacy empty-visit-name default) and the default channel
  "whatsapp", flush so ``id`` is populated, and mark ONLY "clients";
- value-typed parameters (``phone: str, name: str | None``) — no foreign
  ORM/schema objects;
- NO ``@transactional`` — the method must not commit (the scenario owns
  the transaction boundary): a rollback after the call undoes a creation.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.client import Client
from src.services.client import ClientService, get_client_service
from src.services.decorators import _TRANSACTIONAL_MARKER

pytestmark = pytest.mark.asyncio


async def test_get_or_create_by_phone_is_not_transactional():
    """The scenario-helper must NOT be wrapped by @transactional."""
    assert not hasattr(ClientService.get_or_create_by_phone, _TRANSACTIONAL_MARKER), (
        "get_or_create_by_phone is a scenario building block — it must NOT "
        "commit; the usecases layer owns the transaction boundary"
    )


async def test_get_or_create_by_phone_finds_existing_client(db_session):
    """Exact-phone hit returns the existing row — no second client created."""
    existing = Client(name="Анна", phone="+79991112233", channel="telegram")
    db_session.add(existing)
    await db_session.commit()

    service = get_client_service()
    client = await service.get_or_create_by_phone(db_session, "+79991112233")

    assert client.id == existing.id
    assert client.channel == "telegram"  # untouched — no defaults applied on hit
    rows = (await db_session.execute(select(Client))).scalars().all()
    assert len(rows) == 1


async def test_get_or_create_by_phone_creates_with_default_name_and_channel(db_session):
    """Miss → new client: "Гость" name fallback + "whatsapp" default channel."""
    service = get_client_service()
    client = await service.get_or_create_by_phone(db_session, "+79995556677")

    assert client.id is not None  # flushed — id assigned
    assert client.phone == "+79995556677"
    assert client.name == "Гость"
    assert client.channel == "whatsapp"
    rows = (await db_session.execute(select(Client))).scalars().all()
    assert len(rows) == 1


async def test_get_or_create_by_phone_creates_with_caller_name(db_session):
    """Miss with an explicit name → that name is used, channel default stays."""
    service = get_client_service()
    client = await service.get_or_create_by_phone(
        db_session, "+79995556688", name="Борис"
    )

    assert client.name == "Борис"
    assert client.channel == "whatsapp"


async def test_get_or_create_by_phone_does_not_commit(db_session):
    """No-commit property: rollback after a creation undoes it (mock-free)."""
    from tests.conftest import query_db

    service = get_client_service()
    client = await service.get_or_create_by_phone(db_session, "+79995556699")
    await db_session.rollback()

    assert query_db(
        f"SELECT COUNT(*) AS c FROM clients WHERE id='{client.id}'"
    )[0]["c"] == 0, (
        "get_or_create_by_phone must NOT commit — the scenario layer owns "
        "the transaction boundary (canon rule 3)"
    )
