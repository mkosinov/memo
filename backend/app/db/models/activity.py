"""Activity ORM model."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.abstract import AbstractModel


class Activity(AbstractModel):
    __tablename__ = "activities"

    master_id: Mapped[str] = mapped_column(String(36), ForeignKey("masters.id"))
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"))
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id"))
    start: Mapped[datetime] = mapped_column(DateTime)
    duration: Mapped[int] = mapped_column(Integer)
    capacity: Mapped[int] = mapped_column(Integer)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    record_info: Mapped[str | None] = mapped_column(Text, nullable=True)
