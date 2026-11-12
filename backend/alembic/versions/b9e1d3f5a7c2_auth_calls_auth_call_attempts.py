"""auth_calls + auth_call_attempts — callcheck storage (#593 spec §Хранение)

Revision ID: b9e1d3f5a7c2
Revises: f3a5c7e9b1d2
Create Date: 2026-11-11

``auth_calls`` — one live check per phone: ``phone`` is the PK (a new
initiate REPLACES the row — "last request wins", the otp_codes
rotation semantics), so a replaced check's handle_hash disappears with
the row and the old handle answers 404. The raw one-time handle is
never stored — only its HMAC-SHA-256 hexdigest keyed with the
env-sourced ``OTP_PEPPER`` (the same mechanism and pepper as the OTP
codes). Expired rows (window + margin) are purged on touch, no
background job.

``auth_call_attempts`` — append-only journal for incident analysis:
one ``created`` row per successful initiate, terminal ``confirmed`` /
``expired`` rows from the status flow; ``checked_at`` is NULL until a
terminal outcome; ``ip_hash`` is the masked (pepper-keyed HMAC)
initiator IP — the IP-gate trace. No api keys, no handles, no request
bodies; retention is not configured (tiny volume, rows accumulate).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b9e1d3f5a7c2'
down_revision: str | Sequence[str] | None = 'f3a5c7e9b1d2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'auth_calls',
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('provider_check_id', sa.String(length=64), nullable=False),
        sa.Column('call_phone', sa.String(length=20), nullable=False),
        sa.Column('handle_hash', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('phone'),
    )
    op.create_table(
        'auth_call_attempts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('ip_hash', sa.String(length=64), nullable=False),
        sa.Column('provider_check_id', sa.String(length=64), nullable=False),
        sa.Column('outcome', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('checked_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Downgrade schema (drops live checks and the journal with them)."""
    op.drop_table('auth_call_attempts')
    op.drop_table('auth_calls')
