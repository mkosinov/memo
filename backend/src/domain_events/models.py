"""Domain-event journal ORM model (#580 §3.1; moved from
``src/notify/models.py`` — GH #482 origin; the table is NOT renamed:
the migration never touches the ``domain_events`` table name).

``DomainEvent`` follows the ``AbstractModel`` conventions (String(36)
UUID PK + naive-UTC ``created_at``/``updated_at``).

The partial index ``ix_domain_events_pending`` must be declared through
``sqlite_where`` so alembic autogenerate sees no drift between this
model and the migration that creates it. The #580 switchover migration
(Task 3) replaces the consumer-state columns (``processed_at`` /
``attempts`` / ``processing_error``) with ``published_at`` and swaps the
index — NOT this task.
"""

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import (
    JSON,
    DateTime,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.models.abstract import AbstractModel


class DomainEvent(AbstractModel):
    """Journal of domain events — the third @transactional accumulator.

    Written in the scenario's transaction (no actor required — it is data,
    not an action log, §3.1). ``occurred_at`` is naive UTC (repository
    timestamp convention); the snapshot format is family spec §4.1.
    """

    __tablename__ = "domain_events"

    # Event code; pilot: new_record. Validated against the registry at
    # the producer mark (src/domain_events/types.py, §3.2).
    type: Mapped[str] = mapped_column(String(50))
    occurred_at: Mapped[datetime] = mapped_column(DateTime)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    # Set in the same transaction as the resulting notify task; NULL =
    # pending (picked by the polling loop).
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )
    attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )
    # Last processing error; written after 3 failed attempts — from then on
    # the polling loop skips the event.
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # Polling cursor index: both predicates of the pending query, so the
        # index never carries rows the poll always discards (spec §3.1).
        Index(
            "ix_domain_events_pending",
            "occurred_at",
            sqlite_where=sa.text("processed_at IS NULL AND processing_error IS NULL"),
        ),
    )
