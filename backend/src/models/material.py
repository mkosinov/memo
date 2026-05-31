"""Material ORM model for art technique references."""

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.abstract import AbstractModel


class Material(AbstractModel):
    __tablename__ = "materials"

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
