"""Client-cabinet «my» surface — GET /api/v1/my/client (GH #499, spec §4.3).

A SEPARATE router from the staff ``src/api/v1/my.py``: that router binds
``require_session`` (the staff ``memo_session`` cookie) at the ROUTER
level, which would 401 every client session. Client routes hang off this
module behind ``require_client_session`` instead (cookie
``memo_client_session`` + ``role=client`` — spec §3), mounted under the
same ``/api/v1/my`` prefix. The #499 booking endpoint (spec §5) will join
this router.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select

from src.auth.permissions import AuthedUser, require_client_session
from src.db import SessionDep
from src.models.client import Client
from src.schemas.my import MyClientResponse

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
