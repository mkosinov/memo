"""Staff ORM model — staff directory (GH #266).

Renamed from the old ``masters`` table (ids preserved by the migration):
every studio employee — masters, administrators, SMM, … The schedule-side
master extension lives in :class:`src.models.master.Master` (1:0..1).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.master import Master
    from src.models.position import Position
    from src.models.specialty import Specialty
    from src.models.tag import Tag


class Staff(AbstractModelSoftDelete):
    """Card of a studio employee (spec «Модель данных»).

    ``is_active`` = person archive (fired) — one of the three independent
    flags (D3); it is NOT the schedule flag (that lives on masters).
    """

    __tablename__ = "staff"

    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    master: Mapped[Master | None] = relationship(
        back_populates="staff", uselist=False,
    )
    positions: Mapped[list[Position]] = relationship(
        secondary="staff_positions", back_populates="staff",
    )
    # GH #599: the master-section directions (M2M ``staff_specialties``,
    # the staff_positions mirror). The links live on the CARD but are
    # owned by the master-section write path (MasterService) and are
    # cleared when the section is removed («без секции направлений нет»);
    # ``passive_deletes=True`` — join rows die at the DB level (ON DELETE
    # CASCADE on both FKs), SQLAlchemy must not load the collection to
    # strip it first.
    specialties: Mapped[list[Specialty]] = relationship(
        secondary="staff_specialties",
        back_populates="staff",
        passive_deletes=True,
    )
    # Tags travel with the master extension (master_tags), not the person;
    # kept accessible from the card for parity with the old Master model.
    tags: Mapped[list[Tag]] = relationship(
        "Tag",
        secondary="master_tags",
        primaryjoin="Staff.id == Master.staff_id",
        secondaryjoin="Tag.id == master_tags.c.tag_id",
        viewonly=True,
    )
