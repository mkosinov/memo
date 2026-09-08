"""Service ORM model."""

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.service_material import ServiceMaterial
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

    tariffs: Mapped[list["Tariff"]] = relationship(
        "Tariff", back_populates="service", cascade="all, delete-orphan"
    )
    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="service_tags", back_populates="services"
    )
    service_materials: Mapped[list["ServiceMaterial"]] = relationship(
        "ServiceMaterial", back_populates="service", cascade="all, delete-orphan"
    )

    @property
    def materials(self) -> list[dict]:
        """Nested materials payload for ``ServiceResponse`` (spec §3.1/§3.3).

        Pydantic ``from_attributes`` reads this property. Python-side sort by
        ``(material.title, material.id)`` guarantees the deterministic order
        ``title ASC, id ASC`` regardless of loader order.
        """
        return [
            {
                "id": sm.material.id,
                "title": sm.material.title,
                "description": sm.material.description,
                "note": sm.note,
            }
            for sm in sorted(
                self.service_materials,
                key=lambda sm: (sm.material.title, sm.material.id),
            )
        ]
