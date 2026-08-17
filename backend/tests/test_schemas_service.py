"""Tests for ServiceResponse schema — ``is_active`` → ``archived`` inversion (#207).

The DB column ``is_active`` stays; the API Response must serialize ``archived``
(``archived = not is_active``) and must NOT serialize ``is_active``.
"""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from src.schemas.service import ServiceResponse


def _service_orm(**overrides) -> SimpleNamespace:
    base = dict(
        id="svc-1",
        title="Painting 101",
        description="Intro class",
        image_url="https://example.com/i.jpg",
        specialty="живопись",
        min_age=6,
        max_age=99,
        duration=90,
        record_info="info",
        material_hint=None,
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
        updated_at=datetime(2025, 1, 1, tzinfo=UTC),
        is_active=True,
        tariffs=[],
        tags=[],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _service_kwargs(**overrides) -> dict:
    base = dict(
        id="svc-1",
        title="Painting 101",
        description="Intro class",
        image_url="https://example.com/i.jpg",
        specialty="живопись",
        min_age=6,
        duration=90,
        record_info="info",
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
        updated_at=datetime(2025, 1, 1, tzinfo=UTC),
        is_active=True,
    )
    base.update(overrides)
    return base


class TestServiceResponseArchivedInversion:
    """ServiceResponse must expose ``archived`` (inverted) and hide ``is_active``."""

    @pytest.mark.pure_unit
    def test_active_service_serializes_archived_false(self) -> None:
        resp = ServiceResponse(**_service_kwargs(is_active=True))
        dump = resp.model_dump()
        assert "archived" in dump
        assert dump["archived"] is False
        assert "is_active" not in dump

    @pytest.mark.pure_unit
    def test_archived_service_serializes_archived_true(self) -> None:
        resp = ServiceResponse(**_service_kwargs(is_active=False))
        dump = resp.model_dump()
        assert dump["archived"] is True
        assert "is_active" not in dump

    @pytest.mark.pure_unit
    def test_archived_inverted_from_is_active_both_polarities(self) -> None:
        for is_active in (True, False):
            resp = ServiceResponse(**_service_kwargs(is_active=is_active))
            assert resp.archived is (not is_active)

    @pytest.mark.pure_unit
    def test_json_dump_excludes_is_active(self) -> None:
        resp = ServiceResponse(**_service_kwargs(is_active=True))
        json_str = resp.model_dump_json()
        assert '"archived"' in json_str
        assert '"is_active"' not in json_str

    @pytest.mark.pure_unit
    def test_from_attributes_parses_is_active_derives_archived(self) -> None:
        orm = _service_orm(is_active=False)
        resp = ServiceResponse.model_validate(orm)
        assert resp.is_active is False
        assert resp.archived is True
        dump = resp.model_dump()
        assert dump["archived"] is True
        assert "is_active" not in dump