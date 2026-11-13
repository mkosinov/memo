"""Pydantic schemas for the specialties dictionary (GH #599).

Mirror of the positions dictionary (minimal reference entity): no
archive awareness, no filters, no ``sort_by`` — the paginated list is
fixed-order ``title ASC, id ASC`` at the route. Not publicly readable
(the dictionary is internal; public exposure is the #606 wave).

The single domain rule on write (domain rules specialties.md): the
``title`` is NORMALIZED before it reaches the database — edge trim,
internal-whitespace collapse, NFC composition; an empty/whitespace-only
value → 422 (the normalized empty string fails ``min_length``).
"""

from __future__ import annotations

import unicodedata
from datetime import datetime  # noqa: TC003 — pydantic resolves field types at runtime
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from src.schemas.pagination import PaginationParams


def normalize_title(value: object) -> object:
    """Trim, collapse internal whitespace, NFC-compose a title.

    A ``BeforeValidator`` body: non-string input passes through
    untouched (pydantic then raises the type error → 422); a string is
    normalized BEFORE the field's length constraints are applied, so
    they pin the STORED value (``min_length=1`` rejects a normalized
    blank → the «пустое/пробельное → 422» rule).
    """
    if not isinstance(value, str):
        return value
    return unicodedata.normalize("NFC", " ".join(value.split()))


NormalizedTitle = Annotated[str, BeforeValidator(normalize_title)]


class SpecialtyListParams(PaginationParams):
    """Query parameters for GET /api/v1/specialties (GH #371 §4.1).

    Specialties have no filters of their own and NO ``sort_by`` — the
    order is fixed by contract (``title ASC, id ASC``, domain rules
    List contract): the subclass carries ONLY the inherited brick fields
    (``page``/``per_page`` + the ``id`` set filter, #232). The class
    still exists so the route reads ONE model like every list (uniform
    entry, domain rule 8, #371). Injected as
    ``Annotated[SpecialtyListParams, Query()]``.
    """


class SpecialtyCreate(BaseModel):
    """Request schema for creating a specialty (title only, normalized)."""

    model_config = ConfigDict(extra="forbid")

    title: NormalizedTitle = Field(min_length=1, max_length=100)


class SpecialtyPatch(BaseModel):
    """Request schema for renaming via PATCH — title optional, normalized.

    ``None`` (field absent) keeps the current title; the generic PATCH
    contract strips a ``null`` title (NOT NULL column — client intent
    is "don't change", never "blank it").
    """

    model_config = ConfigDict(extra="forbid")

    title: NormalizedTitle | None = Field(default=None, min_length=1, max_length=100)


class SpecialtyView(BaseModel):
    """Response schema for a dictionary row (read shape, GH #599 §4.2)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    created_at: datetime
    updated_at: datetime
