"""Client-cabinet «my» read composites (GH #513 — spec §«Контракт API»).

Corridor 3 free functions (canon rule 8 / ADR 007 — the
``list_records_view`` precedent in ``services/record.py``): the /my
reads are owner-filtered display composites with no owning repository
of their own, so they live as free functions in this module (the
photos and payments composites of #513 join here in later tasks),
executed through the owner repo's ``list_custom`` row-tuple mechanics.

Owner scope: the session's ``users.client_id`` is the ONLY visibility
filter — a cardless account owns nothing (``None`` short-circuits to
an empty page; it must NEVER become ``client_id IS NULL`` and leak the
anonymous records). Sorting is fixed per spec: activity start DESC,
record id ASC; visits inside a record by id ASC. Visit prices are
creation-time snapshots (#357): visit ``custom_price`` when set, else
the stored ``price`` — the tariff is never consulted on read.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.models.activity import Activity
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.record import Record
from src.models.service import Service
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.repositories.generic import get_base_repository
from src.repositories.payment import get_payment_repository
from src.repositories.record import get_record_repository
from src.repositories.search import ids_in_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.my import (
    MyPaymentItem,
    MyPaymentRecordContext,
    MyPhotoItem,
    MyRecordItem,
    MyVisitItem,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.schemas.pagination import PaginationParams


async def list_my_records(
    db_session: AsyncSession,
    client_id: str | None,
    params: PaginationParams,
) -> PaginatedResponse[MyRecordItem]:
    """Return the client cabinet's own records page with visits (#513).

    The route passes the session's ``client_id`` (owner filter) and the
    bare ``PaginationParams`` brick; the inherited machine ``?id=``
    narrowing ANDs with the owner filter (a foreign id narrows to an
    empty page, never expands visibility). One page query (records +
    activity start/duration + service title) plus one batched
    visits-with-names query for the page's records — no N+1.
    """
    if client_id is None:
        # Cardless account: owns nothing. Explicit empty page — the
        # naive ``Record.client_id == None`` would match the anonymous
        # records instead.
        return PaginatedResponse(
            items=[], total=0, page=params.page, per_page=params.per_page,
        )

    service_title = (
        select(Service.title)
        .where(Activity.service_id == Service.id)
        .correlate(Activity)
        .scalar_subquery()
    )
    stmt = (
        select(
            Record.id.label("record_id"),
            Record.comment,
            Activity.start.label("activity_start"),
            Activity.duration,
            service_title.label("service_title"),
        )
        .join(Activity, Record.activity_id == Activity.id)
        .where(Record.client_id == client_id)
    )
    id_pred = ids_in_predicate(Record.id, params.id)
    if id_pred is not None:
        stmt = stmt.where(id_pred)

    rows, total = await get_record_repository().list_custom(
        db_session,
        stmt,
        # Fixed sort per spec: activity start DESC, record id ASC —
        # the tie-break keeps page boundaries deterministic.
        order_by=[Activity.start.desc(), Record.id.asc()],
        limit=params.per_page,
        offset=(params.page - 1) * params.per_page,
    )

    # One batched read of the page's visits with resolved visitor names
    # (LEFT JOIN — an anonymous seat keeps ``visitor_name = None``).
    visits_by_record: dict[str, list[MyVisitItem]] = {}
    record_ids = [row.record_id for row in rows]
    if record_ids:
        visit_rows = (
            await db_session.execute(
                select(Visit, Visitor.name)
                .outerjoin(Visitor, Visit.visitor_id == Visitor.id)
                .where(Visit.record_id.in_(record_ids))
                .order_by(Visit.id.asc())
            )
        ).all()
        for visit, visitor_name in visit_rows:
            visits_by_record.setdefault(visit.record_id, []).append(
                MyVisitItem(
                    id=visit.id,
                    visitor_name=visitor_name,
                    status=visit.status,
                    # Snapshot (#357): custom_price wins, else the stored
                    # price — the tariff is never consulted.
                    price=(
                        visit.custom_price
                        if visit.custom_price is not None
                        else visit.price
                    ),
                )
            )

    items = [
        MyRecordItem(
            id=row.record_id,
            activity_date=row.activity_start.date(),
            activity_start=row.activity_start.time(),
            activity_end=(
                row.activity_start + timedelta(minutes=row.duration)
            ).time(),
            service_title=row.service_title,
            comment=row.comment,
            visits=visits_by_record.get(row.record_id, []),
        )
        for row in rows
    ]
    return PaginatedResponse(
        items=items, total=total, page=params.page, per_page=params.per_page,
    )


async def list_my_photos(
    db_session: AsyncSession,
    client_id: str | None,
    params: PaginationParams,
) -> PaginatedResponse[MyPhotoItem]:
    """Return the client cabinet's own photos page (#513).

    ALL the client's photos regardless of publicity (the public
    gallery's ``is_public=true`` filter does NOT apply here — the
    cabinet is the owner's private view). Owner filter = the session's
    ``users.client_id``; owner-less photos (``client_id NULL``, legal
    per domain) belong to no one and never appear — a cardless account
    short-circuits to an empty page (the Task 1 pattern). Fixed sort:
    ``created_at`` DESC, id ASC (the deterministic tie-break canon).
    Tags resolve to NAMES via ``selectinload`` (one batched query, no
    N+1; names sorted for a stable wire).
    """
    if client_id is None:
        return PaginatedResponse(
            items=[], total=0, page=params.page, per_page=params.per_page,
        )

    stmt = (
        select(Photo)
        .options(selectinload(Photo.tags))
        .where(Photo.client_id == client_id)
    )
    id_pred = ids_in_predicate(Photo.id, params.id)
    if id_pred is not None:
        stmt = stmt.where(id_pred)

    photos, total = await get_base_repository().list_entity(
        db_session,
        stmt,
        order_by=[Photo.created_at.desc(), Photo.id.asc()],
        limit=params.per_page,
        offset=(params.page - 1) * params.per_page,
    )
    items = [
        MyPhotoItem(
            id=photo.id,
            filename=photo.filename,
            is_public=bool(photo.is_public),
            tags=sorted(tag.title for tag in photo.tags),
            created_at=photo.created_at,
        )
        for photo in photos
    ]
    return PaginatedResponse(
        items=items, total=total, page=params.page, per_page=params.per_page,
    )


async def list_my_payments(
    db_session: AsyncSession,
    client_id: str | None,
    params: PaginationParams,
) -> PaginatedResponse[MyPaymentItem]:
    """Return the client cabinet's own payments page (#513).

    Ownership is THROUGH the record: a payment is "mine" iff its record
    belongs to the session's client (``Record.client_id``) — payments of
    client-less records belong to no one and never appear; a cardless
    account short-circuits to an empty page (the Task 1 pattern). Each
    item carries the brief record context (``{id, activity_date,
    service_title}``) that is ALWAYS present (``record_id`` is a
    mandatory FK, payments die with the record). Fixed sort:
    ``created_at`` DESC, id ASC (the deterministic tie-break canon).
    """
    if client_id is None:
        return PaginatedResponse(
            items=[], total=0, page=params.page, per_page=params.per_page,
        )

    service_title = (
        select(Service.title)
        .where(Activity.service_id == Service.id)
        .correlate(Activity)
        .scalar_subquery()
    )
    stmt = (
        select(
            Payment.id.label("payment_id"),
            Payment.amount,
            Payment.method,
            Payment.created_at,
            Record.id.label("record_id"),
            Activity.start.label("activity_start"),
            service_title.label("service_title"),
        )
        .join(Record, Payment.record_id == Record.id)
        .join(Activity, Record.activity_id == Activity.id)
        .where(Record.client_id == client_id)
    )
    id_pred = ids_in_predicate(Payment.id, params.id)
    if id_pred is not None:
        stmt = stmt.where(id_pred)

    rows, total = await get_payment_repository().list_custom(
        db_session,
        stmt,
        order_by=[Payment.created_at.desc(), Payment.id.asc()],
        limit=params.per_page,
        offset=(params.page - 1) * params.per_page,
    )
    items = [
        MyPaymentItem(
            id=row.payment_id,
            amount=row.amount,
            method=row.method,
            created_at=row.created_at,
            record=MyPaymentRecordContext(
                id=row.record_id,
                activity_date=row.activity_start.date(),
                service_title=row.service_title,
            ),
        )
        for row in rows
    ]
    return PaginatedResponse(
        items=items, total=total, page=params.page, per_page=params.per_page,
    )
