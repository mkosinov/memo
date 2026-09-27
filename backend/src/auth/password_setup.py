"""PasswordSetupToken ORM model — one-time password setup links (GH #348).

Storage shape (spec §4, docs/specs/2026-09-27-user-accounts-348-design.md;
canon docs/domain-rules/auth.md «Одноразовая ссылка установки пароля»):

- ``token`` (PK) — SHA-256 hex digest of the raw token; the raw token
  lives only in the URL fragment handed to the employee and is never
  stored.
- ``user_id`` — FK users.id ON DELETE CASCADE (tokens die with the
  account), indexed for the per-user cleanup on re-issue.
- ``expires_at`` / ``created_at`` — naive UTC datetimes; ``used_at`` —
  NULL until the link is consumed (NULL = live).
- Partial unique index ``uq_password_setup_tokens_user_id_unused``:
  UNIQUE(user_id) WHERE used_at IS NULL — at most one live token per
  account, enforced by the database: a concurrent double-issue race is
  decided by the DB, not the application (spec §4).

Deliberately built directly on ``Base`` (the Session-model precedent,
src/auth/session.py): the digest IS the identity — no surrogate UUID, no
``updated_at``, no soft-delete (rows are issued / consumed / deleted,
never edited). Issue/consume logic is Task 2 (use-cases), not the model.
"""

import hashlib
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base


def token_digest(raw_token: str) -> str:
    """SHA-256 hex digest of a raw setup token — the stored PK form (#348).

    The one shared derivation: issue computes it before INSERT, the public
    consume/validate paths compute it before the PK lookup. The raw token
    itself is never stored.
    """
    return hashlib.sha256(raw_token.encode()).hexdigest()


class PasswordSetupToken(Base):
    """A one-time password-setup link; the PK is the token's SHA-256 digest."""

    __tablename__ = "password_setup_tokens"

    # SHA-256 hex digest (64 chars) of the urlsafe raw token.
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    # NULL = the link is still live; set once when consumed (Task 2 does a
    # conditional UPDATE ... WHERE used_at IS NULL — double use impossible).
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # AuditLog precedent: timestamp default on the column. expires_at is
    # business input (24 h, a scenario parameter — Task 2), not a default.
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow,
    )

    __table_args__ = (
        # One LIVE token per account, enforced by the DB (partial index).
        Index(
            "uq_password_setup_tokens_user_id_unused",
            "user_id",
            unique=True,
            sqlite_where=text("used_at IS NULL"),
        ),
    )
