"""User settings ORM model — stores per-user preferences."""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.abstract import AbstractModel


class UserSettings(AbstractModel):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), unique=True, nullable=False,
    )
    theme: Mapped[str] = mapped_column(String(10), default="light")
    language: Mapped[str] = mapped_column(String(5), default="ru")
    column_order_masters: Mapped[str] = mapped_column(
        Text, default="[]",
    )
    column_order_locations: Mapped[str] = mapped_column(
        Text, default="[]",
    )
