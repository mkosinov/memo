"""Pydantic schemas for the activities domain."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


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
