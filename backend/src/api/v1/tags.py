"""FastAPI router for tag CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.deletion import (
    ResolutionError,
    collect_dependencies,
    collect_dependency_ids,
    stale_expected_entities,
)
from src.domain.errors import BareListLimitExceededError
from src.errors import ErrorCode, ErrorDetail
from src.models.tag import Tag
from src.schemas.common import PaginatedResponse, SortOrder
from src.schemas.pagination import PaginationParams
from src.schemas.tag import (
    TagCreate,
    TagDeleteBody,
    TagPatch,
    TagResponse,
    TagSortBy,
)
from src.services.tag import TagService, get_tag_service

router = APIRouter(tags=["tags"])


@lru_cache
def _get_tag_service() -> TagService:
    """Dependency factory returning a singleton TagService."""
    return get_tag_service()


_ServiceDep = Annotated[TagService, Depends(_get_tag_service)]

# GH #247 (spec §3.7): every mutating route carries tags:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("tags:write")),
    Depends(verify_fetch_metadata),
]
_READ_GUARD = [Depends(require_permission("tags:read"))]

# Sort whitelist map: UI key → list of ORM columns (#205 Task 3, spec §4.5).
# Tags have a single sortable column: ``title`` (#172 renamed ``tag``).
_TAG_SORT_MAP: dict[str, list] = {
    "title": [Tag.title],
}


def _tag_order_by(sort_by: TagSortBy | None, sort_order: SortOrder) -> list:
    """Build the ``order_by`` list for GET /api/v1/tags.

    * ``sort_by=None`` → spec §4.4 default: ``title ASC, id ASC`` (NEW —
      tags had no order_by before #205).
    * User sort → mapped columns with nulls-first (asc) / nulls-last (desc),
      then ``id ASC`` tiebreak (records idiom).
    """
    if sort_by is None:
        return [asc(Tag.title), asc(Tag.id)]
    cols = _TAG_SORT_MAP[sort_by]
    ordered = [
        c.desc().nullslast() if sort_order == "desc" else c.asc().nullsfirst()
        for c in cols
    ]
    return [*ordered, asc(Tag.id)]


@router.get("", response_model=PaginatedResponse[TagResponse])
async def list_tags(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    sort_by: TagSortBy | None = Query(None),
    sort_order: SortOrder = Query("asc"),
    q: str | None = Query(None, min_length=2, max_length=100),
) -> PaginatedResponse[TagResponse]:
    """Return all tags, paginated.

    ``sort_by`` selects a whitelisted sort key (spec §4.5); ``sort_order``
    is ``asc`` (default) or ``desc``. Unknown ``sort_by`` → 422 via Literal
    validation. ``sort_by=None`` → spec §4.4 default order (``title ASC,
    id ASC``). Tags are non-archive (no ``status`` param).

    ``q`` (GH #212): case-insensitive substring on ``title`` OR exact id
    equality for a full UUID; ``total`` reflects the filtered count.
    len<2 / len>100 → 422 VALIDATION_ERROR.
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        order_by=_tag_order_by(sort_by, sort_order),
        q=q,
    )


@router.get("/all", response_model=list[TagResponse], dependencies=_READ_GUARD)
async def list_all_tags(
    service: _ServiceDep,
    session: SessionDep,
) -> list[TagResponse]:
    """Return all tags as a bare JSON array (GH #205).

    Unpaginated, capped by ``BARE_LIST_MAX_ROWS`` (1000). Sorted by
    ``title ASC, id ASC`` (spec §4.4). Tags are non-archive (hard-delete
    only) — no ``status`` param.
    """
    try:
        return await service.list_all(
            db_session=session,
            order_by=[asc(Tag.title), asc(Tag.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Return a single tag by ID."""
    tag = await service.get(db_session=session, id=tag_id)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag


@router.post("", response_model=TagResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_tag(
    data: TagCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Create a new tag."""
    return await service.create(db_session=session, data=data)


@router.put("/{tag_id}", response_model=TagResponse, dependencies=_WRITE_GUARD)
async def update_tag(
    tag_id: str,
    data: TagCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Full-update a tag by ID."""
    tag = await service.update(db_session=session, id=tag_id, data=data)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag


@router.patch("/{tag_id}", response_model=TagResponse, dependencies=_WRITE_GUARD)
async def patch_tag(
    tag_id: str,
    data: TagPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Partial-update a tag by ID (PATCH)."""
    tag = await service.patch(db_session=session, id=tag_id, data=data)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag


def _dependencies_response(deps: list, detail: str) -> JSONResponse:
    """The unified 409 preview payload: ``{detail, dependencies}``.

    Mirror of the records/activities routes' builder (#285/#286; same
    pinned shape). ``detail`` distinguishes the two 409s of the
    deferred-delete contract (#318 D2): ``has_dependencies`` (dry-run
    preview) and ``stale_dependencies`` (commit-time expected mismatch).
    The ``dependencies`` array is ``DependencyNode`` dumps — for a tag
    the tree spans all 8 join deps (counters + per-parent ``items``,
    D6); optional-None node fields are OMITTED (``exclude_none``),
    non-optional fields always serialize.
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": detail,
            "dependencies": [d.model_dump(exclude_none=True) for d in deps],
        },
    )


@router.delete("/{tag_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_tag(
    tag_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[TagDeleteBody | None, Body()] = None,
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
) -> None:
    """Unified delete contract — dry-run preview flag / commit body
    (#318 D2, one-to-one mirror of the records route / #285 rev7-rev9).

    The legacy bare hard delete (silent unlinking from up to 8 kinds of
    objects) is REMOVED. Tag deps — all 8 join tables — are cascade and
    NON-auto (D1): the preview shows them with per-parent items (D6),
    the commit verifies every confirmed id-set (no auto exemptions), and
    execution is ``TagService.resolve_delete`` (the ``GenericService``
    executor lifted in Task 1 — resolutions validation and the join-row
    cascade live there, in ONE transaction with this route's reads on
    the same request session).

    * ``?dry_run=true`` — PURE preview (never touches rows, no SSE):
      existence probe → missing → 404; present → ``collect_dependencies``
      → empty → 204 WITHOUT deleting; non-empty → 409 + dependency tree.
      Combined with a ``resolutions`` body → 422
      ``dry_run_with_resolutions_forbidden`` (checked before the
      existence probe); an expected-only body is silently ignored.
    * No body, no flag → 422 ``{"detail": "expected_state_required"}``
      (rev7): every real deletion must declare its state; rejected
      before any DB access — the form check precedes the probe, so an
      unknown id still gets 422, not 404. Same for a body whose
      ``expected`` is absent (``{"resolutions": {...}}`` alone — the
      rejected legacy shape).
    * Body ``{resolutions?, expected}`` — the deferred-delete commit:
      existence probe → ``collect_dependencies`` → expected id-set
      verification (subset semantics #285 rev8: ``set(now_ids) ⊆
      set(expected[entity])`` for every collected dep — all 8 are
      non-auto, no exemptions; a dep that disappeared in the undo window
      does not block, one that APPEARED does) → mismatch → 409
      ``stale_dependencies`` + current tree. Only on a match →
      ``resolve_delete`` (validates resolutions — ``ResolutionError`` →
      422 — then cascades the join rows and hard-deletes the tag) → 204;
      missing id → 404 ``TAG_NOT_FOUND``.
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

    # Existence probe (tags are an admin-only dictionary — no master
    # scope; the same repository-get the other tag routes use). The
    # dry-run branch MUST 404 on a missing id instead of previewing an
    # empty tree.
    tag = await service.get(db_session=session, id=tag_id)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )

    if dry_run:
        deps = await collect_dependencies(session, Tag, tag_id)
        if deps:
            return _dependencies_response(deps, detail="has_dependencies")
        return  # 204 — preview only: no resolve_delete, no SSE marks.

    # Body branch: the commit of the deferred delete. Expected id-set
    # verification FIRST (fail-closed) — a stale commit must 409 BEFORE
    # the resolutions validation inside resolve_delete could turn it
    # into a 422, and before any join row is touched. Reads and the
    # @transactional executor share the request session — one
    # transaction (SQLite single-writer; #318 D2).
    deps = await collect_dependencies(session, Tag, tag_id)
    now_ids = await collect_dependency_ids(session, Tag, tag_id)
    if stale_expected_entities(Tag, now_ids, expected or {}):
        return _dependencies_response(deps, detail="stale_dependencies")

    # Match → execution by the generic executor (Task 1): re-collects
    # deps, validates resolutions (ResolutionError → 422), cascades the
    # 8 join tables via CASCADE_HANDLERS, hard-deletes the tag row.
    try:
        ok = await service.resolve_delete(
            db_session=session, id=tag_id, resolutions=resolutions or {},
        )
    except ResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
