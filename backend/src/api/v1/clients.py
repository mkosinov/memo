"""FastAPI router for client CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from src.auth.permissions import (
    require_admin,
    require_permission,
    verify_fetch_metadata,
)
from src.auth.scope import ScopeContext, get_scope
from src.db import SessionDep
from src.domain.deletion import (
    DependencyNode,
    ResolutionError,
    StaleDependenciesError,
    collect_dependencies,
)
from src.errors import ErrorCode, ErrorDetail
from src.models.client import Client
from src.schemas.client import (
    ClientCreate,
    ClientDeleteBody,
    ClientListParams,
    ClientPatch,
    ClientResponse,
    ClientUpdate,
    ClientViewResponse,
)
from src.schemas.common import PaginatedResponse
from src.schemas.visitor import VisitorResponse
from src.services.client import ClientService, get_client_service, list_clients_view
from src.services.visitor import VisitorService, get_visitor_service
from src.usecases.clients import delete_client as delete_client_scenario

router = APIRouter(
    tags=["clients"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("clients:read"))],
)


@lru_cache
def _get_client_service() -> ClientService:
    """Dependency factory returning a singleton ClientService."""
    return get_client_service()


@lru_cache
def _get_visitor_service() -> VisitorService:
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[ClientService, Depends(_get_client_service)]

# GH #247 (spec §3.7): every mutating route carries clients:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("clients:write")),
    Depends(verify_fetch_metadata),
]
# GH #263 D7: master's clients:write is CREATE-ONLY — mutations of an
# EXISTING client (update/delete/archive/restore) stay admin-only. The
# clients:write token is kept on the guard stack too (admin passes both;
# the role check is what excludes master).
_ADMIN_WRITE_GUARD = [
    Depends(require_permission("clients:write")),
    Depends(require_admin),
    Depends(verify_fetch_metadata),
]
_VisitorServiceDep = Annotated[VisitorService, Depends(_get_visitor_service)]


@router.get("/get", response_model=ClientResponse)
async def get_client_by_phone(
    service: _ServiceDep,
    session: SessionDep,
    phone: str = Query(..., min_length=3),
    # GH #263 T3 (D4): the phone lookup is scope-free — ALL active studio
    # clients — but the scoped (master) response is still MASKED (D3):
    # the number is a search key, not response data.
    scope: ScopeContext = Depends(get_scope),
) -> ClientResponse:
    """Get an active client by exact phone (GH #212; was /clients/search)."""
    result = await service.list(
        db_session=session, phone=phone, master_key=scope.master_key
    )
    if not result.items:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return result.items[0]


@router.get("", response_model=PaginatedResponse[ClientViewResponse])
async def list_clients(
    session: SessionDep,
    # Annotated[..., Query()], not Depends(): FastAPI classifies
    # list-typed model fields (``id`` #232) as BODY params under the
    # Depends-with-model shape and silently drops them from the query
    # contract; the Query() shape exposes them (precedent: records,
    # photos). Safe here — no scalar query params in this handler
    # (fastapi PR #12481 mixing limitation).
    params: Annotated[ClientListParams, Query()],
    # GH #263 T3 (D1/D4): EXISTS-scope «есть запись клиента к своей
    # активности» for the plain list; ``?phone=`` searches studio-wide,
    # both paths masked for a scoped (master) caller (D3).
    scope: ScopeContext = Depends(get_scope),
) -> PaginatedResponse[ClientViewResponse]:
    """Return paginated clients with stats aggregation, filtering, and sorting."""
    return await list_clients_view(
        db_session=session, params=params, master_key=scope.master_key
    )


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T3 (D1): свой → 200 (masked), чужой → 404 — one scope-aware
    # query, indistinguishable from «не существует» (404-fast-path, T7).
    scope: ScopeContext = Depends(get_scope),
) -> ClientResponse:
    """Return a single client by ID."""
    client = await service.get_scoped(
        db_session=session, id=client_id, master_key=scope.master_key
    )
    if not client:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return client


@router.post("", response_model=ClientResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_client(
    data: ClientCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Create a new client."""
    return await service.create(db_session=session, data=data)


@router.put("/{client_id}", response_model=ClientResponse, dependencies=_ADMIN_WRITE_GUARD)
async def update_client(
    client_id: str,
    data: ClientUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Full-update a client by ID (PUT, not PATCH)."""
    client = await service.update(db_session=session, id=client_id, data=data)
    if not client:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return client


@router.patch("/{client_id}", response_model=ClientResponse, dependencies=_ADMIN_WRITE_GUARD)
async def patch_client(
    client_id: str,
    data: ClientPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Partial-update a client by ID (PATCH)."""
    client = await service.patch(db_session=session, id=client_id, data=data)
    if not client:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return client


@router.delete("/{client_id}", status_code=204, dependencies=_ADMIN_WRITE_GUARD)
async def delete_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[ClientDeleteBody | None, Body()] = None,
    dry_run: Annotated[
        bool | None,
        Query(
            description=(
                "Non-destructive preview: returns 204 without deleting "
                "(no deps) or 409 with the dependency tree; never "
                "modifies rows"
            )
        ),
    ] = None,
) -> Response:
    """Unified delete contract — dry-run preview flag / commit body
    (GH #345 §4.1, one-to-one mirror of the staff/tags/records family;
    the subset verification runs inside the ``delete_client`` scenario
    transaction, spec §4.5).

    The legacy no-body DELETE (execute-if-clean / silent dry-run) is
    REMOVED. Client deps per the FK matrix: ``records`` (nullify) +
    ``visitors`` (cascade) — the two NON-auto nodes carrying ``items``
    (the ``expected`` source; the visitors node also carries the
    ``cascade_preview`` visits counter) — plus AUTO deps (client_tags,
    photos — resolved automatically, exempt from the check). Per the
    §4.4 matrix Client is the ONLY entity with a resolvable commit.

    * ``?dry_run=true`` — PURE preview (never touches rows, no SSE):
      existence probe → missing → 404; present →
      ``collect_dependencies`` → empty → 204 WITHOUT deleting;
      non-empty → 409 + dependency tree. Combined with a
      ``resolutions`` body → 422
      ``dry_run_with_resolutions_forbidden`` (checked before the
      existence probe); an expected-only body is silently ignored.
    * No body, no flag → 422 ``{"detail": "expected_state_required"}``:
      every real deletion must declare its state; rejected before any
      DB access — the form check precedes the probe, so an unknown id
      still gets 422, not 404. Same for a body whose ``expected`` is
      absent (``{"resolutions": {...}}`` alone — the rejected legacy
      shape).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit.
      The ROUTE is transport only (spec §4.5): the subset verification
      AND execution live INSIDE the ``delete_client`` scenario's
      ``@transactional`` transaction (the ``delete_record``/`
      ``delete_staff`` mirror); this route maps
      ``StaleDependenciesError`` → 409 ``stale_dependencies`` +
      current tree, ``ResolutionError`` → 422, missing id → 404
      ``CLIENT_NOT_FOUND``, success → 204.
    """
    resolutions = body.resolutions if body is not None else None
    expected = body.expected if body is not None else None

    # Rev7 (#285) mirror: bare DELETE without the flag is a contract
    # violation — reject the request shape before any DB access. Literal
    # string detail (same flat shape as the 409 preview) → JSONResponse,
    # not raised: the global HTTPException handler wraps string details
    # into {code, message} — not the pinned contract.
    if not dry_run and expected is None:
        return JSONResponse(
            status_code=422,
            content={"detail": "expected_state_required"},
        )
    # Pure preview never carries resolutions — forbidden combination.
    # (An expected-only body IS allowed: silently ignored below.)
    if dry_run and resolutions is not None:
        return JSONResponse(
            status_code=422,
            content={"detail": "dry_run_with_resolutions_forbidden"},
        )

    # Existence probe. The dry-run branch MUST 404 on a missing id
    # instead of previewing an empty tree.
    client = await service.get(db_session=session, id=client_id)
    if not client:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Client, client_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return Response(status_code=204)  # preview only: no delete, no SSE marks.

    # Body branch: the commit of the deferred delete — the business
    # chain lives in the usecases scenario (spec §4.5): ONE
    # @transactional transaction owns BOTH the expected subset
    # verification and the execution (the ``delete_record`` mirror,
    # unlike the session-request routers of the dictionary entities);
    # the ROUTE keeps only transport — the 409 stale_dependencies
    # rendering, the 422 mapping, and 404.
    try:
        # Selfless-scenario call convention: the leading ``None``
        # occupies the wrapper's ``self`` slot (see usecases/clients.py).
        ok = await delete_client_scenario(  # type: ignore[misc]
            None,  # type: ignore[arg-type]
            db_session=session,
            id=client_id,
            resolutions=resolutions or {},
            expected=expected,
        )
    except StaleDependenciesError as exc:
        return _dependencies_response(exc.nodes, detail="stale_dependencies")
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return Response(status_code=204)  # the deferred-delete commit succeeded.


def _dependencies_response(deps: list[DependencyNode], detail: str) -> JSONResponse:
    """The unified 409 preview payload: ``{detail, dependencies}``.

    Mirror of the staff/tags/records/activities routes' builder (#285/
    #286/#318/#345; same pinned shape). ``detail`` distinguishes the
    two 409s of the deferred-delete contract (GH #345 §4.1):
    ``has_dependencies`` (dry-run preview) and ``stale_dependencies``
    (commit-time expected mismatch — rendered here from the
    ``StaleDependenciesError`` nodes the scenario raised inside its
    transaction). The ``dependencies`` array is ``DependencyNode``
    dumps — optional-None node fields are OMITTED (``exclude_none``);
    the Client tree carries counters AND items on its two non-auto
    nodes (records/visitors — the ``expected`` source, §4.3) plus the
    ``cascade_preview`` visits counter on the visitors node.
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.get("/{client_id}/visitors", response_model=list[VisitorResponse])
async def list_client_visitors(
    client_id: str,
    visitor_service: _VisitorServiceDep,
    session: SessionDep,
    # GH #263 T3-fix: the path client must be visible in the caller's
    # scope (чужой/missing → 404, one scope-aware query), and the
    # returned visitors carry the T2 visibility predicate — visitors
    # without visits on the master's records stay invisible. Admin
    # (master_key=None): unchanged, all visitors.
    scope: ScopeContext = Depends(get_scope),
) -> list[VisitorResponse]:
    """Return all visitors for a given client."""
    # GH #263 T3-fix (S7 admin regression): the visibility gate is a
    # MASTER-scope gate — apply it ONLY when the caller carries a scope
    # key (master incl. the empty-scope sentinel). Admin (master_key
    # None) keeps the pre-#263 contract byte-identical: the client_id is
    # taken as given (nonexistent → 200 []), no existence probe.
    if scope.master_key is not None:
        client = await _get_client_service().get_scoped(
            db_session=session, id=client_id, master_key=scope.master_key
        )
        if client is None:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.CLIENT_NOT_FOUND,
                    message="Client not found",
                ).model_dump(),
            )
    visitors = await visitor_service.list_by_client(
        db_session=session, client_id=client_id, master_key=scope.master_key
    )
    return [VisitorResponse.model_validate(v) for v in visitors]


@router.post("/{client_id}/archive", response_model=ClientResponse, dependencies=_ADMIN_WRITE_GUARD)
async def archive_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Archive a client — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` in the
    response schema) so the frontend updates the row without a refetch (spec
    §12 S5). Idempotent. Closes #198 (Client restore parity). Client has NO
    cross-entity cascade — only Master does (spec §4.2).
    """
    ok = await service.archive(db_session=session, id=client_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, client_id)


@router.post("/{client_id}/restore", response_model=ClientResponse, dependencies=_ADMIN_WRITE_GUARD)
async def restore_client(
    client_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ClientResponse:
    """Restore an archived client — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. No cross-entity cascade.
    """
    ok = await service.restore(db_session=session, id=client_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, client_id)


async def _refetch_or_404(
    service: ClientService, session: SessionDep, client_id: str
) -> ClientResponse:
    """Re-fetch the client after a successful archive/restore (Task 11)."""
    client = await service.get(db_session=session, id=client_id)
    if client is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return client
