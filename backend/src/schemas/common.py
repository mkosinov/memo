"""Shared Pydantic schemas used across domains."""

from typing import Generic, TypeVar

from pydantic import BaseModel

ItemT = TypeVar("ItemT", bound=BaseModel)


class PaginatedResponse(BaseModel, Generic[ItemT]):
    """Paginated list response envelope."""

    items: list[ItemT]
    total: int
    page: int
    per_page: int


class DeleteResolutionsEnvelope(BaseModel):
    """Documented wire shape of the unified-DELETE execute body (GH #207 §6).

    Routes parse via :func:`extract_resolutions` (they accept a raw dict so
    both the wrapped and the bare legacy shapes work); this model documents
    the spec-correct ``{"resolutions": {"entity": "nullify"|"cascade"}}``
    wire form (spec §2/§6/§12; mirrors the api-client ``resolveDeleteX``).
    """

    resolutions: dict[str, str]

    model_config = {"extra": "allow"}


def extract_resolutions(payload: dict | None) -> dict[str, str] | None:
    """Normalize the unified-DELETE body into the resolutions dict.

    Spec §6 wire form: ``{"resolutions": {...}}`` (what the api-client
    ``resolveDeleteX`` sends — Task 12). A bare resolutions dict is accepted
    too (legacy shape; keeps the dry-run/execute distinction working for
    callers that send the dict unwrapped). Never raises on shape — a body
    that carries no string-valued resolutions falls back to the dry-run
    path (409/204) rather than a 422 parse error.
    """
    if payload is None:
        return None
    nested = payload.get("resolutions")
    if isinstance(nested, dict) and all(isinstance(v, str) for v in nested.values()):
        return nested
    if all(isinstance(v, str) for v in payload.values()):
        return payload
    return None