"""add is_public to services (GH #606)

Revision ID: d4f6a8b0c2e1
Revises: c1d3e5f7a9b1
Create Date: 2026-11-21

Web-visibility flag for services (mirror of the locations precedent
#601, revision ``c1d3e5f7a9b1``): ``is_public = true`` → shown on the
client site (default — existing rows keep their behavior), ``false`` =
hidden from the site only, fully working in admin. Distinct from the
archive (``is_active``); see docs/domain-rules/services.md → Invariants
and docs/specs/2026-11-13-adr015-dictionaries-606-design.md §3.6/§9.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f6a8b0c2e1'
down_revision: Union[str, Sequence[str], None] = 'c1d3e5f7a9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    """Check if a column exists (idempotent upgrade, local-run guard)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c["name"] for c in inspector.get_columns(table)]


def upgrade() -> None:
    """Upgrade schema."""
    if not _column_exists("services", "is_public"):
        op.add_column(
            "services",
            sa.Column(
                "is_public", sa.Boolean(), nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("services", schema=None) as batch_op:
        batch_op.drop_column("is_public")
