"""Specialty ORM model + staff_specialties M2M (GH #599).

A specialty («направление») is a studio dictionary entry («живопись»,
«керамика») replacing the free-text ``services.specialty`` /
``masters.specialty`` columns. A service references exactly one
specialty (NOT NULL FK RESTRICT — the ``services.specialty_id`` column
arrives with the R1 migration; the Service model maps it in Task 3),
a staff member's master section references several (the M2M below).

Case-insensitive uniqueness lives in the FUNCTIONAL unique index on
``lower(title)`` — declared here in ``__table_args__`` so
``Base.metadata.create_all`` (the seed.py dev/E2E path) builds it too,
and written by hand in the R1 migration (autogenerate never carries an
expression index). ``lower`` resolves to the full-Unicode UDF the
SQLite connect listener registers on every engine connection
(``src/db/database.py``, GH #212 M5) — Cyrillic collides correctly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, Index, String, Table, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base
from src.models.abstract import AbstractModel

if TYPE_CHECKING:
    from src.models.staff import Staff


# Join table must be defined before Specialty (relationship reference) —
# the staff_positions mirror (GH #266): composite PK, both FKs CASCADE,
# plus the dedicated specialty_id index (the PK covers only the
# staff→specialty direction; the dictionary-side cascade and lookups
# need the reverse one).
staff_specialties = Table(
    "staff_specialties",
    Base.metadata,
    Column(
        "staff_id",
        String(36),
        ForeignKey("staff.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "specialty_id",
        String(36),
        ForeignKey("specialties.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Index("ix_staff_specialties_specialty_id", "specialty_id"),
)


class Specialty(AbstractModel):
    """A specialty (направление) — studio dictionary entry (GH #599)."""

    __tablename__ = "specialties"
    __table_args__ = (
        # Uniqueness is case-insensitive: «Живопись» and «живопись» must
        # not coexist (the #599 motivation). Handwritten in the R1
        # migration — autogenerate skips expression indexes.
        Index("ux_specialties_lower_title", text("lower(title)"), unique=True),
        # The fixed dictionary order (``title ASC, id ASC``) reads off a
        # plain title index.
        Index("ix_specialties_title", "title"),
    )

    title: Mapped[str] = mapped_column(String(100))

    # The Staff-side ``specialties`` relationship (back_populates pair —
    # the master-section M2M, GH #599 Task 4): the links are written by
    # the master-section path (``MasterService``, Core inserts — the
    # ``replace_positions`` precedent) and read through the Staff-side
    # relationship (``selectinload`` on staff lists / the masters view).
    # ``passive_deletes=True``: join rows die at the DB level (ON DELETE
    # CASCADE on both FKs) — SQLAlchemy must not load the collection to
    # strip it first.
    staff: Mapped[list[Staff]] = relationship(
        secondary=staff_specialties,
        back_populates="specialties",
        passive_deletes=True,
    )
