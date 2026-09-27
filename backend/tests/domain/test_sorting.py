"""Unit contract tests for the shared sort resolver (src/domain/sorting.py).

GH #367 spec §4.2 / §6 — single source of truth for the ORDER BY mechanics
shared by all 8 sortable list entities:

* canonical policy: ``asc → nullsfirst`` / ``desc → nullslast``;
* ``always_nulls_last`` policy: nulls-last in BOTH directions (staff
  ``specialty``/``color`` — «пустые — в конце»);
* tie-break column: LAST expression, ``asc()``, NOT subject to any nulls
  policy (PK is NOT NULL);
* unknown key → ``UnknownSortKeyError`` (safety net behind Literal validation);
* the global handler maps ``UnknownSortKeyError`` → 422 VALIDATION_ERROR
  (spec scenario С2);
* drift guard (Task 6, spec §4.2 protection layer 2): for each of the 8
  sortable entities the ``XSortBy`` Literal args equal the entity sort-map
  keys — catches «Literal расширили, карту забыли» (and vice versa).

Pure unit — no DB, no app lifespan: the resolver is called directly on
plain SQLAlchemy ``Column`` objects and only the STRUCTURE of the returned
expressions is asserted (direction / nulls placement / list order) via
string compilation.

Dialect note under test: ``nullsfirst/nullslast`` compile to SQL
``NULLS FIRST/LAST`` (PostgreSQL; SQLite 3.30+).
"""

from __future__ import annotations

from typing import ClassVar, get_args

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer

from src.api.v1.locations import _LOCATION_SORT_KEYS
from src.api.v1.materials import _MATERIAL_SORT_KEYS
from src.api.v1.services import _SERVICE_SORT_KEYS
from src.api.v1.staff import _STAFF_SORT_KEYS
from src.api.v1.tags import _TAG_SORT_KEYS
from src.domain.errors import UnknownSortKeyError
from src.domain.sorting import (
    SortKeySpec,
    apply_sort,
)
from src.errors import ErrorCode
from src.main import create_app
from src.schemas.client import ClientSortBy
from src.schemas.location import LocationSortBy
from src.schemas.material import MaterialSortBy
from src.schemas.photo import PhotoSortBy
from src.schemas.record import RecordSortBy
from src.schemas.service import ServiceSortBy
from src.schemas.staff import StaffSortBy
from src.schemas.tag import TagSortBy
from src.services.client import _CLIENT_SORT_KEYS
from src.services.photo import _SORT_COLUMNS as _PHOTO_SORT_KEYS
from src.services.record import _RECORD_SORT_KEYS

pytestmark = pytest.mark.pure_unit

# Plain columns — no table binding needed; we only compile expressions.
_NAME = Column("name", Integer)
_COLOR = Column("color", Integer)
_ID = Column("id", Integer)


def _exprs(expr: list) -> list[str]:
    return [str(e) for e in expr]


# ─── Canonical policy ────────────────────────────────────────────────────────


class TestCanonicalPolicy:
    def test_asc_applies_nullsfirst(self) -> None:
        result = apply_sort({"name": SortKeySpec([_NAME])}, "name", "asc", _ID)
        assert _exprs(result) == ["name ASC NULLS FIRST", "id ASC"]

    def test_desc_applies_nullslast(self) -> None:
        result = apply_sort({"name": SortKeySpec([_NAME])}, "name", "desc", _ID)
        assert _exprs(result) == ["name DESC NULLS LAST", "id ASC"]

    def test_canonical_policy_explicit(self) -> None:
        """Policy is per-key, travels in the map; explicit 'canonical'."""
        result = apply_sort(
            {"name": SortKeySpec([_NAME], policy="canonical")},
            "name",
            "asc",
            _ID,
        )
        assert _exprs(result) == ["name ASC NULLS FIRST", "id ASC"]


# ─── always_nulls_last policy ────────────────────────────────────────────────


class TestAlwaysNullsLastPolicy:
    MAP: ClassVar[dict[str, SortKeySpec]] = {
        "color": SortKeySpec([_COLOR], policy="always_nulls_last")
    }

    def test_asc_nulls_last(self) -> None:
        result = apply_sort(self.MAP, "color", "asc", _ID)
        assert _exprs(result) == ["color ASC NULLS LAST", "id ASC"]

    def test_desc_nulls_last(self) -> None:
        result = apply_sort(self.MAP, "color", "desc", _ID)
        assert _exprs(result) == ["color DESC NULLS LAST", "id ASC"]


# ─── Tie-break column ────────────────────────────────────────────────────────


class TestTieBreak:
    MAP: ClassVar[dict[str, SortKeySpec]] = {
        "name": SortKeySpec([_NAME], policy="always_nulls_last")
    }

    def test_tiebreak_is_last_asc_without_nulls_policy(self) -> None:
        result = apply_sort(self.MAP, "name", "desc", _ID)
        assert len(result) == 2
        tie = result[-1]
        assert str(tie) == "id ASC"  # bare asc — no NULLS FIRST/LAST

    def test_tiebreak_unaffected_even_when_sort_desc(self) -> None:
        """PK tie-break is asc regardless of sort_order='desc'."""
        result = apply_sort(self.MAP, "name", "desc", _ID)
        assert _exprs(result) == ["name DESC NULLS LAST", "id ASC"]


# ─── Unknown key ─────────────────────────────────────────────────────────────


class TestUnknownKey:
    def test_unknown_key_raises(self) -> None:
        with pytest.raises(UnknownSortKeyError):
            apply_sort({"name": SortKeySpec([_NAME])}, "bogus", "asc", _ID)


# ─── Multiple expressions per key ────────────────────────────────────────────


class TestMultipleExpressions:
    MAP: ClassVar[dict[str, SortKeySpec]] = {
        "name": SortKeySpec([_NAME, _COLOR], policy="always_nulls_last"),
    }

    def test_expressions_apply_in_map_order(self) -> None:
        result = apply_sort(self.MAP, "name", "desc", _ID)
        assert _exprs(result) == [
            "name DESC NULLS LAST",
            "color DESC NULLS LAST",
            "id ASC",
        ]

    def test_canonical_multiple_asc(self) -> None:
        result = apply_sort({"name": SortKeySpec([_NAME, _COLOR])}, "name", "asc", _ID)
        assert _exprs(result) == [
            "name ASC NULLS FIRST",
            "color ASC NULLS FIRST",
            "id ASC",
        ]


# ─── Global handler → 422 (spec scenario С2, safety net) ─────────────────────


class TestUnknownSortKeyErrorHandler:
    @pytest.fixture()
    def trigger_client(self) -> TestClient:
        """Real app + throwaway trigger route raising the domain error.

        Follows the test_error_handlers.py idiom: handler registration is
        verified on the production ``create_app()`` app, with
        ``raise_server_exceptions=False`` so the handler's JSONResponse wins
        over TestClient re-raising.
        """
        app = create_app()

        @app.get("/test/trigger-unknown-sort-key")
        async def _trigger() -> dict[str, bool]:
            raise UnknownSortKeyError("bogus")

        return TestClient(app, raise_server_exceptions=False)

    def test_unknown_sort_key_maps_to_422_validation_error(
        self, trigger_client: TestClient
    ) -> None:
        resp = trigger_client.get("/test/trigger-unknown-sort-key")
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == ErrorCode.VALIDATION_ERROR.value
        assert detail["message"]


# ─── CI drift guard: Literal == map, per entity (Task 6, spec §4.2) ──────────


class TestSortContractGuard:
    """Layer 2 of the unknown-key protection (spec §4.2): keep each
    entity's ``XSortBy`` Literal and its sort map in sync.

    The Literal is the user-facing 422 line; the map is what the resolver
    reads. A key added to one but not the other drifts the contract:
    Literal-without-map → ``UnknownSortKeyError`` 500-safety-net territory
    (422 only via the handler); map-without-Literal → dead, unsortable
    key. This parametrized guard fails on BOTH directions of drift.
    """

    CASES: ClassVar[list[tuple[str, object, dict]]] = [
        ("clients", ClientSortBy, _CLIENT_SORT_KEYS),
        ("records", RecordSortBy, _RECORD_SORT_KEYS),
        ("photos", PhotoSortBy, _PHOTO_SORT_KEYS),
        ("staff", StaffSortBy, _STAFF_SORT_KEYS),
        ("services", ServiceSortBy, _SERVICE_SORT_KEYS),
        ("materials", MaterialSortBy, _MATERIAL_SORT_KEYS),
        ("locations", LocationSortBy, _LOCATION_SORT_KEYS),
        ("tags", TagSortBy, _TAG_SORT_KEYS),
    ]

    @pytest.mark.parametrize(
        ("entity", "literal", "sort_map"),
        CASES,
        ids=[case[0] for case in CASES],
    )
    def test_literal_args_equal_map_keys(
        self, entity: str, literal: object, sort_map: dict
    ) -> None:
        assert set(get_args(literal)) == set(sort_map), (
            f"{entity}: XSortBy Literal and sort map have drifted — "
            f"Literal only: {set(get_args(literal)) - set(sort_map)}, "
            f"map only: {set(sort_map) - set(get_args(literal))}"
        )
