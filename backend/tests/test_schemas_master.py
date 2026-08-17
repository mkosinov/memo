"""Tests for MasterResponse schema — ``is_active`` → ``archived`` inversion (#207).

The DB column ``is_active`` stays; the API Response must serialize ``archived``
(``archived = not is_active``) and must NOT serialize ``is_active``.

Pattern (per spec §3.1 + architect design notes):
- ``is_active`` remains on the Pydantic model as ``Field(exclude=True)`` so it is
  parsed from the ORM via ``from_attributes=True`` but excluded from JSON.
- ``archived`` is a ``@computed_field`` deriving ``not self.is_active``.
"""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from src.schemas.master import MasterResponse


def _master_orm(**overrides) -> SimpleNamespace:
    """Fake ORM-like object with all fields MasterResponse expects."""
    base = dict(
        id="master-1",
        first_name="Anna",
        last_name="Smith",
        color="#5B8C7A",
        position="мастер",
        specialty="живопись",
        avatar_url=None,
        sort_order=0,
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
        updated_at=datetime(2025, 1, 1, tzinfo=UTC),
        is_active=True,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestMasterResponseArchivedInversion:
    """MasterResponse must expose ``archived`` (inverted) and hide ``is_active``."""

    @pytest.mark.pure_unit
    def test_active_master_serializes_archived_false(self) -> None:
        resp = MasterResponse(
            id="m1",
            first_name="Anna",
            last_name="Smith",
            color="#5B8C7A",
            position="мастер",
            specialty="живопись",
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
            updated_at=datetime(2025, 1, 1, tzinfo=UTC),
            is_active=True,
        )
        dump = resp.model_dump()
        assert "archived" in dump, "archived must appear in serialized response"
        assert dump["archived"] is False
        assert "is_active" not in dump, "is_active must NOT be serialized"

    @pytest.mark.pure_unit
    def test_archived_master_serializes_archived_true(self) -> None:
        resp = MasterResponse(
            id="m2",
            first_name="Anna",
            last_name="Smith",
            color="#5B8C7A",
            position="мастер",
            specialty="живопись",
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
            updated_at=datetime(2025, 1, 1, tzinfo=UTC),
            is_active=False,
        )
        dump = resp.model_dump()
        assert dump["archived"] is True
        assert "is_active" not in dump

    @pytest.mark.pure_unit
    def test_archived_is_inverted_from_is_active(self) -> None:
        """archived must equal not is_active for both polarities."""
        for is_active in (True, False):
            resp = MasterResponse(
                id="m",
                first_name="A",
                last_name="B",
                color="#000000",
                position="мастер",
                specialty="живопись",
                created_at=datetime(2025, 1, 1, tzinfo=UTC),
                updated_at=datetime(2025, 1, 1, tzinfo=UTC),
                is_active=is_active,
            )
            assert resp.archived is (not is_active)

    @pytest.mark.pure_unit
    def test_json_dump_excludes_is_active(self) -> None:
        resp = MasterResponse(
            id="m1",
            first_name="Anna",
            last_name="Smith",
            color="#5B8C7A",
            position="мастер",
            specialty="живопись",
            created_at=datetime(2025, 1, 1, tzinfo=UTC),
            updated_at=datetime(2025, 1, 1, tzinfo=UTC),
            is_active=True,
        )
        json_str = resp.model_dump_json()
        assert '"archived"' in json_str
        assert '"is_active"' not in json_str

    @pytest.mark.pure_unit
    def test_from_attributes_parses_is_active_derives_archived(self) -> None:
        """model_validate from ORM-like object: is_active parsed, archived derived,
        is_active excluded from serialization."""
        orm = _master_orm(is_active=False)
        resp = MasterResponse.model_validate(orm)
        assert resp.is_active is False
        assert resp.archived is True
        dump = resp.model_dump()
        assert dump["archived"] is True
        assert "is_active" not in dump