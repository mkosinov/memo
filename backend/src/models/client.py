"""Client ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.tag import Tag


class Client(AbstractModelSoftDelete):
    __tablename__ = "clients"

    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    channel: Mapped[str | None] = mapped_column(String(50), nullable=True)

    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="client_tags", back_populates="clients"
    )
