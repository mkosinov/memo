"""Visitor ORM model."""

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.abstract import AbstractModel


class Visitor(AbstractModel):
    __tablename__ = "visitors"

    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id"))
    name: Mapped[str] = mapped_column(String(200))
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
