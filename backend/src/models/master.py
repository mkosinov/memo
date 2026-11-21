"""Master ORM model — schedule extension of a staff member (GH #266).

REWRITTEN by the restructuring: the old ``masters`` people table became
``staff``; this table is now the 1:0..1 master extension (schedule side):
color and the distribution flag. ``staff_id`` is PK AND FK →
``staff.id`` ON DELETE CASCADE (hard-deleting the card drops the master row
at the DB level — auto-cascade row of the deletion matrix). Values are the
former master ids (m1-m5, m7 preserved by the migration).

GH #599 R3: the free-text ``specialty`` CSV column is DROPPED — the
directions live in the ``staff_specialties`` M2M (see
:class:`src.models.specialty.Specialty`; the Staff-side ``specialties``
relationship carries them, D5 keeps a live section non-empty).

Deliberately mapped directly on ``Base`` (not ``AbstractModel``): the shared
abstract PK ``id`` must NOT appear — ``staff_id`` is the only PK, doubling as
the FK to the staff card (association-object style, cf. ServiceMaterial).
"""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — ORM resolves Mapped[datetime] at runtime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base
from src.util.utc import utc_now

if TYPE_CHECKING:
    from src.models.staff import Staff
    from src.models.tag import Tag


class Master(Base):
    """Master extension row: exactly one per acting/former master."""

    __tablename__ = "masters"

    # Plain (never mapped) annotated instance attributes are allowed on
    # this class: the audit-snapshot glue below deliberately uses a
    # non-Mapped annotation, and SQLAlchemy's declarative strictness
    # would otherwise reject it (MappedAnnotationError).
    __allow_unmapped__ = True

    staff_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("staff.id", ondelete="CASCADE"), primary_key=True,
    )
    color: Mapped[str] = mapped_column(String(7))
    # Distribution (schedule) flag — independent from staff.is_active (D3).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now,
    )

    # GH #599 Task 5 (spec §4.6): audit-snapshot glue — PLAIN instance
    # attributes fed by the master-section writer
    # (``MasterService.upsert_extension``), never mapped columns (the
    # non-``Mapped`` annotation + ``__allow_unmapped__`` above keep
    # SQLAlchemy out). The audit signature's getattr walk reads the
    # section's direction display string + id set off them WITHOUT a
    # lazy load; a row the writer never fed keeps the class-level
    # ``None`` and snapshots its real columns only (inert skip — no
    # dead-attribute reads).
    specialty: str | None = None
    specialty_ids: list[str] | None = None

    staff: Mapped[Staff] = relationship(back_populates="master")
    tags: Mapped[list[Tag]] = relationship(
        "Tag", secondary="master_tags", back_populates="masters"
    )
