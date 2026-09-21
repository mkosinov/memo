"""Shared pagination query parameters (GH #206)."""

from typing import Annotated, TypeVar
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field

# GH #232 §3.1: one canonical ceiling for BOTH list-size caps — the
# ``per_page`` page size (#206) and the ``?id=`` filter length. Declared
# once so the two cannot drift apart (was a bare ``le=100`` literal).
MAX_LIST_IDS = 100

_T = TypeVar("_T")


def _dedup_ids(v: list[_T] | None) -> list[_T] | None:
    """Order-preserving dedup of repeated ``?id=`` values (#232).

    Field-level BeforeValidator, NOT a model validator: this model is
    injected via ``Depends()`` and FastAPI validates each query field
    through its own TypeAdapter — field-level validators run there and
    map ValueError → 422, while model-level validators only fire at
    model construction inside solve_dependencies, uncaught → 500 (canon:
    the ``phone`` field comment in ``schemas/client.py``).
    """
    if v is None:
        return None
    return list(dict.fromkeys(v))


class PaginationParams(BaseModel):
    """page/per_page (+ ``id`` set filter, #232) query params for list endpoints.

    Injected in routers as ``pagination: PaginationParams = Depends()``
    (Depends, not ``Annotated[..., Query()]``: a query-param model cannot
    coexist with other scalar query params in one handler — fastapi PR
    #12481 — and 8 of 9 list routers mix pagination with filters/sort).
    CAVEAT (#232): list-typed fields (``id`` below) are classified as
    BODY params and silently dropped under the Depends shape — routers
    that must enforce the ``?id=`` contract inject the model as
    ``Annotated[Params, Query()]`` instead (clients/records/photos).
    """

    page: int = Field(default=1, ge=1)
    # le (not max_length): per_page is a scalar — le works there and maps
    # to 422; see the id field below for why its list cap differs.
    per_page: int = Field(default=20, ge=1, le=MAX_LIST_IDS)
    # GH #232 §3.1: machine-readable narrowing by id set (``?id=X&id=Y``
    # repeated query keys → list), inherited by every list schema.
    # UUID-only values (garbage → 422 via uuid_parsing); ceiling is the
    # shared MAX_LIST_IDS constant; repeats deduped BEFORE the cap
    # (BeforeValidator runs ahead of field constraints). max_length, not
    # le: pydantic 2 applies le to the whole list object and raises
    # TypeError (→ 500); max_length is the list-length constraint
    # (too_long → 422).
    id: Annotated[list[UUID] | None, BeforeValidator(_dedup_ids)] = Field(
        default=None, max_length=MAX_LIST_IDS
    )
