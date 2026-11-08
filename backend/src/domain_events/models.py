"""Domain-event journal ORM model (#580 §3.1/§4.2; moved from
``src/notify/models.py`` — GH #482 origin; the table is NOT renamed:
the migration never touches the ``domain_events`` table name).

``DomainEvent`` follows the ``AbstractModel`` conventions (String(36)
UUID PK + naive-UTC ``created_at``/``updated_at``).

The #580 switchover migration (Task 3, spec §4.2) replaced the
consumer-state columns (``processed_at``/``attempts``/
``processing_error``) with ``published_at`` — the RELAY cursor: NULL =
unpublished (the relay batch predicate), set in the same transaction as
the stream XADD. Consumer state (attempts, parking) lives with the
subscriber in its own tables (notification —
``notify_event_attempts``); the journal is the archive, never the
consumer's bookkeeping.

The partial index ``ix_domain_events_unpublished`` must be declared
through ``sqlite_where`` so alembic autogenerate sees no drift between
this model and the migration that creates it (precedent
``c970adc6b3d6``).
"""

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import (
    JSON,
    DateTime,
    Index,
    String,
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
    # The relay cursor (the #580 switchover, §4.2): set in the same
    # transaction as the stream XADD; NULL = unpublished — the relay
    # batch predicate. Backfilled at the migration moment for the two
    # dead sets (consumed or parked-by-error) so they are never
    # republished.
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    __table_args__ = (
        # Relay cursor index: only unpublished rows — the index never
        # carries rows the relay batch always discards (spec §4.2).
        Index(
            "ix_domain_events_unpublished",
            "occurred_at",
            sqlite_where=sa.text("published_at IS NULL"),
        ),
    )
