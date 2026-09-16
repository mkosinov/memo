"""User settings ORM model — stores per-user preferences."""

from sqlalchemy import Boolean, ForeignKey, String, Text
import sqlalchemy as sa
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
    # GH #267: schedule archived-visibility toggles (masters default ON,
    # locations default OFF — docs/domain-rules/user_settings.md).
    show_archived_masters: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=sa.true(),
    )
    show_archived_locations: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa.false(),
    )
