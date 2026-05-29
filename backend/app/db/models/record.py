"""Record ORM model."""

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.abstract import AbstractModel


class Record(AbstractModel):
    __tablename__ = "records"

    activity_id: Mapped[str] = mapped_column(String(36), ForeignKey("activities.id"))
    client_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clients.id"), nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20))
    seats: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    visits: Mapped[list["Visit"]] = relationship(
        "Visit", back_populates="record", lazy="selectin"
    )
