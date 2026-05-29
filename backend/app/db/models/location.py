"""Location ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.abstract import AbstractModel

if TYPE_CHECKING:
    from app.db.models.tag import Tag


class Location(AbstractModel):
    __tablename__ = "locations"

    name: Mapped[str] = mapped_column(String(100))
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    capacity: Mapped[int] = mapped_column(Integer)
    yandex_map_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    record_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="location_tags", back_populates="locations"
    )
