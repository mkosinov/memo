"""Notify subsystem ORM models (#482, spec §3.1/§3.5/§3.6; family #476).

``DomainEvent`` / ``NotifyTask`` / ``NotifyTemplate`` follow the
``AbstractModel`` conventions (String(36) UUID PK + naive-UTC
``created_at``/``updated_at``).

``NotifyTaskAttempt`` is append-only ("только добавляемые строки", §3.6) —
like ``AuditLog`` it deliberately builds directly on ``Base``: own ``id`` +
``occurred_at`` only, no ``updated_at``, no relationships; rows are never
updated or deleted.

The partial index ``ix_domain_events_pending`` must be declared through
``sqlite_where`` (spec §3.1) so alembic autogenerate sees no drift between
this model and the migration that creates it.
"""

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.abstract import AbstractModel


class DomainEvent(AbstractModel):
    """Journal of domain events — the third @transactional accumulator.

    Written in the scenario's transaction (no actor required — it is data,
    not an action log, §3.1). ``occurred_at`` is naive UTC (repository
    timestamp convention); the snapshot format is family spec §4.1.
    """

    __tablename__ = "domain_events"

    # Event code; pilot: new_record.
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


class NotifyTask(AbstractModel):
    """Delivery task — one per (event, scenario); text and channel addresses
    are frozen at creation and never re-resolved (§3.4/§3.6)."""

    __tablename__ = "notify_tasks"

    event_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("domain_events.id"),
        nullable=False,
    )
    # Scenario code that produced the task (e.g. new_record).
    scenario: Mapped[str] = mapped_column(String(50))
    # FK ondelete SET NULL: the task history survives a client hard delete.
    client_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("clients.id", ondelete="SET NULL"),
        nullable=True,
    )
    # queued → sending → sent | failed; terminal skipped (§4.3).
    status: Mapped[str] = mapped_column(String(20))
    # notify_off | no_recipient | no_consent | past_event (NULL unless
    # status=skipped).
    skip_reason: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )
    # Ready rendered text (frozen at creation).
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Frozen [{name, address}] list from the enqueue payload (§4.2).
    channels: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON,
        nullable=True,
    )
    # Re-enqueue counter; past the cap (10) the task is failed.
    reenqueues: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )
    # resend_of (part 5, manual re-send child task) is NOT here yet.


class NotifyTaskAttempt(Base):
    """Append-only channel attempt journal (stage events from the worker,
    §4.3): each row is one sending/sent/failed stage record."""

    __tablename__ = "notify_task_attempts"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    task_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("notify_tasks.id"),
        nullable=False,
    )
    channel: Mapped[str] = mapped_column(String(50))
    # sending | sent | failed (§4.3).
    stage: Mapped[str] = mapped_column(String(20))
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime)


class NotifyTemplate(AbstractModel):
    """Notification text template (Jinja2, sandboxed rendering §3.5).
    Lookup by ``event_type`` with fallback to ``is_default``; the default
    ``new_record`` row is seeded by the migration and never deleted."""

    __tablename__ = "notify_templates"

    event_type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    is_default: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=sa.false(),
    )
