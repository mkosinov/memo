"""Client branch of the «my» tree — ``/api/v1/my/client/*`` (GH #584,
ADR-015 spec §4.2; contracts #499/#513).

The ONE router of the client branch, merged from the former
``my_client.py`` (writes) + ``my_reads.py`` (reads) when the cabinet
moved under the ``/my/client/*`` prefix. A SEPARATE router from the
staff ``src/api/v1/my.py``: that router binds ``require_session`` (the
staff ``memo_session`` cookie) at the ROUTER level, which would 401
every client session. Every route here hangs behind
``require_client_session`` (cookie ``memo_client_session`` + role
``client`` — spec §3) instead, mounted under the same ``/api/v1/my``
prefix.

The read composition — owner filter by the session's
``users.client_id``, fixed sorting, snapshot visit prices — lives in
``services/my_reads.py`` (Corridor 3 free functions); the #499 booking
scenario in ``usecases/my_booking.py``.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from src.auth.permissions import (
    AuthedUser,
    require_client_session,
    verify_fetch_metadata,
    verify_origin,
)
from src.db import SessionDep
from src.domain.errors import PhoneInvalidError
from src.domain.phones import validate_phone
from src.errors import ErrorCode, ErrorDetail
from src.models.client import Client
from src.schemas.common import PaginatedResponse
from src.schemas.my import (
    MyClientResponse,
    MyPaymentItem,
    MyPhotoItem,
    MyRecordCreate,
    MyRecordItem,
    MyRecordResponse,
)
from src.schemas.pagination import PaginationParams
from src.services.my_reads import list_my_payments, list_my_photos, list_my_records
from src.usecases.my_booking import create_my_record as create_my_record_scenario

router = APIRouter(tags=["my"])

# Spec §4.3: the client cabinet is guarded by the FACT of a client
# session — no permission token (the client role holds none by design).
_ClientUser = Annotated[AuthedUser, Depends(require_client_session)]


@router.get("/client", response_model=MyClientResponse)
async def get_my_client(
    authed: _ClientUser,
    db_session: SessionDep,
) -> MyClientResponse:
    """``{phone, name}`` — the client's own phone + card name (#499 §4.3).

    The name comes from the linked client card via ``users.client_id``,
    read REGARDLESS of the card's archive flag — the spec §3 invariant:
    archiving a card is not an account event (the link survives, the
    owner is the ACCOUNT), so the cabinet keeps its answer. No card (or
    a nameless card) → ``name: null``.
    """
    name: str | None = None
    if authed.client_id is not None:
        name = (
            await db_session.execute(
                select(Client.name).where(Client.id == authed.client_id)
            )
        ).scalar_one_or_none()
    return MyClientResponse(phone=authed.phone, name=name)


@router.get("/client/records", response_model=PaginatedResponse[MyRecordItem])
async def get_my_records(
    authed: _ClientUser,
    db_session: SessionDep,
    params: Annotated[PaginationParams, Query()],
) -> PaginatedResponse[MyRecordItem]:
    """Own records with visits (spec §«Контракт API → GET /my/records»).

    The owner is the session's client card; the input is the bare
    ``PaginationParams`` brick (``page``/``per_page`` + the machine
    ``?id=`` narrowing, which ANDs with the owner filter); sorting is
    fixed (activity start DESC, id ASC — no sort params); visit price
    is the creation-time snapshot, never the tariff (#357).
    """
    return await list_my_records(
        db_session=db_session, client_id=authed.client_id, params=params
    )


@router.post(
    "/client/records",
    response_model=MyRecordResponse,
    status_code=201,
    # CSRF posture (spec §5): an AUTHENTICATED mutation — the staff
    # Sec-Fetch-Site line (same as the /my profile writes) + the Origin
    # check against the CORS list when the header is present (the OTP
    # endpoints' verify_origin).
    dependencies=[Depends(verify_fetch_metadata), Depends(verify_origin)],
)
async def create_my_record(
    payload: MyRecordCreate,
    authed: _ClientUser,
    db_session: SessionDep,
) -> MyRecordResponse:
    """Book from the web form under a client session (#499 §5).

    The owner is the SESSION's client card (never the wire), visit prices
    are computed server-side from the service's tariffs, and the wire is
    strict (``MyRecordCreate`` extra=forbid). ``phone`` is the record's
    contact phone — domain validation only (422 ``PHONE_INVALID``), it
    never resolves the client. Inherited from the reused creation
    scenario: 404 activity, 409 capacity. Soft anti-spam: 20 records /
    40 visits per account per 15 min → 429.
    """
    try:
        validate_phone(payload.phone)
    except PhoneInvalidError as exc:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.PHONE_INVALID,
                message=str(exc),
            ).model_dump(),
        ) from exc
    return await create_my_record_scenario(
        db_session=db_session, data=payload, owner=authed,
    )


@router.get("/client/photos", response_model=PaginatedResponse[MyPhotoItem])
async def get_my_photos(
    authed: _ClientUser,
    db_session: SessionDep,
    params: Annotated[PaginationParams, Query()],
) -> PaginatedResponse[MyPhotoItem]:
    """All the client's photos regardless of publicity (spec §«Контракт
    API → GET /my/photos»).

    The owner is the session's client card; the input is the bare
    ``PaginationParams`` brick (``?id=`` narrowing ANDs with the owner
    filter); sorting is fixed (``created_at`` DESC, id ASC); tags
    resolve server-side to names (string[]).
    """
    return await list_my_photos(
        db_session=db_session, client_id=authed.client_id, params=params
    )


@router.get("/client/payments", response_model=PaginatedResponse[MyPaymentItem])
async def get_my_payments(
    authed: _ClientUser,
    db_session: SessionDep,
    params: Annotated[PaginationParams, Query()],
) -> PaginatedResponse[MyPaymentItem]:
    """Payments of the client's records (spec §«Контракт API →
    GET /my/payments»).

    Ownership is THROUGH the record (a payment is "mine" iff its record
    belongs to the session's client); each item carries the brief
    always-present record context ``{id, activity_date,
    service_title}``; sorting is fixed (``created_at`` DESC, id ASC);
    ``method`` is nullable (``null`` → «Способ не указан»).
    """
    return await list_my_payments(
        db_session=db_session, client_id=authed.client_id, params=params
    )
