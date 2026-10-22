"""notify subsystem tables + consent/flag columns (#482)

Revision ID: c970adc6b3d6
Revises: 4ba65fe87015
Create Date: 2026-10-20

Part 1 of the notify family (#476), spec §4: four tables — ``domain_events``
(with the partial index ``ix_domain_events_pending`` declared via
``sqlite_where`` so autogenerate sees no drift), ``notify_tasks`` (client FK
ON DELETE SET NULL — task history survives a client hard delete),
``notify_task_attempts`` (append-only: own id + occurred_at, no updated_at),
``notify_templates``; plus ``clients.notify_enabled`` (consent, default ON —
family spec rev. 3) and ``records.notify`` (form flag, default OFF). Seeds
the default ``new_record`` template (spec §3.5 draft, null-tolerant) with a
FIXED id so the deterministic seed canon (spec §5) stays stable.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c970adc6b3d6'
down_revision: Union[str, Sequence[str], None] = '4ba65fe87015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Fixed uuid (NOT random): notify_templates enters the deterministic seed
# canon (spec §5) — every DB built from this migration carries the same id.
_DEFAULT_TEMPLATE_ID = '27715c0f-1d0f-4895-a555-1cb54f00bc7e'

# Default new_record template body — the §3.5 draft, full §4.1 variable set,
# null-tolerant via {% if %} guards.
_DEFAULT_TEMPLATE_BODY = (
    "{% if client.name %}{{ client.name }}, з{% else %}З{% endif %}"
    "дравствуйте! Вы записаны на «{{ service.title }}» — "
    "{{ activity.start | fmt_dt }} ({{ activity.duration }} мин), "
    "{{ location.title }}"
    "{% if location.address %}, {{ location.address }}{% endif %}"
    "{% if location.map_url %} ({{ location.map_url }}){% endif %}. "
    "{% if master.name %}Ведёт {{ master.name }}.{% endif %} "
    "{% for t in tariffs %}«{{ t.title }}» — {{ t.price | money }}; "
    "{% endfor %}"
    "Итого: {{ total_price | money }}. Если планы изменились — сообщите нам."
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'domain_events',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('type', sa.String(length=50), nullable=False),
        sa.Column('occurred_at', sa.DateTime(), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
        sa.Column(
            'attempts', sa.Integer(), nullable=False,
            server_default=sa.text('0'),
        ),
        sa.Column('processing_error', sa.Text(), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at', sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    # Both polling predicates in the partial index WHERE (spec §3.1) —
    # declared via sqlite_where, mirroring the ORM model declaration.
    op.create_index(
        'ix_domain_events_pending',
        'domain_events',
        ['occurred_at'],
        unique=False,
        sqlite_where=sa.text(
            'processed_at IS NULL AND processing_error IS NULL'
        ),
    )

    op.create_table(
        'notify_tasks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('event_id', sa.String(length=36), nullable=False),
        sa.Column('scenario', sa.String(length=50), nullable=False),
        sa.Column('client_id', sa.String(length=36), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('skip_reason', sa.String(length=20), nullable=True),
        sa.Column('text', sa.Text(), nullable=True),
        sa.Column('channels', sa.JSON(), nullable=True),
        sa.Column(
            'reenqueues', sa.Integer(), nullable=False,
            server_default=sa.text('0'),
        ),
        sa.Column(
            'created_at', sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at', sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(['event_id'], ['domain_events.id']),
        sa.ForeignKeyConstraint(
            ['client_id'], ['clients.id'], ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'notify_task_attempts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('task_id', sa.String(length=36), nullable=False),
        sa.Column('channel', sa.String(length=50), nullable=False),
        sa.Column('stage', sa.String(length=20), nullable=False),
        sa.Column('outcome', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('occurred_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['notify_tasks.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'notify_templates',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('event_type', sa.String(length=50), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column(
            'is_default', sa.Boolean(), nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            'created_at', sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at', sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        sa.text(
            'INSERT INTO notify_templates'
            ' (id, event_type, title, body, is_default,'
            ' created_at, updated_at)'
            ' VALUES (:id, :event_type, :title, :body, 1,'
            ' CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        ).bindparams(
            sa.bindparam('id', _DEFAULT_TEMPLATE_ID),
            sa.bindparam('event_type', 'new_record'),
            sa.bindparam('title', 'Новая запись (дефолтный)'),
            sa.bindparam('body', _DEFAULT_TEMPLATE_BODY),
        )
    )

    with op.batch_alter_table('records', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'notify', sa.Boolean(), nullable=False,
                server_default=sa.false(),
            )
        )
    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'notify_enabled', sa.Boolean(), nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade() -> None:
    """Downgrade schema (notify tables + flag columns dropped with data)."""
    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.drop_column('notify_enabled')
    with op.batch_alter_table('records', schema=None) as batch_op:
        batch_op.drop_column('notify')
    op.drop_table('notify_templates')
    op.drop_table('notify_task_attempts')
    op.drop_table('notify_tasks')
    op.drop_index('ix_domain_events_pending', table_name='domain_events')
    op.drop_table('domain_events')
