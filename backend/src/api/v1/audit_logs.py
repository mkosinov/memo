"""FastAPI router for the audit journal reading endpoints (GH #344, spec §6).

Read-only surface over the append-only ``audit_logs`` table:

* ``GET /api/v1/audit-logs`` — paginated journal, fixed ``created_at DESC``
  (sort toggling is out of scope for v1, spec §7);
* ``GET /api/v1/audit-logs/authors`` — distinct authors for the filter
  dropdown.

Both admin-only (``require_admin``): master → 403, anonymous → 401. The
queries live in the free reading functions of ``src/services/audit_log.py``
(corridor 3 — no service class, no transaction: the journal is never
written through this surface).
"""

from datetime import date

from fastapi import APIRouter, Depends, Query

from src.auth.permissions import require_admin
from src.db import SessionDep
from src.schemas.audit_log import (
    AuditLogAuthorResponse,
    AuditLogResponse,
)
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.services.audit_log import list_audit_log_authors, list_audit_logs

router = APIRouter(
    tags=["audit-logs"],
    # GH #344 (spec §6): the journal is admin-only, both routes.
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=PaginatedResponse[AuditLogResponse])
async def get_audit_logs(
    session: SessionDep,
    pagination: PaginationParams = Depends(),  # noqa: B008
    user_id: str | None = Query(None),
    action: str | None = Query(None),
    entity: str | None = Query(None),
    entity_id: str | None = Query(None),
    date_from: date | None = Query(None),  # noqa: B008
    date_to: date | None = Query(None),  # noqa: B008
) -> PaginatedResponse[AuditLogResponse]:
    """Return a page of journal rows — ``created_at DESC`` (spec §6).

    Conjunctive filters: author (``user_id``), ``action``, ``entity``,
    ``entity_id``, whole-day period (``date_from`` from 00:00:00
    inclusive, ``date_to`` through the end of the day — the shared
    ``day_range`` canon, same semantics as the payments/records lists).
    ``user.label`` is resolved in the SAME query (users ⟕ staff) — no
    N+1 over journal rows; ``user_role`` is the row's role snapshot,
    never the live users.role.
    """
    return await list_audit_logs(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        user_id=user_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/authors", response_model=list[AuditLogAuthorResponse])
async def get_audit_log_authors(
    session: SessionDep,
) -> list[AuditLogAuthorResponse]:
    """Return the journal's distinct authors ``[{user_id, label}]``.

    One query over the journal's users join (label resolution shared
    with the list endpoint); an empty journal yields ``[]`` — the
    frontend dropdown just stays empty (spec §7).
    """
    return await list_audit_log_authors(db_session=session)
