"""Visit ORM model."""

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModel


class Visit(AbstractModel):
    __tablename__ = "visits"

    record_id: Mapped[str] = mapped_column(String(36), ForeignKey("records.id"))
    visitor_id: Mapped[str] = mapped_column(String(36), ForeignKey("visitors.id"))
    price: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))

    record: Mapped["Record"] = relationship("Record", back_populates="visits")
