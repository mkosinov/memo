"""Pydantic schemas for the audit journal reading API (GH #344, spec §6).

Read-only shapes: the journal has no create/update schemas — rows are
written exclusively by the accumulator inside ``@transactional``
(spec §4); these models describe ONLY what the two admin endpoints
return.
"""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel

from src.schemas.pagination import PaginationParams


class AuditLogListParams(PaginationParams):
    """Query parameters for GET /api/v1/audit-logs (GH #371 §4.1).

    Composed of the ``PaginationParams`` brick (``page``/``per_page`` and
    the ``id`` set filter, #232 — ``?id=`` starts working on the journal
    via the §4.3 gap-3 predicate in ``list_audit_logs``). The router's
    former scalar query siblings ride along 1:1 (spec §4.1 keeps the
    annotations, scenario 8 wire parity — no tightening, no losses):
    ``user_id``/``action``/``entity``/``entity_id`` (``str | None`` —
    the journal stores free-form filter strings) and the whole-day
    ``date_from``/``date_to`` pair (``date | None``, the shared
    ``day_range`` canon). Injected as ``Annotated[AuditLogListParams,
    Query()]`` — scalar query siblings are banned (fastapi PR #12481).
    """

    user_id: str | None = None
    action: str | None = None
    entity: str | None = None
    entity_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None


class AuditLogUserRef(BaseModel):
    """Author reference on a journal row — ``{id, label}``.

    ``id`` is the journal row's ``user_id``; ``label`` is resolved by
    the reading join (users ⟕ staff: card name «Иванов Иван», phone
    fallback for cardless accounts). Both nullable: a future user
    hard-delete nulls the FK (ON DELETE SET NULL) — the journal row
    stays, its author reference empties.
    """

    id: str | None
    label: str | None


class AuditLogResponse(BaseModel):
    """One journal row (spec §6).

    ``user_role`` is the ROLE SNAPSHOT from the journal row — the role
    at the moment of the action, never the live users.role (later
    promotions do not rewrite history, spec §5).
    """

    id: str
    created_at: datetime
    user: AuditLogUserRef
    user_role: str
    action: str
    entity: str
    entity_id: str | None
    entity_label: str
    changes: dict[str, Any] | None


class AuditLogAuthorResponse(BaseModel):
    """One distinct journal author — the filter dropdown entry."""

    user_id: str
    label: str | None
