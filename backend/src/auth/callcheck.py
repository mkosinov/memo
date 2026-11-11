"""Callcheck ORM models + handle hashing — GH #593 spec §Хранение.

Server-side storage of phone-verification-by-call checks, the mirror
of ``otp.py`` (#499 §4.1):

- ``auth_calls`` — exactly one live check per phone (``phone`` is the
  PK — a new initiate replaces the row, "last request wins", the OTP
  rotation semantics). The raw one-time ``handle`` never touches the
  DB: only its pepper-keyed HMAC digest (the same mechanism AND pepper
  as the OTP codes — the domain rule). ``status`` walks
  ``pending → consumed`` (Task 4's atomic conditional update) or is
  reported ``expired`` by the window; rows are hard-deleted, expired
  ones are purged on touch — there is no background job (TTL = window
  + margin, negligible volume).
- ``auth_call_attempts`` — append-only journal for incident analysis
  (the ``notification_task_attempts`` pattern): one ``created`` row per
  successful initiate, terminal ``confirmed`` / ``expired`` rows from
  the status flow (Task 4); ``checked_at`` is NULL until a terminal
  outcome. ``ip_hash`` is a masked client IP (the IP gates are central
  to initiate — the journal must carry the trace). No api keys, no
  handles, no request bodies. Retention is not configured — the volume
  is tiny, rows accumulate.
"""

import hashlib
import hmac
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from src.core.config import settings
from src.db.base import Base

# NOTE: this module is a LEAF by contract — src/models/__init__.py
# registration-imports it (the otp.py pattern), so it must never import
# anything that leads back into src.models (e.g. callcheck_provider →
# scope → permissions). The purge TTL therefore lives in
# callcheck_store.py next to the janitor that enforces it.

# status vocabulary (auth_calls)
AUTH_CALL_STATUS_PENDING = "pending"
AUTH_CALL_STATUS_CONSUMED = "consumed"
AUTH_CALL_STATUS_EXPIRED = "expired"

# outcome vocabulary (auth_call_attempts)
ATTEMPT_OUTCOME_CREATED = "created"
ATTEMPT_OUTCOME_CONFIRMED = "confirmed"
ATTEMPT_OUTCOME_EXPIRED = "expired"


class AuthCall(Base):
    """The active check row; the phone is the key (one live check)."""

    __tablename__ = "auth_calls"

    phone: Mapped[str] = mapped_column(String(20), primary_key=True)
    #: The provider's check id (sms.ru ``check_id``) — polled by Task 4.
    provider_check_id: Mapped[str] = mapped_column(String(64))
    #: The number the CLIENT calls — canonical ``+7…`` (spec §Эндпоинты).
    call_phone: Mapped[str] = mapped_column(String(20))
    #: HMAC-SHA-256 hexdigest of the one-time handle (never the raw one).
    handle_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class AuthCallAttempt(Base):
    """Append-only journal of callcheck outcomes (incident analysis)."""

    __tablename__ = "auth_call_attempts"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    phone: Mapped[str] = mapped_column(String(20))
    #: Masked initiator/poller IP (HMAC, same pepper) — the IP-gate trace.
    ip_hash: Mapped[str] = mapped_column(String(64))
    provider_check_id: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime)
    #: NULL until a terminal outcome (``confirmed`` / ``expired`` — Task 4).
    checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def _hmac_hex(value: str) -> str:
    """HMAC-SHA-256(``value``, key=OTP_PEPPER) hexdigest — the shared
    auth masking primitive (the §4.1 mechanism; the pepper lives in env
    settings, outside the DB)."""
    return hmac.new(
        settings.OTP_PEPPER.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def new_handle() -> str:
    """A fresh one-time status handle: uuid4 hex (the response shape of
    Task 3's initiate — 32 hex chars, handed to the client in full)."""
    return uuid.uuid4().hex


def hash_handle(handle: str) -> str:
    """Digest of the one-time status handle.

    The same mechanism AND pepper as the OTP codes (domain rule): a DB
    dump alone cannot mount offline guesses at the handle space.
    """
    return _hmac_hex(handle)


def hash_ip(ip: str) -> str:
    """Masked client IP for the journal.

    One-way: a leaked journal does not deanonymize the IP space, while
    equal ips still hash equal — the incident-analysis grouping key.
    """
    return _hmac_hex(ip)
