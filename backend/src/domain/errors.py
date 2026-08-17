"""Shared domain errors raised by services (non-deletion; deletion errors live in deletion.py)."""

from __future__ import annotations


class BareListLimitExceededError(Exception):
    """Raised when a bare /all dictionary list exceeds the protective row limit.

    Message assumption: the API router prefix equals the model tablename
    (true for all 5 dictionaries: masters/locations/services/tags/materials).
    The router catches this and converts it to a 422 standard envelope, the
    same idiom as #207's ``ResolutionError`` family.
    """

    def __init__(self, table_name: str, limit: int) -> None:
        super().__init__(
            f"Dictionary '{table_name}' exceeded the /all limit of {limit} rows — "
            f"use the paginated GET /api/v1/{table_name} endpoint"
        )
