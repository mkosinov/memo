"""Master ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModel

if TYPE_CHECKING:
    from src.models.tag import Tag


class Master(AbstractModel):
    __tablename__ = "masters"

    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(7))
    position: Mapped[str] = mapped_column(String(20))
    specialty: Mapped[str] = mapped_column(String(20))
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="master_tags", back_populates="masters"
    )
