"""Visit ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModel

if TYPE_CHECKING:
    from src.models.record import Record
    from src.models.tariff import Tariff


class Visit(AbstractModel):
    __tablename__ = "visits"

    record_id: Mapped[str] = mapped_column(String(36), ForeignKey("records.id"))
    visitor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("visitors.id"), nullable=True)
    tariff_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tariffs.id"), nullable=True)
    price: Mapped[int] = mapped_column(Integer)
    custom_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20))

    record: Mapped["Record"] = relationship("Record", back_populates="visits")
    tariff: Mapped["Tariff | None"] = relationship("Tariff")
