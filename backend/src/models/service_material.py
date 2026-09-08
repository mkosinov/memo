"""ServiceMaterial association object — materials ↔ services M2M link (GH #223).

Association-object pattern (spec §3.1): the payload column ``note`` is
unreachable via a bare ``secondary=`` relationship, so the link is a mapped
class, not a join ``Table``. Composite PK mirrors ``service_tags``; both FKs
declare ON DELETE CASCADE (model + migration level) so ``create_all``-built
test schemas match the Alembic DDL — the app-side cascade executor (GH #207)
remains the functional owner.
"""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base

if TYPE_CHECKING:
    from src.models.material import Material
    from src.models.service import Service


class ServiceMaterial(Base):
    """Link row: one material attached to one service, with an optional note.

    ``note`` is the per-service override text; NULL = fall back to the
    material's ``description`` when rendering (spec §2 decision 3).
    """

    __tablename__ = "service_materials"

    service_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("services.id", ondelete="CASCADE"), primary_key=True
    )
    material_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("materials.id", ondelete="CASCADE"), primary_key=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    service: Mapped["Service"] = relationship(back_populates="service_materials")
    material: Mapped["Material"] = relationship()
