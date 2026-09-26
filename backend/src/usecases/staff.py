"""Staff scenarios — multi-entity business actions around a staff card.

GH #326 Task 3 — the ``usecases`` layer, Corridor 2 of the service canon
(docs/domain-rules/service-layer.md rule 2): each scenario is a public
function named after the business action, decorated ``@transactional``
(ONE transaction + ONE event batch per action), composing the
non-transactional building blocks of the OWNERS only — no runtime
ORM-model imports (``UserRole`` is a dictionary enum, not an ORM model):

* card row + own ``staff_positions`` bundle — :class:`StaffService`
  blocks (``create_card`` / ``update_card`` / ``patch_card`` /
  ``archive_card`` / ``replace_positions`` — the record_tags precedent:
  own child rows without a lifecycle of their own stay with the parent);
* masters extension — :class:`MasterService` (GH #326 Task 2);
* account/role — :class:`UserService` + :func:`resolve_account_role`
  (GH #326 Task 1).

Behavior-preserving extraction of the former ``StaffService.create`` /
``update`` / ``patch`` / ``archive`` chains (step order and semantics
are byte-identical to the pre-refactor flow; spec §Behavioral Delta:
до = после). ``restore`` stays a decorated ``StaffService`` method
(Corridor 1 — one table, own endpoint).

CALLING CONVENTION: the ``@transactional`` wrapper's signature is
``wrapper(self, *args, **kwargs)`` — a module-level scenario therefore
MUST be called with an explicit leading ``None`` (the unused ``self``
slot) and keyword arguments::

    card = await create_staff(None, db_session=session, data=data)

A bare positional call would bind the session to the wrapper's ``self``
slot and shift every argument — that misdirection fails loudly
(TypeError), never silently. The selfless path opens the accumulator
EMPTY — no auto entity-mark — so every scenario marks its OWN entity
explicitly (``mark_changed("staff")``), keeping the published event
grid byte-identical to the former method-based flows (the decorated
``StaffService`` methods auto-marked "staff").

EVENT GRID (GH #239) — "staff" ALWAYS; conditional marks fire by FACT
OF CHANGE inside the owner blocks (row written / rowcount > 0), pinned
as the pre-refactor oracle by ``tests/usecases/test_staff_*.py``:

- ``create_staff`` — {staff} + masters (section sent) +
  staff_positions (non-empty set) + users (account checkbox);
- ``update_staff`` / ``patch_staff`` — {staff} + the same conditionals
  for the parts actually written;
- ``archive_staff`` — {staff} + masters/users per checkbox AND a real
  rowcount (an already-archived link adds nothing);
- every failure branch publishes nothing (rollback silence).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.events.emitter import mark_changed
from src.services.decorators import transactional
from src.services.master import get_master_service
from src.services.staff import get_staff_service
from src.services.user import get_user_service, resolve_account_role

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.enums import UserRole
    from src.schemas.staff import (
        CreateUserSection,
        MasterSection,
        StaffCreate,
        StaffPatch,
        StaffResponse,
        StaffUpdate,
    )


def _account_section(data: StaffCreate) -> CreateUserSection | None:
    """The D6 account checkbox, or ``None`` when unchecked."""
    return data.create_user if data.create_user else None


async def _write_section(
    db_session: AsyncSession,
    staff_id: str,
    section: MasterSection | None,
) -> None:
    """Upsert (payload) / remove (``None``) the masters extension row."""
    if section is None:
        await get_master_service().remove_extension(db_session, staff_id)
        return
    await get_master_service().upsert_extension(
        db_session,
        staff_id,
        section.specialty,
        section.color,
        archived=section.archived,
    )


async def _apply_role_template(
    db_session: AsyncSession,
    staff_id: str,
    position_ids: list[str],
    *,
    explicit_role: UserRole | None = None,
) -> None:
    """GH #263 D10 — the position set templates the linked account role.

    Applied when the position set changes (PUT always carries the set;
    PATCH only when ``position_ids`` was sent). Template = highest
    anchor (admin > master); an explicit ``role`` in the request body
    beats the template (manual role editing stays). No anchored position
    and no explicit role → the role is NOT touched (custom positions
    never influence it; losing master/admin is not a downgrade). No
    linked account → nothing to template (no-op).
    """
    from src.services.user import _template_role

    role = explicit_role if explicit_role is not None else _template_role(position_ids)
    if role is None:
        return
    await get_user_service().set_role_by_staff(db_session, staff_id, role)


@transactional
async def create_staff(db_session: AsyncSession, data: StaffCreate) -> StaffResponse:
    """Create a staff card — the whole composite chain in ONE transaction.

    Formerly ``StaffService.create`` (behavior-for-behavior move). Step
    order is identical to the pre-refactor flow:

    0. mark the own entity ("staff") — parity with the auto-mark the
       decorated method used to seed;
    1. person card row (``StaffService.create_card``);
    2. master section, optional (``MasterService.upsert_extension`` —
       the D5 blank-field domain check fires inside the owner);
    3. positions replace on the fresh card — validated set, deduped
       (``StaffService.replace_positions``; marks "staff_positions"
       only on a non-empty set);
    4. account checkbox (create-only, D6): role from
       :func:`resolve_account_role` (explicit → position template → the
       #247 master-section fallback); ``UserService.create_staff_account``
       validates + hashes the password INSIDE.

    NOTE: call as ``create_staff(None, db_session=..., data=...)`` — see
    the module docstring for why.
    """
    # Own-entity mark — the selfless @transactional path seeds an EMPTY
    # accumulator (no auto-mark), so publish parity with the former
    # decorated StaffService.create requires this here.
    mark_changed("staff")

    # ── 1. Person card ──────────────────────────────────────────────
    staff = await get_staff_service().create_card(
        db_session,
        first_name=data.first_name,
        last_name=data.last_name,
        avatar_url=data.avatar_url,
        sort_order=data.sort_order,
    )

    # ── 2. Master section (optional) ─────────────────────────────────
    if data.master is not None:
        await _write_section(db_session, staff.id, data.master)

    # ── 3. Positions (own M2M bundle; validated, deduped) ────────────
    if data.position_ids:
        await get_staff_service().replace_positions(
            db_session, staff.id, data.position_ids
        )

    # ── 4. Account checkbox (create-only, D6) ────────────────────────
    account = _account_section(data)
    if account is not None:
        role = resolve_account_role(
            account.role,
            data.position_ids,
            has_master_section=data.master is not None,
        )
        await get_user_service().create_staff_account(
            db_session,
            staff_id=staff.id,
            phone=account.phone,
            password=account.password,
            role=role,
        )

    # ── Response assembly (readers — no second publication) ──────────
    await db_session.flush()
    response = await get_staff_service().get(db_session, staff.id)
    assert response is not None, "just-created card must read back"
    return response


@transactional
async def update_staff(
    db_session: AsyncSession,
    id: str,
    data: StaffUpdate,
) -> StaffResponse | None:
    """Full-update a staff card (PUT semantics).

    Formerly ``StaffService.update``. Step order is identical to the
    pre-refactor flow:

    0. mark the own entity ("staff");
    1. card fields (``StaffService.update_card``; missing id → None —
       the route maps that to 404);
    2. master section upsert/remove (``MasterService`` — the D7
       activities block fires inside ``remove_extension``);
    3. positions full replace (own bundle);
    4. role template (PUT always carries the position set → the linked
       account follows the D10 template unless the body carries an
       explicit role).

    NOTE: call as ``update_staff(None, db_session=..., id=..., data=...)``.
    """
    mark_changed("staff")

    # ── 1. Card fields (missing id → None) ───────────────────────────
    staff = await get_staff_service().update_card(
        db_session,
        id,
        first_name=data.first_name,
        last_name=data.last_name,
        avatar_url=data.avatar_url,
        sort_order=data.sort_order,
    )
    if staff is None:
        return None

    # ── 2. Master section upsert/remove ──────────────────────────────
    await _write_section(db_session, id, data.master)

    # ── 3. Positions full replace ────────────────────────────────────
    await get_staff_service().replace_positions(db_session, id, data.position_ids)

    # ── 4. Role template ─────────────────────────────────────────────
    await _apply_role_template(
        db_session, id, data.position_ids, explicit_role=data.role
    )

    await db_session.flush()
    return await get_staff_service().get(db_session, id)


@transactional
async def patch_staff(
    db_session: AsyncSession,
    id: str,
    data: StaffPatch,
) -> StaffResponse | None:
    """Partial-update a staff card — only sent keys apply.

    Formerly ``StaffService.patch`` + ``_patch_composite``. The PATCH
    preparation (three-state ``master``, sent-sets, null-stripping over
    ``NOT_NULL_FIELDS``) is unchanged, now living here:

    0. mark the own entity ("staff");
    1. PATCH payload build — ``model_dump(exclude_unset=True)`` with
       ``None`` values for NOT NULL fields (first_name / last_name /
       sort_order) stripped ("don't change", not "set to null");
       ``master`` / ``position_ids`` / ``role`` are pulled out of the
       card payload and handled as sent-sets below;
    2. sent card fields (``StaffService.patch_card``; missing id → None);
    3. ``master`` sent (three-state): payload = upsert, ``null`` =
       remove (D7 block inside the owner), absent = keep;
    4. ``position_ids`` sent: full replace + role template; role sent
       WITHOUT the set → manual override only;
    5. response assembly.

    NOTE: call as ``patch_staff(None, db_session=..., id=..., data=...)``.
    """
    mark_changed("staff")

    service = get_staff_service()
    payload = service.patch_payload(data)
    master_sent = "master" in payload
    # The ORIGINAL schema object, not the payload dump: the owner block
    # needs the section object (specialty/color/archived), and the dict
    # form loses attribute access.
    master_section = data.master if master_sent else None
    positions_sent = "position_ids" in payload
    position_ids = payload.pop("position_ids", None)
    payload.pop("master", None)
    # Role (GH #263 D10): absent or null body value = no override → the
    # template decides when the set changes; a sent value wins.
    payload.pop("role", None)

    # ── Sent card fields (missing id → None) ─────────────────────────
    staff = await service.patch_card(db_session, id, payload)
    if staff is None:
        return None

    # ── Three-state master section ───────────────────────────────────
    if master_sent:
        await _write_section(db_session, id, master_section)

    # ── Position set + role template ─────────────────────────────────
    if positions_sent and position_ids is not None:
        await service.replace_positions(db_session, id, position_ids)
        await _apply_role_template(
            db_session, id, position_ids, explicit_role=data.role
        )
    elif data.role is not None:
        # Role sent WITHOUT a position-set change — manual override only
        # (the body beats the template). Empty position ids → template
        # yields None → the explicit role applies.
        await _apply_role_template(db_session, id, [], explicit_role=data.role)

    await db_session.flush()
    return await service.get(db_session, id)


@transactional
async def archive_staff(
    db_session: AsyncSession,
    id: str,
    archive_master: bool = True,
    archive_user: bool = True,
) -> bool:
    """Archive the person + apply the CHECKED existing ACTIVE links (D6).

    Formerly ``StaffService.archive``. Step order is identical to the
    pre-refactor flow:

    0. mark the own entity ("staff");
    1. existence probe + person flag (``StaffService.archive_card``;
       missing id → ``False`` — the route maps that to 404);
    2. ``archive_master`` checkbox → ``MasterService
       .archive_active_extension`` (rowcount over ACTIVE rows only — an
       already-archived section is untouched, never resurrected);
    3. ``archive_user`` checkbox → ``UserService
       .deactivate_active_by_staff`` (same rowcount semantics).

    Unchecked links keep their flags (D3 — no hidden cascades, nothing
    silently restores). Grid: {staff} + masters/users by real rowcount.

    NOTE: call as ``archive_staff(None, db_session=..., id=...,
    archive_master=..., archive_user=...)``.
    """
    mark_changed("staff")

    # ── Existence probe + person flag ────────────────────────────────
    found = await get_staff_service().archive_card(db_session, id)
    if not found:
        return False

    # ── D6 checkboxes — existing ACTIVE links only ───────────────────
    if archive_master:
        await get_master_service().archive_active_extension(db_session, id)
    if archive_user:
        await get_user_service().deactivate_active_by_staff(db_session, id)
    await db_session.flush()
    return True
