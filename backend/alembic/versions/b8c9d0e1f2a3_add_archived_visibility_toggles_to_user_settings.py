"""add show_archived_masters/show_archived_locations to user_settings (GH #267)

Revision ID: b8c9d0e1f2a3
Revises: f1a2b3c4d5e6
Create Date: 2026-09-15

Two per-user schedule visibility toggles gating archived-entity lessons in
the schedule UI: masters default ON, locations default OFF
(docs/domain-rules/user_settings.md).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table: str) -> bool:
    """Check if a table exists (idempotent upgrade, local-run guard)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table in inspector.get_table_names()


def _column_exists(table: str, column: str) -> bool:
    """Check if a column exists (idempotent upgrade, local-run guard)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c["name"] for c in inspector.get_columns(table)]


def upgrade() -> None:
    """Upgrade schema."""
    if not _table_exists("user_settings"):
        return
    if not _column_exists("user_settings", "show_archived_masters"):
        op.add_column(
            "user_settings",
            sa.Column(
                "show_archived_masters", sa.Boolean(), nullable=False,
                server_default=sa.true(),
            ),
        )
    if not _column_exists("user_settings", "show_archived_locations"):
        op.add_column(
            "user_settings",
            sa.Column(
                "show_archived_locations", sa.Boolean(), nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_settings", "show_archived_locations")
    op.drop_column("user_settings", "show_archived_masters")
