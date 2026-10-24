"""OTP code ORM model + hashing — GH #499 spec §4.1.

Server-side storage of pending phone-verification codes: exactly one live
code per phone (``phone`` is the PK — a new send replaces the row), the
raw code never touches the DB. ``code_hash`` is HMAC-SHA-256 keyed with
the ``OTP_PEPPER`` setting (env, outside the DB; constant-time compare on
verification) — a flat SHA-256 of a 6-digit code is brute-forceable
instantly on a leaked dump (§4.1). Rows are hard-deleted on use/expiry,
no soft-delete flag; expired rows are purged on phone access, there is
no background job (TTL 5 minutes, negligible volume).

The pepper and TTL constants follow the ``session.py`` precedent
(auth-package-local, G1b), except the pepper which is a deployment
secret and therefore lives in settings like ``SECRET_KEY``.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from src.core.config import settings
from src.db.base import Base
from src.util.utc import utc_now

# Spec §4.1: 6-digit code, 5-minute lifetime.
OTP_TTL = timedelta(minutes=5)
CODE_DIGITS = 6


class OtpCode(Base):
    """A pending phone-verification code; the phone is the key (one live code)."""

    __tablename__ = "otp_codes"

    phone: Mapped[str] = mapped_column(String(20), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64))  # HMAC-SHA-256 hexdigest
    expires_at: Mapped[datetime] = mapped_column(DateTime)   # created_at + OTP_TTL
    created_at: Mapped[datetime] = mapped_column(DateTime)


def new_code() -> str:
    """Uniform random 6-digit code (crypto RNG, zero-padded)."""
    return f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"


def hash_code(code: str) -> str:
    """HMAC-SHA-256(``code``, key=OTP_PEPPER) hexdigest.

    Keyed with the env-sourced pepper so a DB dump alone cannot brute
    the 6-digit space; comparison happens via ``hmac.compare_digest``.
    """
    return hmac.new(
        settings.OTP_PEPPER.encode("utf-8"),
        code.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def new_otp_code(phone: str, code: str) -> OtpCode:
    """Build a fresh OtpCode row for ``phone`` (hash + deadlines computed)."""
    now = utc_now()
    return OtpCode(
        phone=phone,
        code_hash=hash_code(code),
        expires_at=now + OTP_TTL,
        created_at=now,
    )
