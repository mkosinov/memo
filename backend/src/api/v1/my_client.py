"""Client-cabinet «my» surface — GET /api/v1/my/client (GH #499, spec §4.3).

A SEPARATE router from the staff ``src/api/v1/my.py``: that router binds
``require_session`` (the staff ``memo_session`` cookie) at the ROUTER
level, which would 401 every client session. Client routes hang off this
module behind ``require_client_session`` instead (cookie
``memo_client_session`` + ``role=client`` — spec §3), mounted under the
same ``/api/v1/my`` prefix. The #499 booking endpoint (spec §5) lives
here too.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
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
from src.schemas.my import MyClientResponse, MyRecordCreate, MyRecordResponse
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


@router.post(
    "/records",
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
