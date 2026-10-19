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

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from src.auth.permissions import require_admin
from src.db import SessionDep
from src.schemas.audit_log import (
    AuditLogAuthorResponse,
    AuditLogListParams,
    AuditLogResponse,
)
from src.schemas.common import PaginatedResponse
from src.services.audit_log import list_audit_log_authors, list_audit_logs

router = APIRouter(
    tags=["audit-logs"],
    # GH #344 (spec §6): the journal is admin-only, both routes.
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=PaginatedResponse[AuditLogResponse])
async def get_audit_logs(
    session: SessionDep,
    # GH #371 §4.1: one model-as-query entry — no scalar query siblings
    # (fastapi PR #12481). The brick carries page/per_page + the ``id``
    # set filter (#232 — ``?id=`` starts working here, §4.3 gap 3); the
    # six former scalar filters ride along 1:1 (annotations kept).
    params: Annotated[AuditLogListParams, Query()],
) -> PaginatedResponse[AuditLogResponse]:
    """Return a page of journal rows — ``created_at DESC`` (spec §6).

    Conjunctive filters: author (``user_id``), ``action``, ``entity``,
    ``entity_id``, whole-day period (``date_from`` from 00:00:00
    inclusive, ``date_to`` through the end of the day — the shared
    ``day_range`` canon, same semantics as the payments/records lists).
    ``id`` (GH #232/#371): repeated ``?id=`` keys narrow the page to the
    given UUID set — conjunctive with every filter above (narrowing
    never expands visibility), ≤100 distinct after dedup, garbage → 422.
    ``user.label`` is resolved in the SAME query (users ⟕ staff) — no
    N+1 over journal rows; ``user_role`` is the row's role snapshot,
    never the live users.role.
    """
    return await list_audit_logs(
        db_session=session,
        page=params.page,
        per_page=params.per_page,
        ids=params.id,
        user_id=params.user_id,
        action=params.action,
        entity=params.entity,
        entity_id=params.entity_id,
        date_from=params.date_from,
        date_to=params.date_to,
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
