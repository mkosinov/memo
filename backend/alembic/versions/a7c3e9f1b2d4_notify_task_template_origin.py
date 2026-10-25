"""notify task template origin (#485 part 4, Task 4)

Revision ID: a7c3e9f1b2d4
Revises: d94b1f7c2a6e
Create Date: 2026-10-25

``notify_tasks.template_channel`` — the frozen template's ORIGIN (the
template row's ``channel`` value at freeze time; NULL = universal
template). Spec 2026-10-25-notify-telegram-channel-485-design.md §6.2:
the worker is DB-free (ADR 009), so the origin rides the task row and
the §4.2 payload to the send seam — the Telegram channel keys its
transport parse mode by it (a channel template → HTML, a universal
template → no parse mode, §5.3 «разметка принадлежит только шаблону
канала»). Existing rows (dark-system junk, no live data) keep NULL —
the column is nullable, no back-compat.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e9f1b2d4'
down_revision: Union[str, Sequence[str], None] = 'd94b1f7c2a6e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('notify_tasks', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('template_channel', sa.String(length=50), nullable=True)
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('notify_tasks', schema=None) as batch_op:
        batch_op.drop_column('template_channel')
