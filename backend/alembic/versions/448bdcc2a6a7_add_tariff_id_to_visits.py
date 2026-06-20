"""add tariff_id to visits

Revision ID: 448bdcc2a6a7
Revises: 3c3317f0c759
Create Date: 2026-06-20 07:20:29

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '448bdcc2a6a7'
down_revision: Union[str, Sequence[str], None] = '3c3317f0c759'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('visits', schema=None) as batch_op:
        batch_op.add_column(sa.Column('tariff_id', sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            'fk_visits_tariff_id_tariffs', 'tariffs', ['tariff_id'], ['id']
        )


def downgrade() -> None:
    with op.batch_alter_table('visits', schema=None) as batch_op:
        batch_op.drop_constraint('fk_visits_tariff_id_tariffs', type_='foreignkey')
        batch_op.drop_column('tariff_id')
