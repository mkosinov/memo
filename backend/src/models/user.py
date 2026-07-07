"""User ORM model."""

from sqlalchemy import Boolean, ForeignKey, String
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
