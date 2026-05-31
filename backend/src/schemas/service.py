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
    max_age: int
    duration: int
    record_info: str
    material_hint: str | None = None


class ServiceCreate(ServiceBase):
    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []


class ServiceUpdate(ServiceBase):
    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []


class ServiceResponse(ServiceBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
    tariffs: list[TariffResponse] = []
    tags: list[TagResponse] = []
