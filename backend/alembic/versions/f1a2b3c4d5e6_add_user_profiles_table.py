"""add user_profiles table (GH #262 Task 1)

Revision ID: f1a2b3c4d5e6
Revises: e5f7a9c3b1d8
Create Date: 2026-09-13

Private half of the self-service «Мои данные» profile (spec §3.1):
1:1 with ``users`` (unique FK), ALL columns optional, row created lazily
on the first ``PUT /api/v1/my``. Never joined into public serializers (D3).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e5f7a9c3b1d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table: str) -> bool:
    """Check if a table exists (idempotent upgrade, local-run guard)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table in inspector.get_table_names()


def upgrade() -> None:
    """Upgrade schema."""
    if _table_exists("user_profiles"):
        return
    op.create_table(
        "user_profiles",
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column(
            "user_id", sa.String(36),
            sa.ForeignKey("users.id"), unique=True, nullable=False,
        ),
        sa.Column("patronymic", sa.String(100), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("residence_address", sa.String(255), nullable=True),
        sa.Column("birth_place", sa.String(255), nullable=True),
        sa.Column("passport_series_number", sa.String(30), nullable=True),
        sa.Column("passport_issued_date", sa.Date(), nullable=True),
        sa.Column("passport_issued_by", sa.String(255), nullable=True),
        sa.Column("registration_address", sa.String(255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("user_profiles")
