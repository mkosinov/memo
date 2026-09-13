"""UserProfile ORM model — the private half of «Мои данные» (GH #262).

1:1 with ``users``; the row is created LAZILY on the first ``PUT /my``
that carries a private field (spec §3.1, domain-rules/profile.md) — no
pre-seeding, nothing on GET. Every column is optional (``null`` = the
field is cleared via an explicit ``null`` in ``PUT /my``; an omitted key
keeps its value).

The table is never joined into public serializers — that is a structural
boundary (D3), not serializer discipline: public endpoints cannot leak
what they never query.
"""

from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.abstract import AbstractModel


class UserProfile(AbstractModel):
    __tablename__ = "user_profiles"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), unique=True, nullable=False,
    )
    patronymic: Mapped[str | None] = mapped_column(String(100), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    residence_address: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    birth_place: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Серия и номер; normalized on save (trim + collapse inner whitespace
    # runs, spec §3.1).
    passport_series_number: Mapped[str | None] = mapped_column(
        String(30), nullable=True
    )
    passport_issued_date: Mapped[date | None] = mapped_column(
        Date, nullable=True
    )
    passport_issued_by: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    registration_address: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
