"""visits.tariff_id FK → tariffs.id with ondelete=SET NULL (GH #357)

Recreate the FK so a tariff DELETE nullifies the visit link at DB
level; the visit row and its price snapshot survive (the link is
informational, the price is a creation-time snapshot — see
docs/domain-rules/visits.md §Invariants). Data is untouched: rows
already referencing a tariff keep referencing it; rows already NULL
stay NULL. The ORM gets no cascade — the unhook is the database's job.

Downgrade restores the strict FK (no ondelete); references nulled by
the upgrade are NOT repaired (they point at nothing repairable).

SQLite note (tests): the constraint name is not persisted by SQLite,
so a naming convention is applied to the batch_alter_table block —
batch mode recreates the whole table and the convention gives the
reflected constraint the deterministic name expected by
drop_constraint (same pattern as b7c8d9e0f1a2). The name matches the
one the FK was created with on PostgreSQL (448bdcc2a6a7).

Revision ID: 4ba65fe87015
Revises: a8c2d4e6f9b0
Create Date: 2026-10-10

"""
from collections.abc import Sequence

from alembic import op

revision: str = '4ba65fe87015'
down_revision: str | Sequence[str] | None = 'a8c2d4e6f9b0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Deterministic name for drop_constraint on SQLite batch mode — the
# reflected FK (unnamed in SQLite storage) resolves to the same name
# the constraint carries on PostgreSQL.
FK_NAMING_CONVENTION = {
    'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s',
}

_FK_NAME = 'fk_visits_tariff_id_tariffs'


def upgrade() -> None:
    with op.batch_alter_table(
        'visits', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(_FK_NAME, type_='foreignkey')
        batch_op.create_foreign_key(
            _FK_NAME, 'tariffs', ['tariff_id'], ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table(
        'visits', schema=None, naming_convention=FK_NAMING_CONVENTION
    ) as batch_op:
        batch_op.drop_constraint(_FK_NAME, type_='foreignkey')
        batch_op.create_foreign_key(
            _FK_NAME, 'tariffs', ['tariff_id'], ['id'],
        )
