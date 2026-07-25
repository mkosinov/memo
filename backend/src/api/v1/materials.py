"""FastAPI router for material CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.material import MaterialCreate, MaterialPatch, MaterialResponse, MaterialUpdate
from src.services.material import MaterialService, get_material_service

router = APIRouter(tags=["materials"])


@lru_cache
def _get_material_service() -> MaterialService:
    """Dependency factory returning a singleton MaterialService."""
    return get_material_service()


_ServiceDep = Annotated[MaterialService, Depends(_get_material_service)]


@router.get("", response_model=list[MaterialResponse])
async def list_materials(
    service: _ServiceDep,
    session: SessionDep,
) -> list[MaterialResponse]:
    """Return all active materials."""
    return await service.list(db_session=session)


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
) -> None:
    """Soft-delete a material (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=material_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MATERIAL_NOT_FOUND,
                message="Material not found",
            ).model_dump(),
        )
