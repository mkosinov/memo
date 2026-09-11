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
    # GH #266: column_order_staff renamed → column_order_staff (order ids
    # in the data are preserved — staff ids are the former master ids).
    column_order_staff: Mapped[str] = mapped_column(
        Text, default="[]",
    )
    column_order_locations: Mapped[str] = mapped_column(
        Text, default="[]",
    )
