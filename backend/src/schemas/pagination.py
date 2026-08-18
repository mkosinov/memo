"""Shared pagination query parameters (GH #206)."""

from pydantic import BaseModel, Field


class PaginationParams(BaseModel):
    """page/per_page query params for list endpoints.

    Injected in routers as ``pagination: PaginationParams = Depends()``
    (Depends, not ``Annotated[..., Query()]``: a query-param model cannot
    coexist with other scalar query params in one handler — fastapi PR
    #12481 — and 8 of 9 list routers mix pagination with filters/sort).
    """

    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
