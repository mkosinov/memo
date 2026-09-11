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


class PositionIsSystemError(Exception):
    """Deleting a built-in position (``is_system``) is forbidden (GH #266 D4).

    The router catches this and maps it to 422 with the
    ``POSITION_IS_SYSTEM`` error code.
    """

    def __init__(self, position_id: str) -> None:
        super().__init__(
            f"Position {position_id!r} is a built-in (is_system) position "
            f"and cannot be deleted"
        )
        self.position_id = position_id


class PositionNotFoundError(Exception):
    """A request referenced a position id that does not exist (GH #266).

    Raised by composite staff-card writes when ``position_ids`` contains an
    unknown dictionary row. The router maps it to 422 with the
    ``POSITION_NOT_FOUND`` error code.
    """

    def __init__(self, position_id: str) -> None:
        super().__init__(f"Position {position_id!r} not found")
        self.position_id = position_id


class SpecialtyRequiredError(Exception):
    """Master section without a specialty (GH #266 D5 — обязательна).

    The router maps this to 422 ``SPECIALTY_REQUIRED``.
    """


class ColorRequiredError(Exception):
    """Master section without a color (GH #266 D5 — обязателен).

    The router maps this to 422 ``COLOR_REQUIRED``.
    """
