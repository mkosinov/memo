"""Tag ORM model and join tables for many-to-many relationships."""

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.abstract import AbstractModel


class Tag(AbstractModel):
    __tablename__ = "tags"

    tag: Mapped[str] = mapped_column(String(100), unique=True)


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
