"""Pydantic schemas for the activities domain."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from src.schemas.pagination import PaginationParams


class ActivityListParams(PaginationParams):
    """Query parameters for GET /api/v1/activities (GH #371 §4.1).

    Composed of the ``PaginationParams`` brick (``page``/``per_page`` and
    the ``id`` set filter, #232 — ``?id=`` starts working on activities).
    The router's former scalar query siblings ride along 1:1:
    ``date_from``/``date_to`` (date), ``q`` (2..100), ``service_id``
    (``str`` — the pre-conversion annotation, no UUID tightening: spec
    §4.1 keeps the annotations, scenario 8 wire parity). The optional
    master scope is NOT a query field — it stays a Depends sibling
    (``get_optional_scope``; domain rule 8, #371). Injected as
    ``Annotated[ActivityListParams, Query()]`` — scalar query siblings
    are banned (fastapi PR #12481).
    """

    date_from: date | None = None
    date_to: date | None = None
    q: str | None = Field(default=None, min_length=2, max_length=100)
    service_id: str | None = None


class ActivityBase(BaseModel):
    """Shared fields for activity creation and updates."""

    master_id: str
    service_id: str
    location_id: str
    start: datetime
    duration: int  # minutes
    capacity: int
    is_private: bool = False
    comment: str | None = None
    record_info: str | None = None


class ActivityCreate(ActivityBase):
    """Request schema for creating a new activity."""

    pass


class ActivityUpdate(ActivityBase):
    """Request schema for updating an activity (full replacement via PUT)."""

    pass


class ActivityPatch(BaseModel):
    """Request schema for partially updating an activity (PATCH) — all fields optional."""

    master_id: str | None = None
    service_id: str | None = None
    location_id: str | None = None
    start: datetime | None = None
    duration: int | None = None  # minutes
    capacity: int | None = None
    is_private: bool | None = None
    comment: str | None = None
    record_info: str | None = None


class ActivityResponse(ActivityBase):
    """Response schema with all activity fields including computed occupied."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    occupied: int = 0  # computed: count of Records for this activity
    # Populated ONLY on list endpoints (Service join, GH #212 spec §5.3 point 7).
    # Single-item endpoints (get/create/update/patch) leave it None — the schema
    # is shared by all 5 activity endpoints, hence optional with a default.
    service_title: str | None = None


class PublicActivityListParams(PaginationParams):
    """Query params for ``GET /api/v1/public/activities`` (ADR-015, #600).

    Deliberately NOT ``ActivityListParams``: that schema carries the
    admin filter surface (``q`` / ``service_id``, see the fields above)
    — wiring it into the anonymous schedule route would activate those
    filters for anonymous callers (surface widening, ADR-015). The
    schedule adds exactly TWO filters on top of the pagination brick:
    ``date_from``/``date_to`` (``date``, whole-day inclusive via the
    shared ``day_range`` canon). When ``date_from`` is absent the view
    defaults the window's lower bound to today (the web schedule never
    shows the past). Injected ONLY as ``Annotated[
    PublicActivityListParams, Query()]`` — no scalar-param siblings
    (fastapi #12481, domain rule 8).
    """

    date_from: date | None = None
    date_to: date | None = None


class ActivityPublicResponse(BaseModel):
    """Public schedule activity — deliberately NOT ActivityResponse (ADR-015).

    Audience schema for the anonymous schedule
    ``GET /api/v1/public/activities`` (#600): only what the web schedule
    consumes. ``occupied`` rides the same bulk SUM(seats) computation as
    the staff list. ``is_private``/``comment``/``record_info``,
    timestamps and ``service_title`` never leave through this schema —
    ``is_private`` is a forced server-side exclusion on the route.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    service_id: str
    master_id: str
    location_id: str
    start: datetime
    duration: int  # minutes
    capacity: int
    occupied: int = 0  # computed: SUM(seats) of active Records


class ActivityCopyWeekRequest(BaseModel):
    """Request schema for copy-week (GH #242, spec §4).

    ``week_start`` is the Monday of the TARGET week; the Monday check itself
    is a server-side guard (422 COPY_WEEK_START_NOT_MONDAY), not a schema rule.
    ``locations`` is the explicit list of location ids checked in the popup —
    strictly required (no "None = all" encoding); an empty list is rejected
    via min_length=1 (FastAPI maps the ValidationError to 422 VALIDATION_ERROR).
    """

    week_start: date
    locations: list[str] = Field(..., min_length=1)


class CopyWeekResult(BaseModel):
    """Response schema for copy-week — four independent counters (spec §4)."""

    copied: int
    skipped_duplicates: int
    skipped_filtered: int
    skipped_no_master: int


class ActivityDeleteBody(BaseModel):
    """DELETE /api/v1/activities/{id} body — the deferred-delete commit
    state (#286 D2, mirror of the records ``RecordDeleteBody`` #285 rev7).

    ``expected`` — id-sets per dependency entity of the RECURSIVE
    two-level subtree (records / visits / payments — the user-confirmed
    dry-run tree; auto deps photos/activity_tags are exempt from the
    check); the clean path sends ``{}``.

    Optional at the schema level: ``?dry_run=true`` needs no body, and the
    execute-path requirement (``expected`` mandatory) is enforced in the
    route branch so the preview stays body-free.
    """

    expected: dict[str, list[str]] | None = None
