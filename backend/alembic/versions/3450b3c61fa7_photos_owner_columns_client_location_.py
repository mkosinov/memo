"""photos owner columns client location check

GH #211 — photos 4-owner model: drop ``visitor_id``; add nullable
``client_id``/``location_id`` FKs (ON DELETE SET NULL); enforce at most ONE
owner via the ``ck_photos_single_owner`` CHECK. Schema-only migration (NO
backfill per user ruling); existing rows keep their service/activity owner,
visitor-owned rows become owner-less (allowed).

Revision ID: 3450b3c61fa7
Revises: b7c8d9e0f1a2
Create Date: 2026-08-28 06:11:33.347872

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3450b3c61fa7'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("photos") as batch_op:
        batch_op.drop_column("visitor_id")
        batch_op.add_column(sa.Column("client_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("location_id", sa.String(36), nullable=True))
        batch_op.create_foreign_key(
            "fk_photos_client_id", "clients", ["client_id"], ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_photos_location_id", "locations", ["location_id"], ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_check_constraint(
            "ck_photos_single_owner",
            "(client_id IS NOT NULL) + (service_id IS NOT NULL) + "
            "(activity_id IS NOT NULL) + (location_id IS NOT NULL) <= 1",
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("photos") as batch_op:
        batch_op.drop_constraint("ck_photos_single_owner", type_="check")
        batch_op.drop_constraint("fk_photos_location_id", type_="foreignkey")
        batch_op.drop_constraint("fk_photos_client_id", type_="foreignkey")
        batch_op.drop_column("location_id")
        batch_op.drop_column("client_id")
        batch_op.add_column(sa.Column("visitor_id", sa.String(36), nullable=True))
