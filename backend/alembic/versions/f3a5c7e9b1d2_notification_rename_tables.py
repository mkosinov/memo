"""notify → notification rename (#581, spec §3.2/§5)

Revision ID: f3a5c7e9b1d2
Revises: e8a2c4d6b0f3
Create Date: 2026-11-09

The #581 wave's data/schema rename (spec
2026-11-09-notification-rename-581-design.md §5): the subsystem's TABLE
names lose the ``notify`` prefix — rename preserves every row,
including the seed template of ``c970adc6b3d6`` (no data UPDATE; the
one string candidate ``skip_reason="notify_off"`` stays by design,
spec §2.1):

- ``op.rename_table`` × 4: ``notify_tasks`` → ``notification_tasks``,
  ``notify_task_attempts`` → ``notification_task_attempts``,
  ``notify_event_attempts`` → ``notification_event_attempts``,
  ``notify_templates`` → ``notification_templates``. SQLite ≥ 3.26
  rewrites REFERENCES in dependent tables on RENAME regardless of the
  FK pragma (probe-verified 3.47.1; the masters→staff precedent
  ``e5f7a9c3b1d8``) — ``notification_task_attempts.task_id`` follows
  ``notification_tasks`` automatically; the migration test asserts it
  with ``PRAGMA foreign_keys=ON`` + ``PRAGMA foreign_key_list``.
- ``clients.notify_enabled`` → ``clients.notification_enabled`` via
  batch_alter_table (SQLite table rebuild; reflection carries the
  ``true`` server default).
- Three named unique indexes: SQLite has no ``ALTER INDEX`` — drop +
  create with the model definitions (partial ``sqlite_where`` on the
  root index, the ``COALESCE`` expression on the templates index),
  mirroring ``d94b1f7c2a6e`` / ``e8a2c4d6b0f3``.
- Downgrade — the exact mirror (renames back, old-named indexes
  recreated, the consent column renamed back).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a5c7e9b1d2'
down_revision: Union[str, Sequence[str], None] = 'e8a2c4d6b0f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: the notify→notification rename (rows preserved)."""
    # 1) Table renames FIRST — SQLite rewrites REFERENCES in dependent
    # tables on RENAME, so renaming notify_tasks before its attempts
    # table carries the FK target along (asserted by the migration test
    # with PRAGMA foreign_keys=ON, spec §5.6).
    op.rename_table('notify_tasks', 'notification_tasks')
    op.rename_table('notify_task_attempts', 'notification_task_attempts')
    op.rename_table('notify_event_attempts', 'notification_event_attempts')
    op.rename_table('notify_templates', 'notification_templates')

    # 2) The consent column (SQLite table rebuild; the reflected server
    # default travels with the column).
    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.alter_column(
            'notify_enabled', new_column_name='notification_enabled',
            existing_type=sa.Boolean(),
        )

    # 3) Named unique indexes: no ALTER INDEX in SQLite — drop the old,
    # create the new with the model definitions (partial sqlite_where +
    # the COALESCE expression, d94b1f7c2a6e/e8a2c4d6b0f3 style).
    op.drop_index('uq_notify_tasks_root_channel', table_name='notification_tasks')
    op.drop_index(
        'uq_notify_tasks_event_scenario_root', table_name='notification_tasks'
    )
    op.create_index(
        'uq_notification_tasks_root_channel',
        'notification_tasks',
        ['root_task_id', 'channel'],
        unique=True,
    )
    op.create_index(
        'uq_notification_tasks_event_scenario_root',
        'notification_tasks',
        ['event_id', 'scenario'],
        unique=True,
        sqlite_where=sa.text('parent_task_id IS NULL'),
    )
    op.drop_index(
        'uq_notify_templates_event_channel', table_name='notification_templates'
    )
    op.create_index(
        'uq_notification_templates_event_channel',
        'notification_templates',
        ['event_type', sa.text("COALESCE(channel, '')")],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema: the mirror rename (notification → notify)."""
    # Indexes back to their old names on the still-new tables (index
    # names are schema-global; DROP INDEX needs no table).
    op.drop_index(
        'uq_notification_tasks_root_channel', table_name='notification_tasks'
    )
    op.drop_index(
        'uq_notification_tasks_event_scenario_root',
        table_name='notification_tasks',
    )
    op.drop_index(
        'uq_notification_templates_event_channel',
        table_name='notification_templates',
    )

    # The consent column back.
    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.alter_column(
            'notification_enabled', new_column_name='notify_enabled',
            existing_type=sa.Boolean(),
        )

    # Table renames back — the same REFERENCES rewrite, mirrored:
    # notification_tasks first, its attempts table follows the target.
    op.rename_table('notification_tasks', 'notify_tasks')
    op.rename_table('notification_task_attempts', 'notify_task_attempts')
    op.rename_table('notification_event_attempts', 'notify_event_attempts')
    op.rename_table('notification_templates', 'notify_templates')

    op.create_index(
        'uq_notify_tasks_root_channel',
        'notify_tasks',
        ['root_task_id', 'channel'],
        unique=True,
    )
    op.create_index(
        'uq_notify_tasks_event_scenario_root',
        'notify_tasks',
        ['event_id', 'scenario'],
        unique=True,
        sqlite_where=sa.text('parent_task_id IS NULL'),
    )
    op.create_index(
        'uq_notify_templates_event_channel',
        'notify_templates',
        ['event_type', sa.text("COALESCE(channel, '')")],
        unique=True,
    )
