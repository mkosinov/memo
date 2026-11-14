"""Specialty dictionary R2: services.specialty_id NOT NULL + drop services.specialty

GH #599 Task 3 (spec §4.1, the second DDL revision of the three-revision
split — the tree stays green after every task of the wave):

* UP: flip ``services.specialty_id`` to NOT NULL and DROP the legacy
  free-text ``services.specialty`` column (the Service ORM model maps
  ``specialty_id`` in the same task — nothing reads the old column
  anymore). Structure only, NO data conversion (user decision 13.11):
  on a NON-EMPTY dev base the NOT NULL flip fails with the штатная
  database error — expected behavior, the dev base is reseeded once
  (spec §4.1); prod is empty.
* DOWN: return the legacy text column (EMPTY — data is not restored,
  dev-only convenience) and relax ``specialty_id`` back to nullable.

The ``masters.specialty`` column is NOT touched here — it dies in its
own revision R3 (Task 4): the master-side code stops reading it only
there.

Revision ID: b8d2e6f4a9c1
Revises: a5c7e9b1d3f4
Create Date: 2026-11-14

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8d2e6f4a9c1"
down_revision: str | Sequence[str] | None = "a5c7e9b1d3f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema (structure-only, no data conversion — spec §4.1)."""
    with op.batch_alter_table("services", schema=None) as batch_op:
        batch_op.alter_column(
            "specialty_id",
            existing_type=sa.String(length=36),
            nullable=False,
        )
        batch_op.drop_column("specialty")


def downgrade() -> None:
    """Downgrade schema — dev-only convenience (prod is empty, data is
    not restored): the legacy text column returns EMPTY and the FK
    column is nullable again (the R1 interim state)."""
    with op.batch_alter_table("services", schema=None) as batch_op:
        batch_op.add_column(sa.Column("specialty", sa.String(length=20)))
        batch_op.alter_column(
            "specialty_id",
            existing_type=sa.String(length=36),
            nullable=True,
        )
