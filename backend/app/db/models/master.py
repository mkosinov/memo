"""Master ORM model."""

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.abstract import AbstractModel


class Master(AbstractModel):
    __tablename__ = "masters"

    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(7))
    position: Mapped[str] = mapped_column(String(20))
    specialty: Mapped[str] = mapped_column(String(20))
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
