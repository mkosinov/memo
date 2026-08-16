"""FastAPI router for material CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.material import Material
from src.schemas.common import PaginatedResponse, extract_resolutions
from src.schemas.material import MaterialCreate, MaterialPatch, MaterialResponse, MaterialUpdate
from src.services.material import MaterialService, get_material_service

router = APIRouter(tags=["materials"])


@lru_cache
def _get_material_service() -> MaterialService:
    """Dependency factory returning a singleton MaterialService."""
    return get_material_service()


_ServiceDep = Annotated[MaterialService, Depends(_get_material_service)]


@router.get("", response_model=PaginatedResponse[MaterialResponse])
async def list_materials(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> PaginatedResponse[MaterialResponse]:
    """Return materials filtered by archive status (default: active).

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.
    """
    return await service.list(
        db_session=session, page=page, per_page=per_page, status=status
    )


@router.get("/{material_id}", response_model=MaterialResponse)
async def get_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Return a single material by ID."""
    material = await service.get(db_session=session, id=material_id)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material


@router.post("", response_model=MaterialResponse, status_code=201)
async def create_material(
    data: MaterialCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Create a new material."""
    return await service.create(db_session=session, data=data)


@router.put("/{material_id}", response_model=MaterialResponse)
async def update_material(
    material_id: str,
    data: MaterialUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Full-update a material by ID (PUT, not PATCH)."""
    material = await service.update(db_session=session, id=material_id, data=data)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material


@router.patch("/{material_id}", response_model=MaterialResponse)
async def patch_material(
    material_id: str,
    data: MaterialPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Partial-update a material by ID (PATCH)."""
    material = await service.patch(db_session=session, id=material_id, data=data)
    if not material:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material


@router.delete("/{material_id}", status_code=204)
async def delete_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
    body: dict | None = Body(default=None),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body). Spec §2/§5/§6.

    Material has ZERO FK deps (spec §4 matrix): the no-body path always
    short-circuits to 204 (hard delete); the with-body path runs the
    executor with an empty resolution set (also 204).
    """
    # GH #207 §6: the execute body is {"resolutions": {...}} (api-client
    # sends it wrapped); a legacy bare dict is accepted too.
    resolutions = extract_resolutions(body)
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=material_id, resolutions=resolutions
            )
        except ResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.MATERIAL_NOT_FOUND,
                    message="Material not found",
                ).model_dump(),
            )
        return

    deps = await collect_dependencies(session, Material, material_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
    deleted = await service.delete(db_session=session, id=material_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )


@router.post("/{material_id}/archive", response_model=MaterialResponse)
async def archive_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Archive a material — flip ``is_active=False`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: true`` in the
    response schema) so the frontend updates the row without a refetch (spec
    §12 S5). Idempotent. Material has NO cross-entity cascade — only Master
    does (spec §4.2).
    """
    ok = await service.archive(db_session=session, id=material_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, material_id)


@router.post("/{material_id}/restore", response_model=MaterialResponse)
async def restore_material(
    material_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MaterialResponse:
    """Restore an archived material — flip ``is_active=True`` (spec §2/§14).

    Returns HTTP **200 with the re-fetched body** (``archived: false``). 404 if
    not found. Idempotent. No cross-entity cascade.
    """
    ok = await service.restore(db_session=session, id=material_id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return await _refetch_or_404(service, session, material_id)


async def _refetch_or_404(
    service: MaterialService, session: SessionDep, material_id: str
) -> MaterialResponse:
    """Re-fetch the material after a successful archive/restore (Task 11)."""
    material = await service.get(db_session=session, id=material_id)
    if material is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
    return material
