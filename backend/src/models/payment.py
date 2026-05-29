"""Payment ORM model."""

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.abstract import AbstractModel


class Payment(AbstractModel):
    __tablename__ = "payments"

    record_id: Mapped[str] = mapped_column(String(36), ForeignKey("records.id"))
    amount: Mapped[int] = mapped_column(Integer)
    method: Mapped[str | None] = mapped_column(String(20), nullable=True)
