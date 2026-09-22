"""Free reading functions for the audit journal (GH #344 Task 5, spec §6).

Corridor 3 (``docs/domain-rules/service-layer.md`` rule 8): the journal
has NO service class and no repository — rows are written exclusively
by the accumulator inside ``@transactional`` (spec §4); this module
holds the free READING functions for the two admin endpoints. One
query per endpoint, author label resolved in the same select (users
⟕ staff) — no N+1 over journal rows.

Label canon (the journal-side precedent of the auth ``/me`` snapshot):
a linked staff card renders «Фамилия Имя» (last + first, the same
rendering as ``master_name`` in the records view); a cardless account
falls back to its phone; ``user_id`` nulled by a future user
hard-delete resolves to ``{id: None, label: None}`` — the row itself
stays.
"""

from datetime import date

from sqlalchemy import asc, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from src.domain.dates import day_range
from src.models.audit_log import AuditLog
from src.models.staff import Staff
from src.models.user import User
from src.schemas.audit_log import (
    AuditLogAuthorResponse,
    AuditLogResponse,
    AuditLogUserRef,
)
from src.schemas.common import PaginatedResponse


def _author_label() -> ColumnElement[str | None]:
    """Author label expression — staff card name, phone fallback.

    ``func.coalesce`` over the two candidate renderings: the linked
    staff card's «last first» (SQLite ``||`` with a NULL operand is
    NULL, so a half-filled card falls through whole), else the
    account's phone (NOT NULL — the chain always resolves).
    """
    card = Staff.last_name + " " + Staff.first_name
    return func.coalesce(card, User.phone)


async def list_audit_logs(
    db_session: AsyncSession,
    *,
    page: int = 1,
    per_page: int = 20,
    user_id: str | None = None,
    action: str | None = None,
    entity: str | None = None,
    entity_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> PaginatedResponse[AuditLogResponse]:
    """Return one page of journal rows — ``created_at DESC`` (spec §6).

    ONE ``select(AuditLog)`` with ``outerjoin(User)`` +
    ``outerjoin(Staff)``: the author reference (``{id, label}``) rides
    the same query — no N+1. The joins are OUTER on purpose:
    ``user_id`` is nullable (ON DELETE SET NULL), and a nulled author
    must NOT drop its journal row — the reference simply empties
    (``{id: None, label: None}``). Conjunctive filters (each ``None``
    → no predicate): author, action, entity, entity_id, whole-day
    period via the shared ``day_range`` canon (same semantics as
    payments/records). ``id`` is the secondary sort key so equal
    timestamps stay stable across pages. Count runs on the unordered
    statement (the ``list_custom`` precondition, kept here).
    """
    stmt = (
        select(
            AuditLog,
            User.id.label("user_ref_id"),
            _author_label().label("user_label"),
        )
        .outerjoin(User, AuditLog.user_id == User.id)
        .outerjoin(Staff, User.staff_id == Staff.id)
    )
    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if action is not None:
        stmt = stmt.where(AuditLog.action == action)
    if entity is not None:
        stmt = stmt.where(AuditLog.entity == entity)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    from_dt, to_dt = day_range(date_from, date_to)
    if from_dt is not None:
        stmt = stmt.where(AuditLog.created_at >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(AuditLog.created_at <= to_dt)

    total = (
        await db_session.execute(
            select(func.count()).select_from(stmt.subquery())
        )
    ).scalar_one()
    rows = (
        await db_session.execute(
            stmt.order_by(desc(AuditLog.created_at), desc(AuditLog.id))
            .limit(per_page)
            .offset((page - 1) * per_page)
        )
    ).all()
    items = [
        AuditLogResponse(
            id=log.id,
            created_at=log.created_at,
            user=AuditLogUserRef(id=ref_id, label=label),
            user_role=log.user_role,
            action=log.action,
            entity=log.entity,
            entity_id=log.entity_id,
            entity_label=log.entity_label,
            changes=log.changes,
        )
        for log, ref_id, label in rows
    ]
    return PaginatedResponse(
        items=items, total=total, page=page, per_page=per_page
    )


async def list_audit_log_authors(
    db_session: AsyncSession,
) -> list[AuditLogAuthorResponse]:
    """Return the journal's distinct authors ``[{user_id, label}]``.

    ONE query over the journal's users join: the INNER ``AuditLog`` join
    pins membership (only users actually present in the journal — an
    authorless row never had one), the ``GROUP BY User.id`` collapses
    duplicates, ``label`` reuses the list endpoint's rendering. Sorted
    by label for a stable dropdown.
    """
    label = _author_label().label("user_label")
    stmt = (
        select(User.id, label)
        .outerjoin(Staff, User.staff_id == Staff.id)
        .join(AuditLog, AuditLog.user_id == User.id)
        .group_by(User.id, Staff.last_name, Staff.first_name, User.phone)
        .order_by(asc(label))
    )
    rows = (await db_session.execute(stmt)).all()
    return [
        AuditLogAuthorResponse(user_id=row.id, label=row.user_label)
        for row in rows
    ]
