"""Pydantic schemas for the self-service «Мои данные» profile (GH #262).

``GET/PUT /api/v1/my`` — one flat shape for both (spec §4):

* public half from the staff card (``first_name``/``last_name``/
  ``avatar_url``) and the master-section CSV (``specialties`` as an
  array for display);
* private half from the lazily created ``user_profiles`` row (spec §3.1).

PUT semantics (domain-rules/profile.md): an **omitted** key keeps its
current value; an explicit ``null`` **clears** it (nullable columns
only). ``first_name``/``last_name`` are required-and-non-empty **when
present** and are written to the staff card. ``specialties`` is
READ-ONLY here — present in the response, ignored on write (the admin
owns the master section, #266 D5).
"""

from __future__ import annotations

from datetime import date
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MyProfileResponse(BaseModel):
    """Flat GET/PUT response per spec §4 (same shape for both)."""

    role: str
    has_staff: bool
    has_master: bool
    # Public half — the linked staff card / master section; null when
    # has_staff/has_master is false (archived card = no staff for /my).
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None
    specialties: list[str] | None = None
    # Private half — the owner-only user_profiles columns.
    patronymic: str | None = None
    birth_date: date | None = None
    residence_address: str | None = None
    birth_place: str | None = None
    passport_series_number: str | None = None
    passport_issued_date: date | None = None
    passport_issued_by: str | None = None
    registration_address: str | None = None


class MyProfileUpdate(BaseModel):
    """PUT body — only sent keys apply; ``null`` clears a nullable field.

    ``first_name``/``last_name``/``avatar_url`` write the STAFF CARD and
    apply only while ``has_staff`` (a cardless/archived user's name
    writes are ignored, D7). The names are required-and-non-empty when
    present — the card columns are NOT NULL, so a ``null``/blank value
    is a 422 (null-clears applies to nullable columns only).
    ``specialties`` is accepted-but-ignored (read-only, #266 D5).
    """

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(
        default=None, min_length=1, max_length=100
    )
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar_url: str | None = Field(default=None, max_length=2048)
    # Read-only in this endpoint — schema accepts it for round-tripping
    # the response shape, the service never applies it.
    specialties: list[str] | None = None
    patronymic: str | None = Field(default=None, max_length=100)
    birth_date: date | None = None
    residence_address: str | None = Field(default=None, max_length=255)
    birth_place: str | None = Field(default=None, max_length=255)
    passport_series_number: str | None = Field(default=None, max_length=30)
    passport_issued_date: date | None = None
    passport_issued_by: str | None = Field(default=None, max_length=255)
    registration_address: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _names_reject_explicit_null(self) -> Self:
        """``null`` clears only NULLABLE columns — the card names are NOT
        NULL, so an explicit ``first_name/last_name: null`` is a 422 (an
        OMITTED key stays ``None`` here and simply means "keep").
        """
        for field in ("first_name", "last_name"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(
                    f"{field} обязателен — укажите значение или уберите ключ"
                )
        return self
