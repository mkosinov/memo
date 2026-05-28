"""Pydantic schemas for the system domain."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Response schema for the health check endpoint."""

    status: str
    db: str
