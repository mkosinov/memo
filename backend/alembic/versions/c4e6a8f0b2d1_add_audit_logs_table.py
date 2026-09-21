"""add audit_logs table (#344)

Revision ID: c4e6a8f0b2d1
Revises: b3d5f7a9c1e8
Create Date: 2026-09-21

Append-only journal of user actions (spec §5): own String(36) UUID PK +
``created_at`` only (no ``updated_at``, no soft-delete). ``user_id`` is
a FK to ``users.id`` ON DELETE SET NULL — the journal must never block a
user delete; the role snapshot and the row itself survive the link being
nulled. Indexes: ``created_at``, ``user_id``, ``(entity, entity_id)``,
``action``. No API/service surface ever updates or deletes rows here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e6a8f0b2d1'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c1e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column('user_id', sa.String(length=36), nullable=True),
        sa.Column('user_role', sa.String(length=20), nullable=False),
        sa.Column('action', sa.String(length=16), nullable=False),
        sa.Column('entity', sa.String(length=32), nullable=False),
        sa.Column('entity_id', sa.String(length=36), nullable=True),
        sa.Column('entity_label', sa.String(length=255), nullable=False),
        sa.Column('changes', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_audit_logs_created_at'), ['created_at'], unique=False
        )
        batch_op.create_index(
            batch_op.f('ix_audit_logs_user_id'), ['user_id'], unique=False
        )
        batch_op.create_index(
            'ix_audit_logs_entity_entity_id', ['entity', 'entity_id'], unique=False
        )
        batch_op.create_index(
            batch_op.f('ix_audit_logs_action'), ['action'], unique=False
        )


def downgrade() -> None:
    """Downgrade schema (the journal is dropped with its data)."""
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_audit_logs_action'))
        batch_op.drop_index('ix_audit_logs_entity_entity_id')
        batch_op.drop_index(batch_op.f('ix_audit_logs_user_id'))
        batch_op.drop_index(batch_op.f('ix_audit_logs_created_at'))
    op.drop_table('audit_logs')
