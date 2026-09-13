"""Master ORM model — schedule extension of a staff member (GH #266).

REWRITTEN by the restructuring: the old ``masters`` people table became
``staff``; this table is now the 1:0..1 master extension (schedule side):
specialty, color, and the distribution flag. ``staff_id`` is PK AND FK →
``staff.id`` ON DELETE CASCADE (hard-deleting the card drops the master row
at the DB level — auto-cascade row of the deletion matrix). Values are the
former master ids (m1-m5, m7 preserved by the migration).

Deliberately mapped directly on ``Base`` (not ``AbstractModel``): the shared
abstract PK ``id`` must NOT appear — ``staff_id`` is the only PK, doubling as
the FK to the staff card (association-object style, cf. ServiceMaterial).
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base

if TYPE_CHECKING:
    from src.models.staff import Staff
    from src.models.tag import Tag


class Master(Base):
    """Master extension row: exactly one per acting/former master."""

    __tablename__ = "masters"

    staff_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("staff.id", ondelete="CASCADE"), primary_key=True,
    )
    # CSV of specialties («живопись, керамика») — Text: String(20) is too
    # tight for a CSV list (spec «Модель данных»).
    specialty: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7))
    # Distribution (schedule) flag — independent from staff.is_active (D3).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
    )

    staff: Mapped[Staff] = relationship(back_populates="master")
    tags: Mapped[list[Tag]] = relationship(
        "Tag", secondary="master_tags", back_populates="masters"
    )
