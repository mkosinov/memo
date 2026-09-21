"""PaginationParams ``id`` list-filter field (#232 Task 1).

Contract (spec §3.1): ``?id=X&id=Y`` repeated query keys parse into
``list[UUID] | None`` on the shared list-params base — UUID-only values
(garbage → 422), ceiling ``MAX_LIST_IDS`` (the same canonical constant as
the ``per_page`` cap, #206), order-preserving dedup of repeats via a
field-level ``BeforeValidator`` (model-level validators on Depends()
models are a 500-trap — canon comment at the ``phone`` field in
``schemas/client.py``).
"""

from uuid import UUID

import pytest
from pydantic import ValidationError

from src.schemas.pagination import MAX_LIST_IDS, PaginationParams

pytestmark = pytest.mark.pure_unit


class TestIdListField:
    def test_default_is_none(self):
        assert PaginationParams().id is None

    def test_uuid_strings_coerce(self):
        u = UUID(int=1)
        p = PaginationParams(id=[str(u)])
        assert p.id == [u]

    def test_duplicates_removed_order_preserved(self):
        u1, u2, u3 = UUID(int=1), UUID(int=2), UUID(int=3)
        p = PaginationParams(id=[str(u1), str(u2), str(u1), str(u3), str(u2)])
        assert p.id == [u1, u2, u3]

    def test_invalid_uuid_rejected(self):
        with pytest.raises(ValidationError):
            PaginationParams(id=["not-a-uuid"])

    def test_over_limit_unique_ids_rejected(self):
        ids = [str(UUID(int=i)) for i in range(MAX_LIST_IDS + 1)]
        with pytest.raises(ValidationError):
            PaginationParams(id=ids)

    def test_exactly_limit_unique_ids_accepted(self):
        ids = [str(UUID(int=i)) for i in range(MAX_LIST_IDS)]
        assert len(PaginationParams(id=ids).id) == MAX_LIST_IDS

    def test_dedup_runs_before_length_cap(self):
        # 150 raw values, 80 unique: the BeforeValidator dedups first, so
        # the max_length cap sees 80 → accepted.
        ids = [str(UUID(int=i % 80)) for i in range(150)]
        p = PaginationParams(id=ids)
        assert len(p.id) == 80

    def test_list_schemas_inherit_id_field(self):
        from src.schemas.client import ClientListParams

        assert "id" in ClientListParams.model_fields


class TestPerPageCapUsesSharedConstant:
    """#232: per_page ceiling and the id cap are ONE canonical constant."""

    def test_per_page_over_max_list_ids_rejected(self):
        with pytest.raises(ValidationError):
            PaginationParams(per_page=MAX_LIST_IDS + 1)

    def test_per_page_at_max_list_ids_accepted(self):
        assert PaginationParams(per_page=MAX_LIST_IDS).per_page == MAX_LIST_IDS
