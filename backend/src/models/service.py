"""Service ORM model."""

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.tag import Tag
    from src.models.tariff import Tariff


class Service(AbstractModelSoftDelete):
    __tablename__ = "services"

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str] = mapped_column(Text)
    specialty: Mapped[str] = mapped_column(String(20))
    min_age: Mapped[int] = mapped_column(Integer)
    max_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration: Mapped[int] = mapped_column(Integer)
    record_info: Mapped[str] = mapped_column(Text)
    material_hint: Mapped[str | None] = mapped_column(Text, nullable=True)

    tariffs: Mapped[list["Tariff"]] = relationship(
        "Tariff", back_populates="service", cascade="all, delete-orphan"
    )
    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="service_tags", back_populates="services"
    )
