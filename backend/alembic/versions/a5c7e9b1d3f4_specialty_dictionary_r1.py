"""Specialty dictionary R1: specialties + staff_specialties + services.specialty_id

GH #599 Task 1 (spec §4.1, the structure-only revision of the three-DDL
split — the tree stays green after every task of the wave):

* UP: create ``specialties`` + BOTH indexes — the functional UNIQUE
  ``lower(title)`` (handwritten ``op.create_index`` with
  ``sa.text("lower(title)")`` — autogenerate never carries an expression
  index; ``lower`` resolves to the full-Unicode UDF the engine connect
  listener registers, so Cyrillic case-variants collide) and the plain
  ``title`` index (the fixed ``title ASC, id ASC`` dictionary order);
  create the ``staff_specialties`` M2M (composite PK
  ``(staff_id, specialty_id)``, both FKs ON DELETE CASCADE — the ORM
  side adds ``passive_deletes=True`` — plus the dedicated
  ``specialty_id`` index); add ``services.specialty_id`` — NULLABLE FK
  RESTRICT with an explicit column index. NOT NULL arrives with R2
  (Task 3) together with the Service-model mapping; nothing reads the
  column yet.
* DOWN: drop everything R1 added (dev-only convenience — prod is
  empty; data is not restored).

Revision ID: a5c7e9b1d3f4
Revises: c1d3e5f7a9b1
Create Date: 2026-11-13

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a5c7e9b1d3f4"
down_revision: str | Sequence[str] | None = "c1d3e5f7a9b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema (structure-only, no data conversion — spec §4.1)."""
    # ── 1. specialties dictionary + both indexes ──────────────────────────
    op.create_table(
        "specialties",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # The functional unique index — handwritten (autogenerate skips
    # expression indexes). Names mirror the model's __table_args__ so
    # the seed.py create_all path and the migration never drift.
    op.create_index(
        "ux_specialties_lower_title",
        "specialties",
        [sa.text("lower(title)")],
        unique=True,
    )
    op.create_index("ix_specialties_title", "specialties", ["title"])

    # ── 2. staff_specialties M2M (the staff_positions mirror) ────────────
    op.create_table(
        "staff_specialties",
        sa.Column("staff_id", sa.String(length=36), nullable=False),
        sa.Column("specialty_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["staff_id"],
            ["staff.id"],
            ondelete="CASCADE",
            name="fk_staff_specialties_staff_id_staff",
        ),
        sa.ForeignKeyConstraint(
            ["specialty_id"],
            ["specialties.id"],
            ondelete="CASCADE",
            name="fk_staff_specialties_specialty_id_specialties",
        ),
        sa.PrimaryKeyConstraint("staff_id", "specialty_id"),
    )
    # The PK covers only the staff→specialty direction; the dictionary-side
    # cascade and lookups need the reverse one.
    op.create_index(
        "ix_staff_specialties_specialty_id",
        "staff_specialties",
        ["specialty_id"],
    )

    # ── 3. services.specialty_id — NULLABLE FK RESTRICT + index ──────────
    with op.batch_alter_table("services", schema=None) as batch_op:
        batch_op.add_column(sa.Column("specialty_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_services_specialty_id_specialties",
            "specialties",
            ["specialty_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_index(
            "ix_services_specialty_id",
            ["specialty_id"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema — drop everything R1 added (dev-only convenience)."""
    with op.batch_alter_table("services", schema=None) as batch_op:
        batch_op.drop_index("ix_services_specialty_id")
        batch_op.drop_constraint(
            "fk_services_specialty_id_specialties",
            type_="foreignkey",
        )
        batch_op.drop_column("specialty_id")

    op.drop_index("ix_staff_specialties_specialty_id", table_name="staff_specialties")
    op.drop_table("staff_specialties")

    op.drop_index("ix_specialties_title", table_name="specialties")
    op.drop_index("ux_specialties_lower_title", table_name="specialties")
    op.drop_table("specialties")
