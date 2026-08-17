"""Shared Pydantic schemas used across domains."""

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

ItemT = TypeVar("ItemT", bound=BaseModel)

# Sort direction for list endpoints (#205 Task 3). Shared across all
# dictionary list endpoints; per-entity sort_by whitelists live in their
# own schema modules.
SortOrder = Literal["asc", "desc"]


class PaginatedResponse(BaseModel, Generic[ItemT]):
    """Paginated list response envelope."""

    items: list[ItemT]
    total: int
    page: int
    per_page: int
