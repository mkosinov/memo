"""Notification subsystem ORM models (#482, spec §3.1/§3.5/§3.6; family #476;
per-channel reshape — #485 part 4, ADR 014).

``DomainEvent`` lives in ``src/domain_events/models.py`` (#580 Task 2);
its transitional re-export here died with the dispatcher's switchover
to the consumer-group loop (#580 Task 6) — importers read the
domain-events module directly.

``NotificationTask`` / ``NotificationTemplate`` follow the ``AbstractModel``
conventions (String(36) UUID PK + naive-UTC ``created_at``/
``updated_at``).

``NotificationTaskAttempt`` is append-only ("только добавляемые строки", §3.6) —
like ``AuditLog`` it deliberately builds directly on ``Base``: own ``id`` +
``occurred_at`` only, no ``updated_at``, no relationships; rows are never
updated or deleted.
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


class NotificationTask(AbstractModel):
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

    __tablename__ = "notification_tasks"

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
    # The frozen template's ORIGIN (#485 Task 4, spec §6.2): the template
    # row's ``channel`` value at freeze time — NULL = universal (plain
    # text, no channel markup), a channel name = a template written in
    # that channel's format. The worker is DB-free (ADR 009), so the
    # origin rides the row and the §4.2 payload to the send seam: the
    # channel picks its transport parse mode by it (channel template →
    # the channel's markup, universal → no parse mode, §5.3).
    template_channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
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
            "uq_notification_tasks_root_channel",
            "root_task_id",
            "channel",
            unique=True,
        ),
        # Redelivery idempotency of chain ROOTS (#580 §3.5/§4.2): a
        # re-issued event is caught by the EXISTENCE of its root task
        # (roots and skipped tasks — parent NULL; continuations inherit
        # the root's pair and are NOT covered). Partial — via
        # sqlite_where, mirroring the migration that creates it
        # (precedent c970adc6b3d6), so autogenerate sees no drift.
        Index(
            "uq_notification_tasks_event_scenario_root",
            "event_id",
            "scenario",
            unique=True,
            sqlite_where=sa.text("parent_task_id IS NULL"),
        ),
    )


@sa_event.listens_for(Session, "before_flush")
def _notification_task_root_default(
    session: Session, flush_context: Any, instances: Any
) -> None:
    """Chain-root default (ADR 014): a ``NotificationTask`` inserted without an
    explicit ``root_task_id`` IS the chain root — fill it with the row's
    own id. The id is generated eagerly here (same format as the
    ``AbstractModel`` default) so root and id land in ONE insert."""
    for obj in session.new:
        if isinstance(obj, NotificationTask) and obj.root_task_id is None:
            if obj.id is None:
                obj.id = str(uuid.uuid4())
            obj.root_task_id = obj.id


class NotificationTaskAttempt(Base):
    """Append-only channel attempt journal (stage events from the worker,
    §4.3): each row is one sending/sent/failed stage record.

    ``sent_text`` (rev.5, spec §4.3) — the text ACTUALLY handed to the
    channel transport in this attempt: written on the stages where a
    transmission happened (``sending``/``sent``); NULL when the attempt
    failed before any transmission (assembly, limits, resolve).
    """

    __tablename__ = "notification_task_attempts"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    task_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("notification_tasks.id"),
        nullable=False,
    )
    channel: Mapped[str] = mapped_column(String(50))
    # sending | sent | failed (§4.3).
    stage: Mapped[str] = mapped_column(String(20))
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime)


class NotificationEventAttempt(Base):
    """Per-(event, scenario) attempts ledger of the notification subscriber
    (#580 §3.5/§4.2) — the SCENARIO retry counter that replaces the
    event's dropped ``attempts``/``processing_error`` columns: consumer
    state lives with the consumer, never on the journal row.

    One mutable counter row per (event_id, scenario) — the composite PK
    IS the spec's ``UNIQUE(event_id, scenario)``. A scenario error
    increments ``attempts`` and overwrites ``last_error``; at the
    threshold (module constant ``MAX_SCENARIO_ATTEMPTS = 3``, #580
    Task 6) the event is parked. Transport errors do NOT burn attempts.

    The dispatcher's group-reading cycle (Task 6) owns the writes; the
    table lands with the #580 switchover migration (Task 3).
    """

    __tablename__ = "notification_event_attempts"

    event_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("domain_events.id"),
        primary_key=True,
    )
    scenario: Mapped[str] = mapped_column(String(50), primary_key=True)
    attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )
    # Last scenario error text (the parking reason of the counter).
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class NotificationTemplate(AbstractModel):
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

    __tablename__ = "notification_templates"

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
            "uq_notification_templates_event_channel",
            "event_type",
            sa.text("COALESCE(channel, '')"),
            unique=True,
        ),
    )
