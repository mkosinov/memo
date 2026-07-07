"""Tag ORM model and join tables for many-to-many relationships."""

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base
from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.client import Client
    from src.models.location import Location
    from src.models.master import Master
    from src.models.photo import Photo
    from src.models.record import Record
    from src.models.service import Service
    from src.models.visitor import Visitor


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

master_tags = Table(
    "master_tags", Base.metadata,
    Column("master_id", String(36), ForeignKey("masters.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)

location_tags = Table(
    "location_tags", Base.metadata,
    Column("location_id", String(36), ForeignKey("locations.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)

client_tags = Table(
    "client_tags", Base.metadata,
    Column("client_id", String(36), ForeignKey("clients.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)

visitor_tags = Table(
    "visitor_tags", Base.metadata,
    Column("visitor_id", String(36), ForeignKey("visitors.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)

record_tags = Table(
    "record_tags", Base.metadata,
    Column("record_id", String(36), ForeignKey("records.id"), primary_key=True),
    Column("tag_id", String(36), ForeignKey("tags.id"), primary_key=True),
)


class Tag(AbstractModelSoftDelete):
    __tablename__ = "tags"

    tag: Mapped[str] = mapped_column(String(100), unique=True)

    services: Mapped[list["Service"]] = relationship(
        "Service", secondary=service_tags, back_populates="tags"
    )
    activities: Mapped[list["Activity"]] = relationship(
        "Activity", secondary=activity_tags, back_populates="tags"
    )
    masters: Mapped[list["Master"]] = relationship(
        "Master", secondary=master_tags, back_populates="tags"
    )
    locations: Mapped[list["Location"]] = relationship(
        "Location", secondary=location_tags, back_populates="tags"
    )
    clients: Mapped[list["Client"]] = relationship(
        "Client", secondary=client_tags, back_populates="tags"
    )
    visitors: Mapped[list["Visitor"]] = relationship(
        "Visitor", secondary=visitor_tags, back_populates="tags"
    )
    records: Mapped[list["Record"]] = relationship(
        "Record", secondary=record_tags, back_populates="tags"
    )
    photos: Mapped[list["Photo"]] = relationship(
        "Photo", secondary="photo_tags", back_populates="tags"
    )
