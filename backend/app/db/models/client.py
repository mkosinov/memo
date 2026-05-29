"""Client ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.abstract import AbstractModel

if TYPE_CHECKING:
    from app.db.models.tag import Tag


class Client(AbstractModel):
    __tablename__ = "clients"

    name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    channel: Mapped[str] = mapped_column(String(50))

    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="client_tags", back_populates="clients"
    )
