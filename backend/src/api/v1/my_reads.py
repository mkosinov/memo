"""Client-cabinet «my» READ surface — GET /api/v1/my/records (GH #513).

The read twin of ``my_client.py`` (the /my writes of #499/#523): the
same ``require_client_session`` guard (cookie ``memo_client_session``,
role ``client`` — a staff token copied into the client cookie is the
same 401 as no session), a deliberately thin router. The composition —
owner filter by the session's ``users.client_id``, fixed sorting,
snapshot visit prices — lives in ``services/my_reads.py`` (Corridor 3
free functions). The photos and payments lists (the other #513 read
endpoints) join this router in later tasks.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from src.auth.permissions import AuthedUser, require_client_session
from src.db import SessionDep
from src.schemas.common import PaginatedResponse
from src.schemas.my import MyRecordItem
from src.schemas.pagination import PaginationParams
from src.services.my_reads import list_my_records

router = APIRouter(tags=["my"])

_ClientUser = Annotated[AuthedUser, Depends(require_client_session)]


@router.get("/records", response_model=PaginatedResponse[MyRecordItem])
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
