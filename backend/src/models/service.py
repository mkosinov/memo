"""Service ORM model."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete
from src.models.specialty import Specialty

if TYPE_CHECKING:
    from src.models.service_material import ServiceMaterial
    from src.models.tag import Tag
    from src.models.tariff import Tariff


class Service(AbstractModelSoftDelete):
    __tablename__ = "services"

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str] = mapped_column(Text)
    # GH #599 R2: the free-text ``specialty`` column is dropped — the
    # direction is a NOT NULL FK into the ``specialties`` dictionary
    # (ondelete=RESTRICT: a direction occupied by ANY service — archived
    # included — cannot be hard-deleted; the explicit index serves the
    # sort JOIN and the RESTRICT check, SQLite does not index FKs).
    specialty_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("specialties.id", ondelete="RESTRICT"),
        index=True,
    )
    min_age: Mapped[int] = mapped_column(Integer)
    max_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration: Mapped[int] = mapped_column(Integer)
    record_info: Mapped[str] = mapped_column(Text)

    # The dictionary side of the link (many-to-one). Named ``…_ref`` so
    # the DISPLAY string keeps the natural ``specialty`` name below —
    # the response schema reads it with ``from_attributes``. The
    # Specialty import is RUNTIME (not TYPE_CHECKING): the quoted
    # annotation must resolve at class-scan time (photo.py Client
    # precedent; specialty.py imports nothing from this module — no
    # cycle).
    specialty_ref: Mapped[Specialty] = relationship("Specialty")

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
    def specialty(self) -> str:
        """Display string (GH #599 §4.3): the linked dictionary title.

        Pydantic ``from_attributes`` reads this property. The caller
        owns eager loading (``specialty_ref`` joined onto the statement
        — ``ServiceService.get``/``list``/``list_all``); reading it off
        a lazily-loaded relationship under async SQLAlchemy would raise
        ``MissingGreenlet``.
        """
        return self.specialty_ref.title

    @property
    def materials(self) -> list[dict[str, str | None]]:
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
