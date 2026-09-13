"""Position ORM model + staff_positions M2M (GH #266).

Positions are a salary-side dictionary (future payroll module); they do NOT
affect schedule or access. Built-ins: fixed string ids ``master``/``admin``
(``is_system=True`` — code anchors, title freely editable, deletion
forbidden). User-defined ones get uuid ids and free lifecycle.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base
from src.models.abstract import AbstractModel

if TYPE_CHECKING:
    from src.models.staff import Staff


# Join table must be defined before Position (relationship reference).
staff_positions = Table(
    "staff_positions", Base.metadata,
    Column(
        "staff_id", String(36),
        ForeignKey("staff.id", ondelete="CASCADE"), primary_key=True,
    ),
    Column(
        "position_id", String(36),
        ForeignKey("positions.id", ondelete="CASCADE"), primary_key=True,
    ),
)


class Position(AbstractModel):
    """A position (должность) — salary dictionary entry (spec D4)."""

    __tablename__ = "positions"

    title: Mapped[str] = mapped_column(String(100))
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)

    staff: Mapped[list[Staff]] = relationship(
        secondary=staff_positions, back_populates="positions",
    )
