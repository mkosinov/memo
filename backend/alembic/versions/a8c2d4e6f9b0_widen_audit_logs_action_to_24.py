"""audit_logs.action widened 16 → 24 (#348: password_link_issued)

Revision ID: a8c2d4e6f9b0
Revises: d7f9b1e3a5c7
Create Date: 2026-09-27 17:40:00.000000

The #348 spec §8 journals the password-link issue as a NEW action kind
``password_link_issued`` (21 chars) — one char wider than the #344
``String(16)`` action column. Pure width widening, no data change: the
existing values (create/update/delete/archive/restore/reorder) all fit.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a8c2d4e6f9b0'
down_revision: str | Sequence[str] | None = 'd7f9b1e3a5c7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.alter_column(
            'action',
            existing_type=sa.String(length=16),
            type_=sa.String(length=24),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.alter_column(
            'action',
            existing_type=sa.String(length=24),
            type_=sa.String(length=16),
            existing_nullable=False,
        )
