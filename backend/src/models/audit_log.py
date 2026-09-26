"""AuditLog ORM model — append-only journal of user actions (GH #344, spec §5).

Deliberately built directly on ``Base`` (NOT ``AbstractModel``): own
``id`` + ``created_at`` only — no ``updated_at``, no soft-delete flag.
Rows are never updated or deleted by the application; no relationships
are declared, so no cascade writes/deletes can touch the journal.
``user_id`` FK is ON DELETE SET NULL: a (future) user hard-delete must
not be blocked by the journal — the link is nulled, the role snapshot
and the row itself remain.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, index=True, default=datetime.utcnow,
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"),
        index=True, nullable=True,
    )
    # Role snapshot at the moment of the action (later promotions do not
    # rewrite history).
    user_role: Mapped[str] = mapped_column(String(20))
    # create / update / delete / archive / restore / reorder (spec §5).
    action: Mapped[str] = mapped_column(String(16), index=True)
    # Canonical entity name (#239): records, payments, clients, ...
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True,  # null for reorder
    )
    entity_label: Mapped[str] = mapped_column(String(255))
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_audit_logs_entity_entity_id", "entity", "entity_id"),
    )
