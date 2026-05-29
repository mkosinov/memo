"""Tariff ORM model."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.abstract import AbstractModel

if TYPE_CHECKING:
    from app.db.models.service import Service


class Tariff(AbstractModel):
    __tablename__ = "tariffs"

    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"))
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[int] = mapped_column(Integer)

    service: Mapped["Service"] = relationship("Service", back_populates="tariffs")
