"""Pydantic schemas for the services domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    tag: str


class TariffBase(BaseModel):
    title: str
    description: str | None = None
    price: int


class TariffCreate(TariffBase):
    pass


class TariffUpdate(TariffBase):
    pass


class TariffResponse(TariffBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    service_id: str


class ServiceBase(BaseModel):
    title: str
    description: str
    image_url: str
    specialty: str
    min_age: int
    max_age: int | None = None
    duration: int
    record_info: str
    material_hint: str | None = None


class ServiceCreate(ServiceBase):
    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []


class ServiceUpdate(ServiceBase):
    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []


class ServicePatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/services/{id}).
    All fields optional. None means 'don't change'.

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    ``tariffs``: NOT included — managed via PUT only (see #171 for TariffService extraction).
    """
    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    specialty: str | None = None
    min_age: int | None = None
    max_age: int | None = None
    duration: int | None = None
    record_info: str | None = None
    material_hint: str | None = None
    tag_ids: list[str] | None = None


class ServiceResponse(ServiceBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
    tariffs: list[TariffResponse] = []
    tags: list[TagResponse] = []
