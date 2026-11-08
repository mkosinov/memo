"""domain-events storage contract switchover (#580 §4.2)

Revision ID: e8a2c4d6b0f3
Revises: a7c3e9f1b2d4
Create Date: 2026-11-09

The #580 Task 3 switchover migration (spec
2026-11-08-domain-events-service-580-design.md §4.2): the journal moves
from processed-at semantics (consumer state ON the event) to
published-at semantics (the relay cursor; consumer state lives with the
subscriber):

- ``domain_events``: ``published_at`` added; backfilled with the
  migration moment (one ``UPDATE`` — one ``CURRENT_TIMESTAMP``) for
  both DEAD sets — rows with ``processed_at IS NOT NULL`` (consumed)
  OR ``processing_error IS NOT NULL`` (parked by the old 3-attempts
  policy; two disjoint sets — dead events are never republished, рев.2);
  the consumer-state columns ``processed_at``/``attempts``/
  ``processing_error`` dropped (SQLite table rebuild);
  ``ix_domain_events_pending`` replaced by ``ix_domain_events_unpublished
  ON (occurred_at) WHERE published_at IS NULL`` (declared via
  ``sqlite_where`` so autogenerate sees no drift — precedent
  ``c970adc6b3d6``).
- ``notify_event_attempts``: the notify subscriber's per-(event,
  scenario) attempts ledger (``UNIQUE(event_id, scenario)`` as the
  composite PK — replacement for the event's ``attempts``/
  ``processing_error`` columns; consumed by the dispatcher in #580
  Task 6).
- ``notify_tasks``: partial unique index
  ``uq_notify_tasks_event_scenario_root (event_id, scenario) WHERE
  parent_task_id IS NULL`` — redelivery idempotency by chain ROOTS
  (continuations inherit the root's pair and are not covered). Guarded
  by a duplicate-roots pre-check that FAILS LOUDLY: today duplicates
  cannot exist (the ``processed_at`` guard worked); the check is
  migration insurance (spec §4.2).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8a2c4d6b0f3'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f1b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema (the §4.2 switchover)."""
    # Duplicate-roots pre-check FIRST (§4.2 insurance): the partial root
    # index below cannot be created over existing duplicate roots — the
    # migration refuses loudly instead of failing halfway through the
    # journal flip.
    duplicates = op.get_bind().execute(
        sa.text(
            'SELECT event_id, scenario, COUNT(*) AS c FROM notify_tasks'
            ' WHERE parent_task_id IS NULL'
            ' GROUP BY event_id, scenario HAVING c > 1'
        )
    ).fetchall()
    if duplicates:
        pairs = ', '.join(f'({event_id}, {scenario})' for event_id, scenario, _ in duplicates)
        raise RuntimeError(
            'cannot create uq_notify_tasks_event_scenario_root:'
            f' duplicate notify task roots for (event_id, scenario): {pairs}'
            ' — resolve the duplicates before the #580 switchover migration'
        )

    # 1) published_at lands first (plain ALTER — no rebuild yet)…
    with op.batch_alter_table('domain_events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('published_at', sa.DateTime(), nullable=True))

    # 2) …the backfill then sees BOTH worlds: the migration moment is
    # one CURRENT_TIMESTAMP for the whole statement — both dead sets
    # (consumed OR parked-by-error) are stamped the SAME moment and are
    # never republished; pending rows stay NULL for the relay cursor.
    op.execute(
        sa.text(
            'UPDATE domain_events SET published_at = CURRENT_TIMESTAMP'
            ' WHERE processed_at IS NOT NULL OR processing_error IS NOT NULL'
        )
    )

    # 3) the old pending index goes BEFORE the rebuild: it references
    # the dropped columns, and batch recreate loses the sqlite_where
    # predicate anyway (SQLite reflection — d94b1f7c2a6e precedent).
    op.drop_index('ix_domain_events_pending', table_name='domain_events')

    # 4) the consumer-state columns leave (SQLite table rebuild).
    with op.batch_alter_table('domain_events', schema=None) as batch_op:
        batch_op.drop_column('processed_at')
        batch_op.drop_column('attempts')
        batch_op.drop_column('processing_error')

    # 5) the relay cursor index — sqlite_where, mirroring the ORM model
    # declaration (c970adc6b3d6 precedent).
    op.create_index(
        'ix_domain_events_unpublished',
        'domain_events',
        ['occurred_at'],
        unique=False,
        sqlite_where=sa.text('published_at IS NULL'),
    )

    # 6) the notify attempts ledger: (event_id, scenario) IS the
    # identity — the composite PK is the UNIQUE(event_id, scenario) of
    # the spec (one mutable counter row per event+scenario).
    op.create_table(
        'notify_event_attempts',
        sa.Column('event_id', sa.String(length=36), nullable=False),
        sa.Column('scenario', sa.String(length=50), nullable=False),
        sa.Column(
            'attempts', sa.Integer(), nullable=False,
            server_default=sa.text('0'),
        ),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['domain_events.id']),
        sa.PrimaryKeyConstraint('event_id', 'scenario'),
    )

    # 7) the redelivery idempotency of chain ROOTS — a partial unique
    # INDEX (not a table constraint): drops cleanly under SQLite batch
    # migrations, and continuations (parent set) never collide.
    op.create_index(
        'uq_notify_tasks_event_scenario_root',
        'notify_tasks',
        ['event_id', 'scenario'],
        unique=True,
        sqlite_where=sa.text('parent_task_id IS NULL'),
    )


def downgrade() -> None:
    """Downgrade schema: the pre-#580 processed-at shape returns.

    Lossy by design (dark system): the parked/consumed distinction of
    the pre-switch rows did not survive the upgrade backfill — every
    published row returns as processed; the notify ledger data and the
    root index are #580-only and drop with data.
    """
    op.drop_table('notify_event_attempts')
    op.drop_index(
        'uq_notify_tasks_event_scenario_root', table_name='notify_tasks'
    )

    op.drop_index('ix_domain_events_unpublished', table_name='domain_events')
    with op.batch_alter_table('domain_events', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('processed_at', sa.DateTime(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                'attempts', sa.Integer(), nullable=False,
                server_default=sa.text('0'),
            )
        )
        batch_op.add_column(
            sa.Column('processing_error', sa.Text(), nullable=True)
        )

    # backfill inverse: published (dead) rows return as processed —
    # the old polling loop must not re-run them; unpublished rows stay
    # pending.
    op.execute(
        sa.text(
            'UPDATE domain_events SET processed_at = published_at'
            ' WHERE published_at IS NOT NULL'
        )
    )

    with op.batch_alter_table('domain_events', schema=None) as batch_op:
        batch_op.drop_column('published_at')

    op.create_index(
        'ix_domain_events_pending',
        'domain_events',
        ['occurred_at'],
        unique=False,
        sqlite_where=sa.text(
            'processed_at IS NULL AND processing_error IS NULL'
        ),
    )
