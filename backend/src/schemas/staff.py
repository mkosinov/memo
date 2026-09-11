"""Pydantic schemas for the staff directory (GH #266 D5/D6/D8).

Composite card contract: the person (``staff``) carries an optional master
section (``master: {specialty, color} | null`` — the 1:0..1 ``masters``
extension), a list of position ids (M2M ``staff_positions``), and — on
create only — an account-creation flag (``create_user: {phone, password} |
false``). ``StaffResponse`` inverts ``is_active`` into ``archived`` like
every archive-aware entity; the embedded ``master`` view carries its own
``archived`` (the schedule flag, D3).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

# Sort whitelist for GET /api/v1/staff (#266 «API (после)»): position is
# EXCLUDED — a person holds several positions (M2M), server-side sort over
# the join is ambiguous. Keys = the StaffTable column keys.
StaffSortBy = Literal["name", "specialty", "color", "avatar", "status"]


class MasterSection(BaseModel):
    """Master section of the card (D5): specialty + color, both required.

    Presence is validated at the SERVICE level
    (``SPECIALTY_REQUIRED``/``COLOR_REQUIRED`` error codes, spec «Контракты
    ошибок») — so the schema deliberately accepts absent/blank values and
    defaults them to ``""`` instead of rejecting here with a generic
    VALIDATION_ERROR.
    """

    model_config = ConfigDict(extra="forbid")

    specialty: str = ""
    color: str = ""


class MasterSectionView(BaseModel):
    """Master-section projection in ``StaffResponse`` (schedule side)."""

    model_config = ConfigDict(from_attributes=True)

    specialty: str
    color: str
    is_active: bool = Field(exclude=True)
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def archived(self) -> bool:
        """Schedule-archive flag, inverted like every archive-aware entity."""
        return not self.is_active


class CreateUserSection(BaseModel):
    """Account-creation checkbox (D6): phone + password, create-only."""

    model_config = ConfigDict(extra="forbid")

    phone: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=64)


class StaffBase(BaseModel):
    """Shared person fields for create/update."""

    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    avatar_url: str | None = None
    sort_order: int = 0


class StaffCreate(StaffBase):
    """Request schema for creating a staff card (D6 flags included).

    ``create_user`` is CREATE-ONLY: it never appears on update (an account
    is created exactly once, with the card or later via #263).
    """

    model_config = ConfigDict(extra="forbid")

    master: MasterSection | None = None
    position_ids: list[str] = []
    create_user: CreateUserSection | Literal[False] = False


class StaffUpdate(StaffBase):
    """Request schema for full update via PUT — card + sections, atomically.

    ``master``: section payload = upsert; ``null`` = remove (blocked by
    activities, D7). ``position_ids`` = full replace. ``is_active`` is NOT
    accepted (#178/#207 pattern): lifecycle goes through the archive/restore
    POST endpoints.
    """

    model_config = ConfigDict(extra="forbid")

    master: MasterSection | None = None
    position_ids: list[str] = []


class StaffPatch(BaseModel):
    """Request schema for partial update (PATCH) — only sent keys apply.

    ``master`` is three-state here: absent = keep the section as is;
    ``null`` = remove; payload = upsert. ``position_ids`` applies only when
    sent (full replace of the set).
    """

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar_url: str | None = None
    sort_order: int | None = None
    master: MasterSection | None = None
    position_ids: list[str] | None = None


class StaffResponse(StaffBase):
    """Response schema for a staff card (master section + positions filled).

    ``archived`` = person archive (``staff.is_active`` inverted, #207 §3.1
    pattern); ``master.archived`` = schedule flag (D3) — independent.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    master: MasterSectionView | None = None
    position_ids: list[str] = []
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(exclude=True)

    @computed_field
    @property
    def archived(self) -> bool:
        return not self.is_active


class StaffArchiveRequest(BaseModel):
    """Body of POST /staff/{id}/archive — D6 dismissal checkboxes.

    Defaults ``true`` mirror the preselected dialog checkboxes: an archive
    call without a body = consent to the preselected choice (D6).
    """

    model_config = ConfigDict(extra="forbid")

    archive_master: bool = True
    archive_user: bool = True
