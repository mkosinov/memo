"""Visitor ORM model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModelSoftDelete

if TYPE_CHECKING:
    from src.models.tag import Tag


class Visitor(AbstractModelSoftDelete):
    __tablename__ = "visitors"

    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id"))
    name: Mapped[str] = mapped_column(String(200))
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="visitor_tags", back_populates="visitors"
    )
