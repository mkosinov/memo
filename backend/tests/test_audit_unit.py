"""Unit tests: the audit accumulator — actor contextvar, mark/serialize/mask, ownership token.

Pure unit tests (no DB): every function of ``src.events.audit`` except the
``@transactional`` insertion, which lives in the integration test module
(``test_audit_log_transactional.py``).
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from src.events import audit


@pytest.fixture
def actor_ctx():
    """Open an actor contextvar; return the reset function."""
    token = audit.set_actor(user_id="u-1", role="admin")
    yield
    audit.reset_actor(token)


@pytest.fixture
def audit_ctx():
    """Open a fresh accumulator owned by the test; return the reset function."""
    token = audit.open_audit()
    yield
    audit.reset_audit(token)


class TestActorContextvar:
    def test_actor_none_by_default(self) -> None:
        assert audit.current_actor() is None

    def test_set_and_reset(self) -> None:
        token = audit.set_actor(user_id="u-1", role="master")
        assert audit.current_actor() == audit.AuditActor(user_id="u-1", role="master")
        audit.reset_actor(token)
        assert audit.current_actor() is None


class TestMarkAudit:
    def test_mark_outside_accumulator_is_noop(self) -> None:
        """mark_audit with no open accumulator — silent no-op (debug log)."""
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="Иванов Иван", changes={"name": ["a", "b"]})
        assert audit.pending_rows() is None

    def test_mark_opens_pending_rows(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="Иванов Иван", changes={"name": ["a", "b"]})
        rows = audit.pending_rows()
        assert rows is not None and len(rows) == 1
        assert rows[0]["entity"] == "clients"
        assert rows[0]["action"] == "update"
        assert rows[0]["entity_id"] == "c-1"
        assert rows[0]["entity_label"] == "Иванов Иван"
        assert rows[0]["changes"] == {"name": ["a", "b"]}

    def test_nested_accumulator_open_discards_pending(self) -> None:
        """open_audit returns None when an accumulator is already open (nested wrapper)."""
        token = audit.open_audit()
        try:
            assert audit.open_audit() is None  # inner wrapper: NOT the owner
            assert audit.pending_rows() is not None
        finally:
            audit.reset_audit(token)
        assert audit.pending_rows() is None

    def test_reset_audit_with_none_token_is_noop(self) -> None:
        audit.reset_audit(None)


class TestSerialization:
    def test_date_to_iso(self, audit_ctx) -> None:
        audit.mark_audit(entity="activities", action="update", entity_id="a-1",
                         entity_label="L", changes={"start": [datetime(2026, 9, 20, 12, 0, tzinfo=UTC), "2026-09-20T15:00:00+03:00"]})
        row = audit.pending_rows()[0]
        assert row["changes"]["start"] == ["2026-09-20T12:00:00+00:00", "2026-09-20T15:00:00+03:00"]

    def test_decimal_to_str(self, audit_ctx) -> None:
        audit.mark_audit(entity="tariffs", action="update", entity_id="t-1",
                         entity_label="L", changes={"price": [Decimal("3500.00"), Decimal("4000.00")]})
        assert audit.pending_rows()[0]["changes"]["price"] == ["3500.00", "4000.00"]

    def test_enum_to_value(self, audit_ctx) -> None:
        from src.models.enums import UserRole
        audit.mark_audit(entity="users", action="update", entity_id="u-1",
                         entity_label="L", changes={"role": [UserRole.MASTER, UserRole.ADMIN]})
        assert audit.pending_rows()[0]["changes"]["role"] == ["master", "admin"]

    def test_none_passthrough(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="L", changes={"tariff_id": ["t-1", None]})
        assert audit.pending_rows()[0]["changes"]["tariff_id"] == ["t-1", None]

    def test_bool_and_int_passthrough(self, audit_ctx) -> None:
        audit.mark_audit(entity="tags", action="update", entity_id="t-1",
                         entity_label="L", changes={"is_active": [True, False], "sort_order": [1, 2]})
        assert audit.pending_rows()[0]["changes"] == {"is_active": [True, False], "sort_order": [1, 2]}


class TestMasking:
    def test_phone_masked(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="L", changes={"phone": ["+7 909 123-45-67", "+7 909 123-45-68"]})
        ch = audit.pending_rows()[0]["changes"]
        assert ch["phone"][0] == "+• ••• •••-45-67"
        assert ch["phone"][1] == "+• ••• •••-45-68"

    def test_phone_digits_masked(self, audit_ctx) -> None:
        audit.mark_audit(entity="visitors", action="update", entity_id="v-1",
                         entity_label="L", changes={"phone_digits": ["79091234567", "79091234568"]})
        assert audit.pending_rows()[0]["changes"]["phone_digits"] == ["•••••••4567", "•••••••4568"]

    def test_email_masked(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="L", changes={"email": ["ivan@example.com", None]})
        assert audit.pending_rows()[0]["changes"]["email"] == ["i***@e***.com", None]


class TestFreeTextExclusion:
    def test_free_text_fields_dropped(self, audit_ctx) -> None:
        audit.mark_audit(entity="records", action="update", entity_id="r-1",
                         entity_label="L",
                         changes={"comment": ["старый", "новый"], "note": ["a", "b"],
                                  "description": ["a", "b"], "record_info": ["a", "b"],
                                  "name": ["Анна", "Ольга"]})
        ch = audit.pending_rows()[0]["changes"]
        assert set(ch.keys()) == {"name"}

    def test_phone_like_suffix_still_masked(self, audit_ctx) -> None:
        """`phone` substring matching must not be fooled by non-phone keys — exact/suffix key match only."""
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="L", changes={"phone": ["+79990000001", "+79990000002"]})
        assert audit.pending_rows()[0]["changes"]["phone"] == ["+•••••••0001", "+•••••••0002"]


class TestCeilings:
    def test_label_truncated_to_255(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="x" * 300, changes=None)
        assert len(audit.pending_rows()[0]["entity_label"]) == 255

    def test_long_scalar_truncated_with_suffix(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="L", changes={"name": ["a" * 600, "b" * 600]})
        ch = audit.pending_rows()[0]["changes"]
        assert ch["name"][0] == "a" * 499 + "…"
        assert len(ch["name"][1]) == 500

    def test_list_of_ids_unchanged(self, audit_ctx) -> None:
        ids = [f"tag-{i}" for i in range(3)]
        audit.mark_audit(entity="visitors", action="update", entity_id="v-1",
                         entity_label="L", changes={"tag_ids": [None, ids]})
        assert audit.pending_rows()[0]["changes"]["tag_ids"] == [None, ids]


class TestEntitySignatures:
    """The per-entity signature dictionary (spec §5.1/§12): title + key fields."""

    def test_dictionary_covers_exactly_the_canonical_entities(self) -> None:
        """Every canonical #239 entity name has a signature — and nothing else."""
        from src.events.entities import MODEL_ENTITY

        assert set(audit.ENTITY_SIGNATURES) == set(MODEL_ENTITY.values())

    def test_every_signature_within_field_budget(self) -> None:
        """§5.1: title + carrying fields; no free-text in label/snapshot."""
        for entity, sig in audit.ENTITY_SIGNATURES.items():
            assert sig.title, f"{entity}: empty title"
            assert 0 < len(sig.title) <= 32, f"{entity}: title not String(32)-safe"
            assert len(sig.label_fields) <= 4, f"{entity}: label_fields budget"
            assert 1 <= len(sig.snapshot_fields) <= 4, f"{entity}: snapshot_fields budget"
            for field in (*sig.label_fields, *sig.snapshot_fields):
                assert field not in audit.FREE_TEXT_FIELDS, f"{entity}.{field}"

    def test_snapshot_fields_helper(self) -> None:
        assert audit.entity_snapshot_fields("payments") == \
            ("record_id", "amount", "method")
        assert audit.entity_snapshot_fields("nonexistent") == ()

    def test_titles_are_russian_headers(self) -> None:
        assert audit.ENTITY_SIGNATURES["clients"].title == "Клиент"
        assert audit.ENTITY_SIGNATURES["payments"].title == "Платёж"
        assert audit.ENTITY_SIGNATURES["activities"].title == "Занятие"


class TestDerivedLabels:
    """mark_audit without an explicit entity_label derives it from the dictionary."""

    def test_client_name_from_changes_after_value(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         changes={"name": ["Старое Имя", "Иванов Иван"]})
        assert audit.pending_rows()[0]["entity_label"] == "Иванов Иван"

    def test_staff_name_parts_joined_with_space(self, audit_ctx) -> None:
        audit.mark_audit(entity="staff", action="create", entity_id="s-1",
                         changes={"first_name": ["", "Иван"], "last_name": ["", "Иванов"]})
        assert audit.pending_rows()[0]["entity_label"] == "Иванов Иван"

    def test_thing_title_with_extra_field(self, audit_ctx) -> None:
        audit.mark_audit(entity="services", action="create", entity_id="s-1",
                         changes={"title": [None, "Стрижка мужская"],
                                  "specialty": [None, "hair"]})
        assert audit.pending_rows()[0]["entity_label"] == \
            "Стрижка мужская, hair"

    def test_unnamed_entity_prefixes_title(self, audit_ctx) -> None:
        audit.mark_audit(entity="payments", action="create", entity_id="p-1",
                         changes={"amount": [None, 3500], "method": [None, "card"]})
        assert audit.pending_rows()[0]["entity_label"] == "Платёж 3500, card"

    def test_delete_pair_prefers_before_value(self, audit_ctx) -> None:
        audit.mark_audit(entity="payments", action="delete", entity_id="p-1",
                         changes={"amount": [3500, None], "method": ["card", None]})
        assert audit.pending_rows()[0]["entity_label"] == "Платёж 3500, card"

    def test_phone_masked_in_derived_label(self, audit_ctx) -> None:
        audit.mark_audit(entity="users", action="update", entity_id="u-1",
                         changes={"phone": ["+7 909 123-45-67", "+7 909 123-45-68"]})
        assert audit.pending_rows()[0]["entity_label"] == \
            "Пользователь +• ••• •••-45-68"

    def test_known_entity_without_values_falls_back_to_title(self, audit_ctx) -> None:
        audit.mark_audit(entity="user_settings", action="update", entity_id="us-1",
                         changes={"theme": ["light", "dark"]})
        assert audit.pending_rows()[0]["entity_label"] == "Настройки"

    def test_unknown_entity_falls_back_to_raw_name(self, audit_ctx) -> None:
        audit.mark_audit(entity="strange_thing", action="update", entity_id="x-1",
                         changes={"foo": ["a", "b"]})
        assert audit.pending_rows()[0]["entity_label"] == "strange_thing"

    def test_derived_label_clipped_to_255(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         changes={"name": [None, "д" * 300]})
        assert len(audit.pending_rows()[0]["entity_label"]) == 255

    def test_explicit_label_wins_over_derivation(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="update", entity_id="c-1",
                         entity_label="Явная подпись",
                         changes={"name": [None, "Иванов Иван"]})
        assert audit.pending_rows()[0]["entity_label"] == "Явная подпись"

    def test_no_changes_no_label_uses_fallbacks(self, audit_ctx) -> None:
        audit.mark_audit(entity="tags", action="delete", entity_id="t-1", changes=None)
        assert audit.pending_rows()[0]["entity_label"] == "Тег"
        audit.mark_audit(entity="strange_thing", action="delete", entity_id="x-1",
                         changes=None)
        assert audit.pending_rows()[1]["entity_label"] == "strange_thing"

    def test_derive_entity_label_renders_dates_and_enums(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        label = audit.derive_entity_label(
            "activities",
            {"start": datetime(2026, 9, 20, 12, 0, tzinfo=ZoneInfo("UTC")),
             "duration": 90},
        )
        assert label == "Занятие 2026-09-20T12:00:00+00:00, 90"

    def test_derive_entity_label_unknown_entity_is_none(self) -> None:
        assert audit.derive_entity_label("nope", {"a": 1}) is None


class TestDrawRows:
    def test_draw_returns_and_clears(self, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="delete", entity_id="c-1",
                         entity_label="L", changes=None)
        rows = audit.draw_rows()
        assert len(rows) == 1
        assert audit.pending_rows() == []

    def test_draw_on_closed_accumulator_is_none(self) -> None:
        assert audit.draw_rows() is None

    def test_row_shape(self, actor_ctx, audit_ctx) -> None:
        audit.mark_audit(entity="clients", action="create", entity_id="c-1",
                         entity_label="L", changes=None)
        row = audit.pending_rows()[0]
        assert row["user_id"] == "u-1"
        assert row["user_role"] == "admin"
        assert "id" not in row  # model default supplies the UUID
