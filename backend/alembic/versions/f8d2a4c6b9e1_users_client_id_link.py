"""users.client_id — optional 1:1 link to the client card (#499, spec §3)

Revision ID: f8d2a4c6b9e1
Revises: c970adc6b3d6
Create Date: 2026-10-21

#499 Task 1 (docs/specs/2026-10-20-web-client-auth-booking-design.md §3):
``User`` gains the optional 1:1 client link — column ``client_id``
(String(36), nullable), FK → ``clients.id``, unique — mirroring the
``staff_id`` pattern (GH #266): one account per client card, nullable for
staff accounts and not-yet-linked client ones. FK-only, no ORM
relationship. Client accounts are created solely by the OTP
phone-verification flow (later tasks); nothing backfills here.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f8d2a4c6b9e1'
down_revision: str | Sequence[str] | None = 'c970adc6b3d6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Project recipe (cf. e5f7a9c3b1d8): deterministic constraint names inside
# batch_alter_table on SQLite. Safe as ONE batch block — the e5f7a9c3b1d8
# caveat (create_* DDL emitted against the PRE-rename column set) applies
# to rename+create mixes only; add_column+create_* has no rename.
FK_NAMING_CONVENTION = {
    'fk': 'fk_%(table_name)s_%(column_0_name)s',
    'uq': 'uq_%(table_name)s_%(column_0_name)s',
}


def upgrade() -> None:
    """Add users.client_id with FK + unique (the staff_id mirror)."""
    with op.batch_alter_table(
        'users', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.add_column(
            sa.Column('client_id', sa.String(length=36), nullable=True)
        )
        batch_op.create_foreign_key(
            'fk_users_client_id_clients', 'clients', ['client_id'], ['id'],
        )
        batch_op.create_unique_constraint('uq_users_client_id', ['client_id'])


def downgrade() -> None:
    """Drop the client link (column + FK + unique)."""
    with op.batch_alter_table(
        'users', schema=None, naming_convention=FK_NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_constraint('uq_users_client_id', type_='unique')
        batch_op.drop_constraint('fk_users_client_id_clients', type_='foreignkey')
        batch_op.drop_column('client_id')
