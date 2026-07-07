"""Master ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.tag import Tag


class Master(AbstractModelSoftDelete):
    __tablename__ = "masters"

    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(7))
    position: Mapped[str] = mapped_column(String(20))
    specialty: Mapped[str] = mapped_column(String(20))
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="master_tags", back_populates="masters"
    )
