"""password_setup_tokens table + users.password_hash nullable (#348)

Revision ID: d7f9b1e3a5c7
Revises: c4e6a8f0b2d1
Create Date: 2026-09-27 16:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd7f9b1e3a5c7'
down_revision: str | Sequence[str] | None = 'c4e6a8f0b2d1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _column_is_nullable(table: str, column: str) -> bool:
    """Check if a column is already nullable (ce42b37ee405 guard pattern)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for col in inspector.get_columns(table):
        if col["name"] == column:
            return col["nullable"]
    return False


def upgrade() -> None:
    """Upgrade schema."""
    # One-time password setup links (#348, spec §4): PK = SHA-256 digest of
    # the raw token (never stored); user_id FK cascade + index; partial
    # unique index keeps at most one LIVE (used_at IS NULL) token per account
    # — concurrent double-issue races are decided by the DB.
    op.create_table('password_setup_tokens',
    sa.Column('token', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('used_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('token')
    )
    op.create_index(
        op.f('ix_password_setup_tokens_user_id'),
        'password_setup_tokens', ['user_id'], unique=False,
    )
    op.create_index(
        'uq_password_setup_tokens_user_id_unused',
        'password_setup_tokens', ['user_id'], unique=True,
        sqlite_where=sa.text('used_at IS NULL'),
    )

    # NULL = password not set yet. All existing rows keep their hashes —
    # pure schema change, no data migration.
    if not _column_is_nullable('users', 'password_hash'):
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.alter_column(
                'password_hash',
                existing_type=sa.String(length=255),
                nullable=True,
            )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column(
            'password_hash',
            existing_type=sa.String(length=255),
            nullable=False,
        )

    op.drop_index(
        'uq_password_setup_tokens_user_id_unused',
        table_name='password_setup_tokens',
    )
    op.drop_index(
        op.f('ix_password_setup_tokens_user_id'),
        table_name='password_setup_tokens',
    )
    op.drop_table('password_setup_tokens')
