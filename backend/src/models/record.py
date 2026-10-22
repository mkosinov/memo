"""Record ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModel

if TYPE_CHECKING:
    from src.models.tag import Tag
    from src.models.visit import Visit


class Record(AbstractModel):
    __tablename__ = "records"

    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("activities.id", ondelete="CASCADE"))
    client_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clients.id"), nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20))
    seats: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    custom_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # GH #482: form flag «отправлять оповещения» — fixed at creation (only
    # an authenticated actor can set it true; spec §3.3), read LIVE by the
    # dispatcher. No UI edits it after creation.
    notify: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa.false(),
    )

    visits: Mapped[list[Visit]] = relationship(
        "Visit", back_populates="record", lazy="selectin"
    )
    tags: Mapped[list[Tag]] = relationship(
        "Tag", secondary="record_tags", back_populates="records"
    )
