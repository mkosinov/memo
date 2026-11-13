"""Location ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.tag import Tag


class Location(AbstractModelSoftDelete):
    __tablename__ = "locations"

    title: Mapped[str] = mapped_column(String(100))
    short_title: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    capacity: Mapped[int] = mapped_column(Integer)
    yandex_map_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    record_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # GH #601: web-visibility flag — true = shown on the client site
    # (default), false = hidden from the site only, fully working in
    # admin. Distinct from the archive (is_active).
    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=sa.true(),
    )

    tags: Mapped[list[Tag]] = relationship(
        "Tag", secondary="location_tags", back_populates="locations"
    )
