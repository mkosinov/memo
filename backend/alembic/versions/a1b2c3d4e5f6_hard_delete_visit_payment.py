"""Hard delete: drop is_active from visits and payments.

Revision ID: a1b2c3d4e5f6
Revises: 4d5e6f7a8b9c
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '4d5e6f7a8b9c'


def upgrade():
    with op.batch_alter_table('visits', schema=None) as batch_op:
        batch_op.drop_column('is_active')
    with op.batch_alter_table('payments', schema=None) as batch_op:
        batch_op.drop_column('is_active')


def downgrade():
    with op.batch_alter_table('visits', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')))
    with op.batch_alter_table('payments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')))
