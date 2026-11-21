"""Specialty dictionary R3: drop masters.specialty

GH #599 Task 4 (spec §4.1, the last DDL revision of the three-revision
split — the tree stays green after every task of the wave): the legacy
free-text CSV column ``masters.specialty`` dies — the master-section
directions live in the ``staff_specialties`` M2M (R1) starting with this
task (the Master ORM model drops the column mapping in the same commit —
nothing reads the old column anymore). Structure only, NO data
conversion (user decision 13.11): the staff-side links are (re)seeded
with the good seed; prod is empty.

DOWN: returns the legacy text column EMPTY (data is not restored —
dev-only convenience, prod is empty), nullable like the pre-R3 column.

Revision ID: d4f6a8c0e2b1
Revises: b8d2e6f4a9c1
Create Date: 2026-11-14

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4f6a8c0e2b1"
down_revision: str | Sequence[str] | None = "b8d2e6f4a9c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema (structure-only, no data conversion — spec §4.1)."""
    with op.batch_alter_table("masters", schema=None) as batch_op:
        batch_op.drop_column("specialty")


def downgrade() -> None:
    """Downgrade schema — dev-only convenience (prod is empty, data is
    not restored): the legacy text column returns EMPTY and nullable."""
    with op.batch_alter_table("masters", schema=None) as batch_op:
        batch_op.add_column(sa.Column("specialty", sa.Text(), nullable=True))
