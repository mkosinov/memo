"""service_materials and drop material_hint

GH #223 — Materials ↔ Services link (Task 13, the single revision):

* UP: create the ``service_materials`` association table (composite PK
  ``service_id`` + ``material_id``, both FKs ON DELETE CASCADE, payload
  ``note Text NULL`` — spec §3.1) and drop the retired ``services.material_hint``
  column (spec §2 decision 4 / §3.2). No data backfill: a free-text blob
  cannot be split per material; content is re-entered by hand.
* DOWN: recreate ``services.material_hint`` (Text, NULL — data lost, accepted:
  the field is retired by design) and drop ``service_materials`` (link rows
  belong to this feature).

Revision ID: a9b1c3d5e7f2
Revises: 3450b3c61fa7
Create Date: 2026-09-08 07:12:44.510207

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9b1c3d5e7f2'
down_revision: Union[str, Sequence[str], None] = '3450b3c61fa7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "service_materials",
        sa.Column(
            "service_id",
            sa.String(36),
            sa.ForeignKey("services.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "material_id",
            sa.String(36),
            sa.ForeignKey("materials.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
    )
    with op.batch_alter_table("services") as batch_op:
        batch_op.drop_column("material_hint")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("services") as batch_op:
        batch_op.add_column(sa.Column("material_hint", sa.Text(), nullable=True))
    op.drop_table("service_materials")
