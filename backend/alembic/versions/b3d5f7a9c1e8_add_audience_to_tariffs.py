"""add audience to tariffs (#284)

Revision ID: b3d5f7a9c1e8
Revises: a7b8c9d0e1f2
Create Date: 2026-09-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3d5f7a9c1e8'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _backfill_audience(bind) -> None:
    """Derive ``audience`` from the tariff title — EXACT match after
    ``lower(trim(title))``: «детский» → kid, «взрослый» → adult;
    everything else (incl. «единый», prefixed titles) → all.
    Covers soft-deleted rows too (no is_active filter)."""
    bind.execute(sa.text(
        "UPDATE tariffs SET audience = 'kid'"
        " WHERE lower(trim(title)) = 'детский'"
    ))
    bind.execute(sa.text(
        "UPDATE tariffs SET audience = 'adult'"
        " WHERE lower(trim(title)) = 'взрослый'"
    ))


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('tariffs', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'audience', sa.String(length=10), nullable=False,
            server_default='all',
        ))
    _backfill_audience(op.get_bind())


def downgrade() -> None:
    """Downgrade schema (backfill is irreversible — accepted)."""
    with op.batch_alter_table('tariffs', schema=None) as batch_op:
        batch_op.drop_column('audience')
