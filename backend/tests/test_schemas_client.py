"""Tests for client Pydantic schemas — nullable fields, ClientPatch, ClientWithStats."""

import pytest
from pydantic import ValidationError

from src.models.enums import Channel
from src.schemas.client import ClientBase, ClientCreate, ClientPatch, ClientResponse, ClientUpdate, ClientWithStats


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
    """ClientUpdate inherits nullable fields from ClientBase."""

    @pytest.mark.pure_unit
    def test_update_with_all_fields(self):
        """ClientUpdate works with all fields."""
        cu = ClientUpdate(name="Updated", phone="+79990001111", channel=Channel.MAX)
        assert cu.name == "Updated"

    @pytest.mark.pure_unit
    def test_update_with_no_fields(self):
        """ClientUpdate accepts empty payload."""
        cu = ClientUpdate()
        assert cu.name is None
        assert cu.phone is None


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
