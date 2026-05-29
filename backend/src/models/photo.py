"""Photo ORM model and photo_tags join table."""

from sqlalchemy import Column, ForeignKey, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.abstract import AbstractModel


class Photo(AbstractModel):
    __tablename__ = "photos"

    filename: Mapped[str] = mapped_column(Text)
    visitor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("visitors.id"), nullable=True,
    )
    service_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("services.id"), nullable=True,
    )
    activity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("activities.id"), nullable=True,
    )


photo_tags = Table(
    "photo_tags", Base.metadata,
    Column("photo_id", String(36), ForeignKey("photos.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)
