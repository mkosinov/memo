"""Photo ORM model and photo_tags join table.

GH #211 — 4-owner model: a photo is owned by at most ONE of
client | service | activity | location (enforced by the
``ck_photos_single_owner`` CHECK constraint). Owner-less photos are allowed;
2+ owners are rejected at the DB level (and 422 at the API level).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base
from src.models.abstract import AbstractModel

if TYPE_CHECKING:
    from src.models.client import Client
    from src.models.location import Location
    from src.models.tag import Tag


class Photo(AbstractModel):
    __tablename__ = "photos"
    __table_args__ = (
        CheckConstraint(
            "(client_id IS NOT NULL) + (service_id IS NOT NULL) + "
            "(activity_id IS NOT NULL) + (location_id IS NOT NULL) <= 1",
            name="ck_photos_single_owner",
        ),
    )

    filename: Mapped[str] = mapped_column(Text)
    client_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True,
    )
    service_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("services.id"), nullable=True,
    )
    activity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("activities.id", ondelete="SET NULL"), nullable=True,
    )
    location_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True,
    )
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)

    client: Mapped["Client | None"] = relationship(
        "Client", foreign_keys=[client_id]
    )
    location: Mapped["Location | None"] = relationship(
        "Location", foreign_keys=[location_id]
    )
    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="photo_tags", back_populates="photos"
    )


photo_tags = Table(
    "photo_tags", Base.metadata,
    Column("photo_id", String(36), ForeignKey("photos.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)
