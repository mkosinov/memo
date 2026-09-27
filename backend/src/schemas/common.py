"""Shared Pydantic schemas used across domains."""

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

ItemT = TypeVar("ItemT", bound=BaseModel)

# Sort direction for list endpoints (#205 Task 3). Shared across all
# dictionary list endpoints; per-entity sort_by whitelists live in their
# own schema modules.
SortOrder = Literal["asc", "desc"]

# GH #367 §4.1: the sort-by whitelist TypeVar parametrizing SortParams.
# bound=str keeps the brick usable only with per-entity Literal whitelists.
SortByT = TypeVar("SortByT", bound=str)


class SortParams(BaseModel, Generic[SortByT]):
    """Shared sort params brick for list param models (GH #367 §4.1).

    The brick carries the FORM only: a nullable ``sort_by`` of the entity's
    Literal type + the shared ``SortOrder`` direction. Fixed defaults are a
    SUBCLASS concern (panel decision — spec §4.1 «правило дефолтов»): every
    subclass with a fixed default overrides BOTH fields with its own
    annotation and value, dropping ``None`` from the type altogether:

    * records — ``sort_by: RecordSortBy = "date"``, ``sort_order = "asc"``;
    * photos — ``sort_by: PhotoSortBy = "created_at"``, ``"desc"`` preserved;
    * clients — ``sort_by: ClientSortBy = "name"``, ``sort_order = "asc"``.

    The ``sort_by=None`` semantics (entity-specific fallback order) live ONLY
    at the scalar dictionary routes (``sort_by: XSortBy | None = Query(None)``)
    — see ``schemas/pagination.py`` for why those cannot inherit a model.
    """

    sort_by: SortByT | None = None
    sort_order: SortOrder = "asc"


class PaginatedResponse(BaseModel, Generic[ItemT]):
    """Paginated list response envelope."""

    items: list[ItemT]
    total: int
    page: int
    per_page: int
