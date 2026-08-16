"""Shared Pydantic schemas used across domains."""

from typing import Generic, TypeVar

from pydantic import BaseModel

ItemT = TypeVar("ItemT", bound=BaseModel)


class PaginatedResponse(BaseModel, Generic[ItemT]):
    """Paginated list response envelope."""

    items: list[ItemT]
    total: int
    page: int
    per_page: int
