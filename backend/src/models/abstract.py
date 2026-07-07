"""Abstract base models: timestamps + optional soft-delete."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base


class AbstractModel(Base):
    """Base model with UUID PK and timestamps. No soft-delete flag."""
    __abstract__ = True

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
    )


class AbstractModelSoftDelete(AbstractModel):
    """Extends AbstractModel with a soft-delete flag (is_active)."""
    __abstract__ = True

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
