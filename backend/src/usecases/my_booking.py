"""Client booking scenario — ``POST /api/v1/my/records`` (#499 §5, Task 5).

The session-based branch of the record-creation scenario (Corridor 2
neighbor of ``usecases/records.create_record``). Two deliberate deltas
from the public ``POST /api/v1/records`` flow (spec §5):

1. the client is FIXED by the session — the owner is the account's
   ``client_id`` link (``AuthedUser``), never a phone-flow lookup or a
   wire-supplied ``client_id``;
2. the visit prices are computed SERVER-side: all tariffs of the
   activity's service load in ONE query; a service WITH tariffs requires
   ``tariff_id`` on every visit (422 ``TARIFF_REQUIRED`` — a zero price
   of a paid service is unreachable), a foreign tariff is 422
   ``TARIFF_NOT_FOUND``; a service WITHOUT tariffs books at price 0
   («Стоимость уточняется», US-2).

Everything else is INHERITED by reusing the existing ``create_record``
scenario (same transactional record + visits write): the capacity check
(409), the derived seats/status, the anonymous-visit semantics, the
audit row, and the ``new_record`` domain event. The soft anti-spam
(20 records / 40 visits per account per 15 min — the auth counter
store) gates BEFORE any DB work and registers ONLY on success.

NOT ``@transactional`` itself: the reused scenario owns the single
transaction + event batch; this module only pre-checks (reads) and
post-registers (in-memory counters).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import select

from src.auth.service import booking_spam_gate, register_booking
from src.errors import ErrorCode, ErrorDetail
from src.models.activity import Activity
from src.models.tariff import Tariff
from src.schemas.my import MyRecordCreate, MyRecordResponse, MyVisitResponse
from src.schemas.record import RecordCreate, VisitItem
from src.usecases.records import create_record as create_record_scenario

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.auth.permissions import AuthedUser
    from src.models.record import Record


def _tariff_error(code: ErrorCode, message: str) -> HTTPException:
    """422 — the server-side price contract (#499 §5)."""
    return HTTPException(
        status_code=422,
        detail=ErrorDetail(code=code, message=message).model_dump(),
    )


async def create_my_record(
    db_session: AsyncSession,
    data: MyRecordCreate,
    owner: AuthedUser,
) -> MyRecordResponse:
    """Book from the web form under a client session (spec §5).

    Step order: anti-spam gate → activity probe (404; also yields the
    service key + ``start``) → ONE tariff query for the service →
    server-side price validation/computation → the reused
    ``create_record`` scenario (capacity 409, visitors, seats/status,
    audit, domain event — one transaction) → register the counters on
    success. The response echoes the wire's ``name``/``age`` in order,
    paired with the persisted ``tariff_id``/``price``.
    """
    gate = booking_spam_gate(owner.id, len(data.visits))
    if gate is not None:
        raise gate

    # ── Activity probe: 404 + the service key + the response `start` ──
    activity = (
        await db_session.execute(select(Activity).where(Activity.id == data.activity_id))
    ).scalar_one_or_none()
    if activity is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )

    # ── ONE tariff query for the activity's service (active rows) ─────
    tariffs: dict[str, Tariff] = {
        t.id: t
        for t in (
            await db_session.execute(
                select(Tariff).where(
                    Tariff.service_id == activity.service_id,
                    Tariff.is_active,
                )
            )
        ).scalars()
    }

    # ── Server-side price: tariff → price; no tariffs → 0 (US-2) ──────
    prices: list[int] = []
    for visit in data.visits:
        if not tariffs:
            if visit.tariff_id is not None:
                # Any tariff is foreign to a tariff-free service.
                raise _tariff_error(
                    ErrorCode.TARIFF_NOT_FOUND, "Тариф не найден"
                )
            prices.append(0)
            continue
        if visit.tariff_id is None:
            # Paid service: a zero price is unreachable by contract.
            raise _tariff_error(
                ErrorCode.TARIFF_REQUIRED, "Выберите тариф для каждого места"
            )
        tariff = tariffs.get(visit.tariff_id)
        if tariff is None:
            raise _tariff_error(
                ErrorCode.TARIFF_NOT_FOUND, "Тариф не найден"
            )
        prices.append(tariff.price)

    # ── The existing creation scenario — checks inherited explicitly ──
    # phone=None: no find-or-create — the owner is fixed by the session.
    # notify=False: this branch never opts into mailings (§5); the
    # session DOES stage an audit actor, so the flag must be forced off.
    record: Record = await create_record_scenario(
        db_session=db_session,
        data=_to_record_create(data, owner, prices),
    )

    register_booking(owner.id, len(data.visits))

    return MyRecordResponse(
        id=record.id,
        activity_id=record.activity_id,
        start=activity.start,
        comment=record.comment,
        visits=[
            MyVisitResponse(
                name=visit.name,
                age=visit.age,
                tariff_id=visit.tariff_id,
                price=price,
            )
            for visit, price in zip(data.visits, prices, strict=True)
        ],
    )


def _to_record_create(
    data: MyRecordCreate, owner: AuthedUser, prices: list[int]
) -> RecordCreate:
    """``MyRecordCreate`` → the strict ``RecordCreate`` the reused scenario takes.

    Only server-owned values: the session's card as the client, computed
    prices, the waiting status default. No wire field passes through
    beyond activity/comment/name/age/tariff_id.
    """
    return RecordCreate(
        activity_id=data.activity_id,
        phone=None,
        client_id=owner.client_id,
        comment=data.comment,
        custom_price=None,
        notify=False,
        visits=[
            VisitItem(
                name=visit.name,
                age=visit.age,
                visitor_id=None,
                tariff_id=visit.tariff_id,
                price=price,
            )
            for visit, price in zip(data.visits, prices, strict=True)
        ],
    )
