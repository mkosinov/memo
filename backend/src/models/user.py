"""User ORM model."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.abstract import AbstractModelSoftDelete


class User(AbstractModelSoftDelete):
    __tablename__ = "users"

    phone: Mapped[str] = mapped_column(String(20), unique=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    master_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("masters.id"), unique=True, nullable=True,
    )
    email_is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    phone_is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    # Login lockout ladder state (auth spec §2.11; logic in src/auth/service.py):
    # lock_level 0 none / 1 timed 15 min / 2 timed 1 h / 3 hard (locked_until
    # NULL) — cleared by an administrator via sqladmin.
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    lock_level: Mapped[int] = mapped_column(SmallInteger, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
