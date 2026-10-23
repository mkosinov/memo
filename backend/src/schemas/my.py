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

from datetime import date, datetime, time  # noqa: TC003 — runtime pydantic model fields
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.domain.visit_status import VisitStatus  # noqa: TC001 — runtime pydantic model field
from src.models.enums import PaymentMethod  # noqa: TC001 — runtime pydantic model field


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


# ─── #513 — client cabinet read: GET /api/v1/my/records ────────────────────────


class MyVisitItem(BaseModel):
    """One visit inside ``GET /api/v1/my/records`` items (spec §«Контракт API»).

    Per-endpoint visit shape — deliberately NOT ``VisitResponse``: no
    ``tariff_id``/``visitor_id``/``record_id``/``custom_price``/timestamps
    (the spec's «не входят» list). ``visitor_name`` is the linked
    Visitor's name (``null`` for an anonymous seat — legal per domain);
    ``price`` is the creation-time SNAPSHOT: visit ``custom_price`` when
    set, else the stored ``price`` — never derived from the tariff on
    read (#357 invariant).
    """

    id: str
    visitor_name: str | None = None
    status: VisitStatus
    price: int


class MyRecordItem(BaseModel):
    """``items[]`` element of ``GET /api/v1/my/records`` (spec §«Контракт API»).

    ``activity_date``/``activity_start``/``activity_end`` are computed
    from the record's activity (the model stores only start + duration
    in minutes; end = start + duration, time-of-day after a midnight
    rollover, date always the start's date). No service fields:
    ``client_id``/``activity_id``/``seats``/record ``status``/
    record ``custom_price`` and the visits' service fields stay out —
    the client sees per-visit status/price only.
    """

    id: str
    activity_date: date
    activity_start: time
    activity_end: time
    # FK-enforced join (activities.service_id → services.id) keeps the
    # title always present — typed plain ``str`` per the spec table.
    service_title: str
    comment: str | None = None
    visits: list[MyVisitItem]


# ─── #513 — client cabinet read: GET /api/v1/my/photos ────────────────────────


class MyPhotoItem(BaseModel):
    """``items[]`` element of ``GET /api/v1/my/photos`` (spec §«Контракт API»).

    Per-endpoint photo shape — deliberately NOT ``PhotoResponse``: no
    ``client_id``/``client_name`` (the requester IS the client),
    ``service_id``/``activity_id``/``location_id`` owner slots, no
    ``updated_at`` (the spec's «не входят» list). ``tags`` are resolved
    server-side to tag NAMES (string[]) — tag objects with ids stay in
    the admin contract.
    """

    id: str
    filename: str
    is_public: bool
    tags: list[str]
    created_at: datetime


# ─── #513 — client cabinet read: GET /api/v1/my/payments ───────────────────────


class MyPaymentRecordContext(BaseModel):
    """Brief record context inside a payment item (spec §«Контракт API»).

    ALWAYS present: ``record_id`` is a mandatory FK and payments are
    deleted with the record, so the ``null`` branch does not exist.
    Exactly these three fields — full record data stays out.
    """

    id: str
    activity_date: date
    # FK-enforced join (activities.service_id → services.id) keeps the
    # title always present — typed plain ``str`` per the spec table.
    service_title: str


class MyPaymentItem(BaseModel):
    """``items[]`` element of ``GET /api/v1/my/payments`` (spec §«Контракт API»).

    Ownership is THROUGH the record (a payment is "mine" iff its record
    belongs to the session's client). ``method`` is nullable by model
    (``null`` → «Способ не указан» on the screen). No ``updated_at``.
    """

    id: str
    amount: int
    method: PaymentMethod | None = None
    created_at: datetime
    record: MyPaymentRecordContext


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
