"""per-channel notify tasks (#485 part 4, ADR 014)

Revision ID: d94b1f7c2a6e
Revises: d3b5f7a9c1e3
Create Date: 2026-10-25

The notify data model reshape of #485 Task 1 (spec
2026-10-25-notify-telegram-channel-485-design.md §4, family spec rev.5):

- ``notify_tasks``: ``text``/``channels`` DROPPED (the system is dark
  behind ``NOTIFY_ENABLED=false`` — no live data, no back-compat);
  added the per-channel shape: ``channel``, ``address``, ``payload``,
  ``template_id``, ``template_body`` (frozen at creation — the worker
  assembles the text, ADR 014), ``root_task_id``/``parent_task_id``
  (chain identity), ``delivery_outcome`` (chain result on the root),
  ``resend_of`` (part 5 manual re-send reference — column only, the
  writer is not here yet); plus ``UNIQUE(root_task_id, channel)`` —
  idempotent chain spawn (family §8.3). Existing rows (dark-system
  junk) keep NULLs — every new column is nullable.
- ``notify_templates``: ``channel`` (NULL = universal template) + the
  UNIQUE expression index on ``(event_type, COALESCE(channel, ''))`` —
  SQLite treats NULLs as distinct, so the universal row participates
  only through the COALESCE expression. The seeded default stays
  universal (``channel`` NULL).
- ``notify_task_attempts``: ``sent_text`` — the actually transmitted
  text of the attempt (spec §4.3).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd94b1f7c2a6e'
down_revision: Union[str, Sequence[str], None] = 'd3b5f7a9c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('notify_tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('channel', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('address', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('payload', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('template_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('template_body', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('root_task_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('parent_task_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('delivery_outcome', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('resend_of', sa.String(length=36), nullable=True))
        batch_op.drop_column('text')
        batch_op.drop_column('channels')
    # UNIQUE(root_task_id, channel) as a unique INDEX, OUTSIDE batch
    # mode: SQLite table constraints cannot be dropped later, and batch
    # reflection loses expression/named-constraint specs on recreate.
    op.create_index(
        'uq_notify_tasks_root_channel',
        'notify_tasks',
        ['root_task_id', 'channel'],
        unique=True,
    )

    with op.batch_alter_table('notify_templates', schema=None) as batch_op:
        batch_op.add_column(sa.Column('channel', sa.String(length=50), nullable=True))
    # The COALESCE expression index (universal rows participate — SQLite
    # treats bare NULLs as distinct), also outside batch for the same
    # reflection reason.
    op.create_index(
        'uq_notify_templates_event_channel',
        'notify_templates',
        ['event_type', sa.text("COALESCE(channel, '')")],
        unique=True,
    )

    with op.batch_alter_table('notify_task_attempts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sent_text', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema (dark system — the per-channel data is dropped,
    the pre-#485 text/channels shape returns as nullable columns)."""
    with op.batch_alter_table('notify_task_attempts', schema=None) as batch_op:
        batch_op.drop_column('sent_text')

    # Indexes FIRST: they reference the dropped columns, and batch
    # recreate would silently lose them anyway (SQLite reflection).
    op.drop_index('uq_notify_templates_event_channel', table_name='notify_templates')
    with op.batch_alter_table('notify_templates', schema=None) as batch_op:
        batch_op.drop_column('channel')

    op.drop_index('uq_notify_tasks_root_channel', table_name='notify_tasks')
    with op.batch_alter_table('notify_tasks', schema=None) as batch_op:
        batch_op.drop_column('channel')
        batch_op.drop_column('address')
        batch_op.drop_column('payload')
        batch_op.drop_column('template_id')
        batch_op.drop_column('template_body')
        batch_op.drop_column('root_task_id')
        batch_op.drop_column('parent_task_id')
        batch_op.drop_column('delivery_outcome')
        batch_op.drop_column('resend_of')
        batch_op.add_column(sa.Column('text', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('channels', sa.JSON(), nullable=True))
