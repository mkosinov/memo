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


class ProfileOwnerNotFoundError(Exception):
    """The /my owner user row no longer resolves (GH #262).

    A session can outlive its user (row deleted server-side); the
    ProfileService raises this instead of a runtime ``assert`` (stripped
    under ``python -O``). The /my router maps it to 401
    ``AUTH_UNAUTHORIZED`` — the same envelope the session guard emits for
    a dead session, so the frontend's 401 → /login redirect covers it.
    """


class ProfileNoStaffCardError(Exception):
    """Portrait upload without a staff card (GH #262 Task 2).

    The portrait is card-bound (it becomes ``Staff.avatar_url``); a user
    without a live card has nothing to attach it to. The /my portrait
    router maps this to 422 — the modal hides the upload row for
    cardless users, so this is a contract guard, not a user-facing flow.
    """


class FileTooLargeError(Exception):
    """Upload exceeds the 5 MB avatar limit (GH #262 Task 2, spec §3.4).

    Raised by the Content-Length precheck (before reading the body) or by
    the streaming byte cap; the router maps it to 413 ``FILE_TOO_LARGE``.
    """


class FileInvalidTypeError(Exception):
    """Upload magic bytes are not JPEG/PNG/WebP (GH #262 Task 2, §3.4).

    Renamed/foreign files are rejected regardless of filename; the router
    maps this to 415 ``FILE_INVALID_TYPE``.
    """
