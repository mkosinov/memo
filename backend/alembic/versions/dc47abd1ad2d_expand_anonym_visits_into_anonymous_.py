"""expand anonym_visits into anonymous visits and drop column

Revision ID: dc47abd1ad2d
Revises: b8c9d0e1f2a3
Create Date: 2026-09-16 11:18:24.347324

#257 — unified visitor model: the legacy per-record ``anonym_visits``
counter is expanded into real ``visits`` rows with ``visitor_id = NULL``
(one row per counted seat), after which the column is dropped.

Data-migration contract:

* each unit of ``anonym_visits`` becomes one visit row (US7);
* the new visit inherits the record's status (D5) — a cancelled record's
  anonymous guests must not come back as ``waiting``;
* ``price = 0``, ``tariff_id``/``custom_price`` NULL — the counter carried
  no per-seat money information (money semantics added by later tasks);
* ``seats`` is then recomputed from actual visit rows so the stored column
  matches the new single source of truth;
* downgrade re-adds the column EMPTY (default 0) — expansion is
  deliberately NOT reversible: the generated rows have no marker
  distinguishing them from hand-created anonymous visits.
"""
from datetime import UTC, datetime
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc47abd1ad2d'
down_revision: Union[str, Sequence[str], None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _expand_anonym_visits(conn) -> None:
    """Expand each record's anonym_visits counter into visitor_id-NULL visit rows.

    Module-level (not inlined) so tests can exercise the data contract
    directly — see tests/test_migration_anonym_unfold.py.
    """
    records = conn.execute(sa.text(
        "SELECT id, status, anonym_visits FROM records WHERE anonym_visits > 0"
    )).fetchall()
    now = datetime.now(UTC)
    rows = [
        {"id": str(uuid.uuid4()), "record_id": rid, "visitor_id": None,
         "tariff_id": None, "price": 0, "custom_price": None,
         "status": status,  # inheritance from the record's status (D5) — not waiting!
         "created_at": now, "updated_at": now}
        for rid, status, counter in records
        for _ in range(counter)
    ]
    if rows:
        # Historical shape of the visits table at this revision:
        # id/record_id/price/status NOT NULL; visitor_id/tariff_id/
        # custom_price nullable; is_active was already dropped (a1b2c3d4e5f6).
        visits_t = sa.Table("visits", sa.MetaData(),
            sa.Column("id", sa.String(36)), sa.Column("record_id", sa.String(36)),
            sa.Column("visitor_id", sa.String(36)), sa.Column("tariff_id", sa.String(36)),
            sa.Column("price", sa.Integer), sa.Column("custom_price", sa.Integer),
            sa.Column("status", sa.String(20)), sa.Column("created_at", sa.DateTime),
            sa.Column("updated_at", sa.DateTime))
        conn.execute(visits_t.insert(), rows)


def upgrade() -> None:
    """Upgrade schema: expand counter → visits, recompute seats, drop column."""
    conn = op.get_bind()
    _expand_anonym_visits(conn)
    conn.execute(sa.text(
        "UPDATE records SET seats = "
        "(SELECT COUNT(*) FROM visits WHERE visits.record_id = records.id)"
    ))
    with op.batch_alter_table("records") as batch:
        batch.drop_column("anonym_visits")


def downgrade() -> None:
    """Downgrade schema: re-add the column empty (data is not restored)."""
    with op.batch_alter_table("records") as batch:
        batch.add_column(sa.Column(
            "anonym_visits", sa.Integer(), nullable=False, server_default="0",
        ))
