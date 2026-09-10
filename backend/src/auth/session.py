"""Session ORM model + lifetime constants — GH #247 §3.3.

Server-side session rows; the ``memo_session`` cookie carries only the random
token. Sliding lifetime: idle window 7 days (extended at most once per hour)
capped absolutely at 30 days from creation. Rows are hard-deleted on
logout/expiry — no soft-delete flag. Multiple concurrent sessions per user
are allowed.

The lifetime constants deliberately live here in the auth package, not in
settings (G1b simplification decision).
"""

import secrets
from datetime import datetime, timedelta

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base

# Sliding-window session lifetime (spec §2.2):
IDLE_WINDOW = timedelta(days=7)          # any authenticated request extends it
ABSOLUTE_CAP = timedelta(days=30)        # hard cap from creation → fresh login
EXTENSION_THROTTLE = timedelta(hours=1)  # max one idle-extension write per hour


class Session(Base):
    """A staff login session; the token (PK) is the cookie value."""

    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)  # token_urlsafe(32)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime)
    last_extended_at: Mapped[datetime] = mapped_column(DateTime)
    idle_deadline: Mapped[datetime] = mapped_column(DateTime)      # last_extended_at + IDLE_WINDOW
    absolute_deadline: Mapped[datetime] = mapped_column(DateTime)  # created_at + ABSOLUTE_CAP


def new_session(user_id: str) -> Session:
    """Build a fresh Session row for ``user_id`` with computed deadlines."""
    now = datetime.utcnow()
    return Session(
        token=secrets.token_urlsafe(32),
        user_id=user_id,
        created_at=now,
        last_extended_at=now,
        idle_deadline=now + IDLE_WINDOW,
        absolute_deadline=now + ABSOLUTE_CAP,
    )
