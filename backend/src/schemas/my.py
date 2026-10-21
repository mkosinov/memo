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

from datetime import date, datetime
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


class PortraitResponse(BaseModel):
    """POST /my/portrait success body (GH #262 Task 2, spec §4)."""

    avatar_url: str


class MyClientResponse(BaseModel):
    """GET /api/v1/my/client — the client cabinet's «who am I» (#499 §4.3).

    ``phone`` is the confirmed account phone; ``name`` comes from the
    linked client card (``users.client_id``) and may be ``null`` — a
    cardless account, or a card with no name set (spec §4.2: the OTP
    verify response uses the same shape).
    """

    phone: str
    name: str | None = None


# ─── #499 §5 — client booking: POST /api/v1/my/records ─────────────────────────

# Wire bounds mirror the existing VisitItem (records schema): no explicit
# string/age limits there, so none are invented here — the strictness of
# this branch is the FIELD SET (extra="forbid" everywhere), not bounds.
MY_RECORD_MAX_VISITS = 20


class MyVisitCreate(BaseModel):
    """One seat of the client booking form (spec §5).

    Strict (``extra="forbid"``): the wire never carries ``visitor_id`` /
    ``price`` / ``custom_price`` / ``status`` — visitors resolve by
    ``name`` (or anonymously), the price is computed SERVER-side from
    ``tariff_id``, and the status is the server default. ``name`` left
    out → an anonymous visit (the existing semantics).
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    age: int | None = None
    tariff_id: str | None = None


class MyRecordCreate(BaseModel):
    """``POST /api/v1/my/records`` body (#499 §5) — the strict booking wire.

    From the wire there is deliberately NO ``client_id`` / ``visitor_id`` /
    ``price`` / ``custom_price`` / ``notify`` / ``status``: the owner comes
    ONLY from the client session, visit prices are computed server-side
    from the service's tariffs, and notifications are never opted into on
    this branch. ``phone`` is the record's contact phone — domain
    validation only (422 ``PHONE_INVALID``), never a client lookup key.
    """

    model_config = ConfigDict(extra="forbid")

    activity_id: str
    phone: str
    comment: str | None = None
    visits: list[MyVisitCreate] = Field(min_length=1, max_length=MY_RECORD_MAX_VISITS)


class MyVisitResponse(BaseModel):
    """One created visit as the booking form sees it — no service fields.

    ``name``/``age`` echo the wire (visit rows carry no names — visitors
    do); ``tariff_id``/``price`` are what the server persisted.
    """

    name: str | None = None
    age: int | None = None
    tariff_id: str | None = None
    price: int


class MyRecordResponse(BaseModel):
    """201 body of the client booking (spec §5).

    ``start`` is the activity's date (from the record's activity) — ISO
    datetime exactly as ``ActivityResponse.start`` serializes it. No
    ``record_id`` on visits, no timestamps, no statuses — the minimum
    the success screen renders.
    """

    id: str
    activity_id: str
    start: datetime
    comment: str | None = None
    visits: list[MyVisitResponse]


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
