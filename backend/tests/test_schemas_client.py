"""Tests for client Pydantic schemas — nullable fields, ClientPatch, ClientWithStats.

Also covers the ``is_active`` → ``archived`` inversion (#207 §3.1, §14) for
``ClientResponse`` and the ``ClientWithStats`` manual builder (second inversion
point in ``services/client.py:list_clients_with_stats``).
"""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from src.models.enums import ArchiveStatus, Channel
from src.schemas.client import (
    ClientBase,
    ClientCreate,
    ClientListParams,
    ClientPatch,
    ClientResponse,
    ClientUpdate,
    ClientWithStats,
)


class TestClientBaseNullableFields:
    """ClientBase should accept nullable name, phone, and channel."""

    @pytest.mark.pure_unit
    def test_client_base_with_all_fields(self):
        """ClientBase works with all fields provided."""
        cb = ClientBase(name="Anna", phone="+79991112233", email="a@b.com", channel=Channel.TELEGRAM)
        assert cb.name == "Anna"
        assert cb.phone == "+79991112233"
        assert cb.email == "a@b.com"
        assert cb.channel == Channel.TELEGRAM

    @pytest.mark.pure_unit
    def test_client_base_name_nullable(self):
        """ClientBase accepts name=None."""
        cb = ClientBase(name=None, phone="+79991112233", channel=Channel.TELEGRAM)
        assert cb.name is None

    @pytest.mark.pure_unit
    def test_client_base_phone_nullable(self):
        """ClientBase accepts phone=None."""
        cb = ClientBase(name="Anna", phone=None, channel=Channel.TELEGRAM)
        assert cb.phone is None

    @pytest.mark.pure_unit
    def test_client_base_channel_nullable(self):
        """ClientBase accepts channel=None."""
        cb = ClientBase(name="Anna", phone="+79991112233", channel=None)
        assert cb.channel is None

    @pytest.mark.pure_unit
    def test_client_base_all_nullable(self):
        """ClientBase accepts all optional fields as None."""
        cb = ClientBase(name=None, phone=None, email=None, channel=None)
        assert cb.name is None
        assert cb.phone is None
        assert cb.email is None
        assert cb.channel is None

    @pytest.mark.pure_unit
    def test_client_base_defaults(self):
        """ClientBase defaults optional fields to None when omitted."""
        cb = ClientBase()
        assert cb.name is None
        assert cb.phone is None
        assert cb.email is None
        assert cb.channel is None


class TestClientCreateNullableFields:
    """ClientCreate inherits nullable fields from ClientBase."""

    @pytest.mark.pure_unit
    def test_create_with_all_fields(self):
        """ClientCreate works with all fields."""
        cc = ClientCreate(name="Bob", phone="+79991112233", channel=Channel.WHATSAPP)
        assert cc.name == "Bob"

    @pytest.mark.pure_unit
    def test_create_with_no_fields(self):
        """ClientCreate accepts empty payload."""
        cc = ClientCreate()
        assert cc.name is None
        assert cc.phone is None


class TestClientUpdateNullableFields:
    """ClientUpdate (GH #201): standalone 5-key required schema — 4
    required-nullable personal fields (explicit null = deliberate clear) +
    required is_active. Omitted key → ValidationError."""

    @pytest.mark.pure_unit
    def test_update_with_all_fields(self):
        """Full 5-key payload is valid."""
        cu = ClientUpdate(
            name="Updated", phone="+79990001111", email="u@example.com",
            channel=Channel.MAX, is_active=True,
        )
        assert cu.name == "Updated"
        assert cu.is_active is True

    @pytest.mark.pure_unit
    def test_update_with_all_nulls_valid(self):
        """Explicit null in all personal fields = deliberate wipe — valid."""
        cu = ClientUpdate(
            name=None, phone=None, email=None, channel=None, is_active=False,
        )
        assert cu.name is None
        assert cu.is_active is False

    @pytest.mark.pure_unit
    @pytest.mark.parametrize("missing", ["name", "phone", "email", "channel", "is_active"])
    def test_update_missing_required_field_raises(self, missing):
        """Omitting any of the 5 required keys → ValidationError."""
        payload = {
            "name": "X", "phone": "+79990001111", "email": None,
            "channel": None, "is_active": True,
        }
        payload.pop(missing)
        with pytest.raises(ValidationError):
            ClientUpdate(**payload)

    @pytest.mark.pure_unit
    def test_update_with_no_fields_raises(self):
        """Empty payload → ValidationError (no more silent full-wipe accept)."""
        with pytest.raises(ValidationError):
            ClientUpdate()


class TestClientPatch:
    """ClientPatch allows partial updates — all fields optional."""

    @pytest.mark.pure_unit
    def test_patch_empty(self):
        """Empty patch is valid (no changes)."""
        p = ClientPatch()
        assert p.name is None
        assert p.phone is None
        assert p.email is None
        assert p.channel is None

    @pytest.mark.pure_unit
    def test_patch_name_only(self):
        """Patch with only name."""
        p = ClientPatch(name="Only Name")
        assert p.name == "Only Name"
        assert p.phone is None
        assert p.channel is None

    @pytest.mark.pure_unit
    def test_patch_phone_only(self):
        """Patch with only phone."""
        p = ClientPatch(phone="+79999999999")
        assert p.phone == "+79999999999"
        assert p.name is None

    @pytest.mark.pure_unit
    def test_patch_channel_only(self):
        """Patch with only channel."""
        p = ClientPatch(channel=Channel.WHATSAPP)
        assert p.channel == Channel.WHATSAPP
        assert p.name is None

    @pytest.mark.pure_unit
    def test_patch_email_only(self):
        """Patch with only email."""
        p = ClientPatch(email="new@example.com")
        assert p.email == "new@example.com"

    @pytest.mark.pure_unit
    def test_patch_all_fields(self):
        """Patch with all fields."""
        p = ClientPatch(
            name="Full",
            phone="+79990000000",
            email="full@test.com",
            channel=Channel.TELEGRAM,
        )
        assert p.name == "Full"
        assert p.phone == "+79990000000"
        assert p.email == "full@test.com"
        assert p.channel == Channel.TELEGRAM


class TestClientWithStats:
    """ClientWithStats extends ClientResponse with aggregated metrics."""

    @pytest.mark.pure_unit
    def test_client_with_stats_fields(self):
        """ClientWithStats has all ClientResponse fields plus stats."""
        cws = ClientWithStats(
            id="test-id",
            name="Stats Client",
            phone="+79991112233",
            email=None,
            channel=Channel.TELEGRAM,
            created_at="2025-01-01T00:00:00",
            updated_at="2025-01-01T00:00:00",
            is_active=True,
            records_count=5,
            last_record="2025-06-01",
            total_paid=15000,
            missed_records=1,
        )
        assert cws.id == "test-id"
        assert cws.name == "Stats Client"
        assert cws.records_count == 5
        assert cws.last_record == "2025-06-01"
        assert cws.total_paid == 15000
        assert cws.missed_records == 1

    @pytest.mark.pure_unit
    def test_client_with_stats_defaults(self):
        """ClientWithStats has sensible defaults for stats fields."""
        cws = ClientWithStats(
            id="test-id",
            name="Defaults",
            phone=None,
            created_at="2025-01-01T00:00:00",
            updated_at="2025-01-01T00:00:00",
            is_active=True,
        )
        assert cws.records_count == 0
        assert cws.last_record is None
        assert cws.total_paid == 0
        assert cws.missed_records == 0

    @pytest.mark.pure_unit
    def test_client_with_stats_nullable_client_fields(self):
        """ClientWithStats inherits nullable fields from ClientBase."""
        cws = ClientWithStats(
            id="test-id",
            name=None,
            phone=None,
            email=None,
            channel=None,
            created_at="2025-01-01T00:00:00",
            updated_at="2025-01-01T00:00:00",
            is_active=True,
        )
        assert cws.name is None
        assert cws.phone is None
        assert cws.channel is None


class TestClientResponseNullableFields:
    """ClientResponse inherits nullable fields from ClientBase."""

    @pytest.mark.pure_unit
    def test_response_with_nullable_fields(self):
        """ClientResponse works with nullable name/phone/channel."""
        cr = ClientResponse(
            id="resp-id",
            name=None,
            phone=None,
            email=None,
            channel=None,
            created_at="2025-01-01T00:00:00",
            updated_at="2025-01-01T00:00:00",
            is_active=True,
        )
        assert cr.name is None
        assert cr.phone is None
        assert cr.channel is None


# ─── #207 is_active → archived inversion (§3.1, §14) ──────────────────────────


def _client_kwargs(**overrides) -> dict:
    base = dict(
        id="client-x",
        name="Anna",
        phone="+79991112233",
        email=None,
        channel="telegram",
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
        updated_at=datetime(2025, 1, 1, tzinfo=UTC),
        is_active=True,
    )
    base.update(overrides)
    return base


def _client_orm(**overrides) -> SimpleNamespace:
    return SimpleNamespace(**_client_kwargs(**overrides))


class TestClientResponseArchivedInversion:
    """ClientResponse must expose ``archived`` (inverted) and hide ``is_active``."""

    @pytest.mark.pure_unit
    def test_active_client_serializes_archived_false(self) -> None:
        resp = ClientResponse(**_client_kwargs(is_active=True))
        dump = resp.model_dump()
        assert "archived" in dump
        assert dump["archived"] is False
        assert "is_active" not in dump

    @pytest.mark.pure_unit
    def test_archived_client_serializes_archived_true(self) -> None:
        resp = ClientResponse(**_client_kwargs(is_active=False))
        dump = resp.model_dump()
        assert dump["archived"] is True
        assert "is_active" not in dump

    @pytest.mark.pure_unit
    def test_archived_inverted_from_is_active_both_polarities(self) -> None:
        for is_active in (True, False):
            resp = ClientResponse(**_client_kwargs(is_active=is_active))
            assert resp.archived is (not is_active)

    @pytest.mark.pure_unit
    def test_json_dump_excludes_is_active(self) -> None:
        resp = ClientResponse(**_client_kwargs(is_active=True))
        json_str = resp.model_dump_json()
        assert '"archived"' in json_str
        assert '"is_active"' not in json_str

    @pytest.mark.pure_unit
    def test_from_attributes_parses_is_active_derives_archived(self) -> None:
        orm = _client_orm(is_active=False)
        resp = ClientResponse.model_validate(orm)
        assert resp.is_active is False
        assert resp.archived is True
        dump = resp.model_dump()
        assert dump["archived"] is True
        assert "is_active" not in dump


class TestClientWithStatsArchivedInversion:
    """ClientWithStats inherits the inversion from ClientResponse.

    Builder at ``services/client.py:list_clients_with_stats`` keeps passing
    ``is_active=row.is_active`` (constructor kwarg on the excluded field); the
    computed ``archived`` derives from it.
    """

    @pytest.mark.pure_unit
    def test_active_with_stats_serializes_archived_false(self) -> None:
        cws = ClientWithStats(**_client_kwargs(is_active=True), records_count=3)
        dump = cws.model_dump()
        assert dump["archived"] is False
        assert "is_active" not in dump

    @pytest.mark.pure_unit
    def test_archived_with_stats_serializes_archived_true(self) -> None:
        cws = ClientWithStats(**_client_kwargs(is_active=False), records_count=1)
        dump = cws.model_dump()
        assert dump["archived"] is True
        assert "is_active" not in dump

    @pytest.mark.pure_unit
    def test_with_stats_archived_inverted_both_polarities(self) -> None:
        for is_active in (True, False):
            cws = ClientWithStats(**_client_kwargs(is_active=is_active))
            assert cws.archived is (not is_active)

    @pytest.mark.pure_unit
    def test_with_stats_json_dump_excludes_is_active(self) -> None:
        cws = ClientWithStats(**_client_kwargs(is_active=True))
        json_str = cws.model_dump_json()
        assert '"archived"' in json_str
        assert '"is_active"' not in json_str


class TestClientWithStatsBuilderInversion:
    """The manual ``list_clients_with_stats`` builder inverts correctly (#207 §3.1
    second inversion point).

    Exercises the real builder via ``db_session`` (one active + one archived
    client, seeded directly as ORM rows — no dependency on PUT/PATCH archive flow)
    and asserts each resulting ``ClientWithStats`` serializes ``archived``
    inverted and omits ``is_active``.
    """

    @pytest.mark.asyncio
    async def test_builder_inverts_active_and_archived_clients(
        self, db_session
    ) -> None:
        from src.models.client import Client
        from src.services.client import list_clients_with_stats

        active = Client(name="Active One", phone="+79990000001", channel="telegram")
        archived = Client(
            name="Archived One",
            phone="+79990000002",
            channel="telegram",
            is_active=False,
        )
        db_session.add(active)
        db_session.add(archived)
        await db_session.flush()
        active_id, archived_id = active.id, archived.id

        result = await list_clients_with_stats(
            db_session,
            ClientListParams(status=ArchiveStatus.ALL, per_page=100),
        )
        by_id = {item.id: item for item in result.items}
        assert active_id in by_id, "active client missing from builder result"
        assert archived_id in by_id, "archived client missing from builder result"

        active_item = by_id[active_id]
        archived_item = by_id[archived_id]

        # Active: archived=False, is_active NOT serialized
        assert active_item.archived is False
        active_dump = active_item.model_dump()
        assert active_dump["archived"] is False
        assert "is_active" not in active_dump

        # Archived: archived=True, is_active NOT serialized
        assert archived_item.archived is True
        archived_dump = archived_item.model_dump()
        assert archived_dump["archived"] is True
        assert "is_active" not in archived_dump
