"""Service ORM model."""

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.abstract import AbstractModel

if TYPE_CHECKING:
    from app.db.models.tariff import Tariff
    from app.db.models.tag import Tag


class Service(AbstractModel):
    __tablename__ = "services"

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str] = mapped_column(Text)
    specialty: Mapped[str] = mapped_column(String(20))
    min_age: Mapped[int] = mapped_column(Integer)
    max_age: Mapped[int] = mapped_column(Integer)
    duration: Mapped[int] = mapped_column(Integer)
    record_info: Mapped[str] = mapped_column(Text)

    tariffs: Mapped[list["Tariff"]] = relationship(
        "Tariff", back_populates="service", cascade="all, delete-orphan"
    )
    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="service_tags", back_populates="services"
    )
