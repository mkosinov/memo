"""Shared search result schemas."""

from pydantic import BaseModel


class VisitorSearchResult(BaseModel):
    """Search result for visitor lookup."""
    id: str
    name: str
    age: int | None = None


class ServiceSearchResult(BaseModel):
    """Search result for service lookup."""
    id: str
    title: str


class ActivitySearchResult(BaseModel):
    """Search result for activity lookup."""
    id: str
    start: str  # ISO format
    service_title: str
