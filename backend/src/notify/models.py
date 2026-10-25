"""Notify subsystem ORM models (#482, spec §3.1/§3.5/§3.6; family #476;
per-channel reshape — #485 part 4, ADR 014).

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
from sqlalchemy import event as sa_event
from sqlalchemy.orm import Mapped, Session, mapped_column

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
    """Per-channel delivery task — ONE channel per task (rev.5, ADR 014);
    a delivery is a CHAIN of channel tasks spawned by the dispatcher.

    Frozen at creation (never re-resolved — §3.4/§3.6, ADR 014): the
    ``channel`` with its ``address``, the render ``payload`` (§4.1
    snapshot variables) and the template (``template_id`` +
    ``template_body``); chain tasks inherit payload/address from the
    root. Chain identity: ``root_task_id`` (first task: own id —
    ORM-defaulted) + ``parent_task_id`` (NULL on the first); spawn
    idempotency: ``UNIQUE(root_task_id, channel)`` (family §8.3).

    Skipped tasks (§3.4 decisions) carry no channel payload: only
    ``status='skipped'`` + ``skip_reason``.
    """

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
    # The ONE channel of this task (registry name, e.g. telegram).
    # NULL only on skipped tasks — they never reach a channel.
    channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Frozen delivery address (phone for the pilot); chain tasks inherit
    # the root's value — never re-resolved (ADR 014).
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Frozen render data — the §4.1 snapshot variables (rev.5: the worker
    # assembles the text from payload + template_body).
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Frozen template: the row reference (audit only — deliberately NOT a
    # hard FK: part-5 CRUD may delete templates, template_body keeps the
    # text) + the body as of task creation.
    template_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    template_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Chain root (first task: own id). FK-like reference — no hard FK;
    # the dispatcher (chain spawner, part 4 Task 5) owns chain integrity.
    root_task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Previous task of the chain (NULL on the first) — chain readability.
    parent_task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Chain outcome materialized ON THE ROOT by the dispatcher:
    # delivered | not_delivered (NULL while the chain is in flight).
    # The failure reason of not_delivered lives in the attempt journal
    # (part 5 screens read attempts) — no reason column here.
    delivery_outcome: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Manual re-send reference (part 5 contract): the root id of the
    # ORIGINAL delivery this task re-sends. The WRITER (the manual
    # re-send API) is not here yet — column + contract only; a resend is
    # a new chain (new root), so UNIQUE(root_task_id, channel) never
    # blocks it.
    resend_of: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Re-enqueue counter; past the cap (10) the task is failed.
    reenqueues: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )

    __table_args__ = (
        # Spawn idempotency (family §8.3, ADR 014): at-least-once report
        # redelivery must not duplicate a chain task. NULL channel
        # (skipped tasks) never conflicts — SQLite NULLs are distinct.
        # A unique INDEX (not a table constraint): drops cleanly under
        # SQLite batch migrations (constraints don't).
        Index(
            "uq_notify_tasks_root_channel",
            "root_task_id",
            "channel",
            unique=True,
        ),
    )


@sa_event.listens_for(Session, "before_flush")
def _notify_task_root_default(
    session: Session, flush_context: Any, instances: Any
) -> None:
    """Chain-root default (ADR 014): a ``NotifyTask`` inserted without an
    explicit ``root_task_id`` IS the chain root — fill it with the row's
    own id. The id is generated eagerly here (same format as the
    ``AbstractModel`` default) so root and id land in ONE insert."""
    for obj in session.new:
        if isinstance(obj, NotifyTask) and obj.root_task_id is None:
            if obj.id is None:
                obj.id = str(uuid.uuid4())
            obj.root_task_id = obj.id


class NotifyTaskAttempt(Base):
    """Append-only channel attempt journal (stage events from the worker,
    §4.3): each row is one sending/sent/failed stage record.

    ``sent_text`` (rev.5, spec §4.3) — the text ACTUALLY handed to the
    channel transport in this attempt: written on the stages where a
    transmission happened (``sending``/``sent``); NULL when the attempt
    failed before any transmission (assembly, limits, resolve).
    """

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
    sent_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime)


class NotifyTemplate(AbstractModel):
    """Notification text template (Jinja2, sandboxed rendering §3.5).

    ``channel`` (rev.5): NULL — the UNIVERSAL template (plain text, no
    channel markup); a channel value — the template written in that
    channel's format. Lookup at task creation (§3.7): exact
    ``(event_type, channel)`` → ``(event_type, NULL)`` → ``is_default``.
    Uniqueness goes through the EXPRESSION index on ``(event_type,
    COALESCE(channel, ''))`` — SQLite treats NULLs as distinct, a plain
    unique index would let duplicate universal rows in. The default
    ``new_record`` row is seeded by the migration and never deleted.
    """

    __tablename__ = "notify_templates"

    event_type: Mapped[str] = mapped_column(String(50))
    channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    is_default: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=sa.false(),
    )

    __table_args__ = (
        Index(
            "uq_notify_templates_event_channel",
            "event_type",
            sa.text("COALESCE(channel, '')"),
            unique=True,
        ),
    )
