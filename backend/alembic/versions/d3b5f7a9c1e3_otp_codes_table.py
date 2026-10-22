"""otp_codes table — phone-verification storage (#499 spec §4.1)

Revision ID: d3b5f7a9c1e3
Revises: f8d2a4c6b9e1
Create Date: 2026-10-21

One live code per phone: ``phone`` is the PK (a new send replaces the
row — rotation), the raw code is never stored, only its HMAC-SHA-256
hexdigest keyed with the env-sourced ``OTP_PEPPER`` (outside the DB).
``expires_at`` = created_at + 5 minutes; expired rows are purged on
phone access, no background job. Rows are hard-deleted on use/expiry
(the successful verify atomically consumes the code).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3b5f7a9c1e3'
down_revision: Union[str, Sequence[str], None] = 'f8d2a4c6b9e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'otp_codes',
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('phone'),
    )


def downgrade() -> None:
    """Downgrade schema (drops pending codes with the table)."""
    op.drop_table('otp_codes')
