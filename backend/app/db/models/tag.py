"""Tag ORM model and join tables for many-to-many relationships."""

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.models.abstract import AbstractModel

if TYPE_CHECKING:
    from app.db.models.service import Service


# Join tables must be defined before Tag class (Tag references service_tags)
service_tags = Table(
    "service_tags", Base.metadata,
    Column("service_id", String(36), ForeignKey("services.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)

activity_tags = Table(
    "activity_tags", Base.metadata,
    Column("activity_id", String(36), ForeignKey("activities.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)


class Tag(AbstractModel):
    __tablename__ = "tags"

    tag: Mapped[str] = mapped_column(String(100), unique=True)

    services: Mapped[list["Service"]] = relationship(
        "Service", secondary=service_tags, back_populates="tags"
    )
