"""Tariff ORM model."""

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.abstract import AbstractModel


class Tariff(AbstractModel):
    __tablename__ = "tariffs"

    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"))
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[int] = mapped_column(Integer)
