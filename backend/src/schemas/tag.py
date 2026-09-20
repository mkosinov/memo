"""Pydantic schemas for the tags domain."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

# Sort whitelist for GET /api/v1/tags (#205 Task 3, spec §4.5; #172: ``tag``
# → ``title`` — thing-title canon).
TagSortBy = Literal["title"]


class TagCreate(BaseModel):
    title: str


class TagPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/tags/{id}).

    All fields optional. None means 'don't change'.
    """

    title: str | None = None


class TagDeleteBody(BaseModel):
    """DELETE /api/v1/tags/{id} body — the deferred-delete commit state
    (#318 D2, mirror of ``RecordDeleteBody`` / #285 rev7).

    Every real deletion must declare the dependency state the caller saw
    at dry-run time:

    * ``expected`` — id-sets per FK entity (parent ids from the 409 tree's
      ``items``); the clean path sends ``{}``. All 8 Tag join deps are
      NON-auto (D1) — every confirmed id-set participates, no exemptions.
    * ``resolutions`` — the user's cascade choices (§6); an occupied tag
      sends ``{"service_tags": "cascade", ...}`` for every non-zero dep
      alongside ``expected``.

    Both optional at the schema level: ``?dry_run=true`` needs no body, and
    the execute-path requirement (``expected`` mandatory) is enforced in
    the route branch so the preview stays body-free. Unknown body keys are
    ignored (family semantics §16).
    """

    resolutions: dict[str, str] | None = None
    expected: dict[str, list[str]] | None = None


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
