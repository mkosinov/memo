"""add is_public to locations (GH #601)

Revision ID: c1d3e5f7a9b1
Revises: b9e1d3f5a7c2
Create Date: 2026-11-13

Web-visibility flag for locations: ``is_public = true`` → shown on the
client site (default — existing rows keep their behavior), ``false`` =
hidden from the site only, fully working in admin. Distinct from the
archive (``is_active``); see docs/domain-rules/locations.md → Invariants
and docs/specs/2026-11-12-locations-web-visibility-601-design.md §2.1/§7.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d3e5f7a9b1'
down_revision: Union[str, Sequence[str], None] = 'b9e1d3f5a7c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    """Check if a column exists (idempotent upgrade, local-run guard)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c["name"] for c in inspector.get_columns(table)]


def upgrade() -> None:
    """Upgrade schema."""
    if not _column_exists("locations", "is_public"):
        op.add_column(
            "locations",
            sa.Column(
                "is_public", sa.Boolean(), nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("locations", schema=None) as batch_op:
        batch_op.drop_column("is_public")
