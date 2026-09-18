"""Domain layer — FK dependency matrix + dependency resolver for hard-delete.

Single source of truth for the GH #207 hard-delete + dependency-resolution
mechanism. The unified DELETE route (Task 9) reads :func:`collect_dependencies`
and the :class:`BlockingDepsError`/:class:`InvalidResolutionError` exceptions;
the ``resolve_delete`` executor (Task 10) consumes :data:`FK_MATRIX`,
:func:`has_blocking_deps`, :func:`validate_resolutions` and the exceptions.
The #285 deferred-delete commit additionally reads
:func:`collect_dependency_ids` + :func:`stale_expected_entities` — the
``expected`` id-set verification of the record DELETE body (spec rev5/rev6).

Spec: ``docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md``
  * §4  — FK matrix (the full per-entity table).
  * §5  — 409 Conflict response shape (counters + ``cascade_preview``;
    #285 D9б/в additionally carries per-row ``items`` on record-dep nodes).
  * §6  — resolutions body rules.
  * §11 — context facts (Activity has no ``is_active``; Material has zero FK deps).
  * §16 — auto-deps ignored when sent in the resolutions body.

The matrix is hand-verified against the FK shapes in ``src/models/``:

  * ``Activity`` — NOT-NULL ``master_id``/``location_id``/``service_id``, no
    ``is_active`` → always blocks delete on Staff/Location/Service.
  * ``Staff`` (GH #266) — activities block via the ``masters`` extension
    (``activities.master_id → masters.staff_id = staff.id``); ``users``
    (``staff_id``), the ``masters`` extension row itself, ``master_tags``
    and ``staff_positions`` joins auto-cascade (§4.1, Change 2 + #266).
  * ``Tariff.service_id`` — NOT NULL → Service cascade (auto).
  * ``Photo.service_id``/``client_id``/``location_id`` — nullable →
    Service/Client/Location nullify (auto) — GH #211 4-owner model; a photo
    survives losing its owner (row kept, FK set NULL).
  * ``Record.client_id`` — nullable → Client nullify (user choice).
  * ``Activity`` (GH #286 D1) — direct FK children only: records
    (CASCADE, user choice), photos (SET NULL, auto), activity_tags
    (join, auto). PREVIEW-ONLY entry — consumed by
    :func:`collect_dependencies` (dialog tree, two levels deep via
    ``_RECURSIVE_CHILDREN``); execution of DELETE /activities/{id}
    stays with the handwritten ``ActivityService.delete`` — NO
    handlers are wired for Activity in the dispatch tables below.
  * ``Visitor.client_id`` — NOT NULL → Client cascade (user choice).
  * join tables ``master_tags``/``location_tags``/``service_tags``/
    ``client_tags``/``service_materials`` — NOT-NULL PK → cascade (auto).
  * ``Material`` — ``service_materials`` join (GH #223 §7) → cascade (auto);
    unlinked material still deletes 204 as before.
"""

from __future__ import annotations

# ruff: noqa: RUF001, RUF002, RUF003  -- Cyrillic is intentional here (Russian UI
# labels per spec §5 + D9б/в one-line labels in docstrings/comments)
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.photo import Photo
from src.models.position import staff_positions
from src.models.record import Record
from src.models.service import Service
from src.models.service_material import ServiceMaterial
from src.models.staff import Staff
from src.models.tag import (
    Tag,
    activity_tags,
    client_tags,
    location_tags,
    master_tags,
    record_tags,
    service_tags,
)
from src.models.tariff import Tariff
from src.models.user import User
from src.models.user_profile import UserProfile
from src.models.visit import Visit
from src.models.visitor import Visitor

if TYPE_CHECKING:
    from src.db.base import Base
    from src.services.generic import ArchiveService


# ─── Exception hierarchy ────────────────────────────────────────────────────────
# Defined here (domain layer) so Task 9/10 import them; Task 9 catches
# ``ResolutionError`` (the base — catches both subtypes) and maps to HTTP 422.


class ResolutionError(Exception):
    """Base for dependency-resolution errors (mapped to HTTP 422 in the API)."""


class BlockingDepsError(ResolutionError):
    """Entity has blocking dependencies (activities present) → 422 'archive instead'."""


class InvalidResolutionError(ResolutionError):
    """Resolutions body is missing or has wrong actions → 422 with details."""


# ─── FK dependency descriptor ───────────────────────────────────────────────────


@dataclass(frozen=True)
class FKDependency:
    """One FK relation descriptor for the §4 matrix.

    ``entity`` is the FK-relation name (``"users"``, ``"activities"``, …).
    ``relation`` is the Russian UI label per spec §5 (``"Пользователь"`` …).
    ``nullable`` mirrors the FK column's allow-null (drives nullify viability).
    ``action`` is the default action when this dep is present.
    ``auto`` = no user choice — resolved automatically by the server.
    ``allowed_actions`` — the list of actions the user MAY pick; ``[]`` = block.
    ``message`` — per-dep message override (set on the activities block dep).
    """

    entity: str
    relation: str
    nullable: bool
    action: Literal["block", "nullify", "cascade"]
    auto: bool
    allowed_actions: list[str]
    message: str | None = None


# ─── §4 FK matrix — the full per-entity table ───────────────────────────────────
# Hand-verified against the FK shapes in ``src/models/`` (see module docstring).
# Keys are entity MODEL classes; Task 10's ``resolve_delete`` dispatches on these.

_BLOCK_MESSAGE = "Удалите активности вручную или архивируйте"

FK_MATRIX: dict[type[Base], list[FKDependency]] = {
    Staff: [
        # GH #266 deletion matrix (docs/domain-rules/staff.md): the card's
        # hard-delete blocks on activities (joined via the masters extension
        # row — activities.master_id → masters.staff_id = staff.id) and
        # auto-cascades users / the masters extension row itself /
        # master_tags + staff_positions joins. The masters row ALSO carries
        # an FK-level ON DELETE CASCADE, but the service-level handler keeps
        # the executor deterministic regardless of PRAGMA state.
        FKDependency(
            entity="activities", relation="Активность", nullable=False,
            action="block", auto=False, allowed_actions=[], message=_BLOCK_MESSAGE,
        ),
        FKDependency(
            entity="users", relation="Пользователь", nullable=True,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="masters", relation="Мастер", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="master_tags", relation="Тег", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="staff_positions", relation="Должность", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
    ],
    Location: [
        FKDependency(
            entity="activities", relation="Активность", nullable=False,
            action="block", auto=False, allowed_actions=[], message=_BLOCK_MESSAGE,
        ),
        FKDependency(
            entity="location_tags", relation="Тег", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="photos", relation="Фото", nullable=True,
            action="nullify", auto=True, allowed_actions=["nullify"],
        ),
    ],
    Service: [
        FKDependency(
            entity="activities", relation="Активность", nullable=False,
            action="block", auto=False, allowed_actions=[], message=_BLOCK_MESSAGE,
        ),
        FKDependency(
            entity="tariffs", relation="Тариф", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="photos", relation="Фото", nullable=True,
            action="nullify", auto=True, allowed_actions=["nullify"],
        ),
        FKDependency(
            entity="service_tags", relation="Тег", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="service_materials", relation="Материал", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
    ],
    Client: [
        FKDependency(
            entity="records", relation="Запись", nullable=True,
            action="nullify", auto=False, allowed_actions=["nullify"],
        ),
        FKDependency(
            entity="visitors", relation="Посетитель", nullable=False,
            action="cascade", auto=False, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="client_tags", relation="Тег", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="photos", relation="Фото", nullable=True,
            action="nullify", auto=True, allowed_actions=["nullify"],
        ),
    ],
    Record: [
        FKDependency(
            entity="visits", relation="Посещение", nullable=False,
            action="cascade", auto=False, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="payments", relation="Платёж", nullable=False,
            action="cascade", auto=False, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="record_tags", relation="Тег", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
    ],
    Activity: [
        # GH #286 D1: direct FK children (records CASCADE; photos SET NULL
        # #194; activity_tags join rows). PREVIEW-ONLY — collect/labels
        # only; the generic resolver never executes an activity delete
        # (no handlers in NULLIFY_HANDLERS/CASCADE_HANDLERS).
        FKDependency(
            entity="records", relation="Запись", nullable=False,
            action="cascade", auto=False, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="photos", relation="Фото", nullable=True,
            action="nullify", auto=True, allowed_actions=["nullify"],
        ),
        FKDependency(
            entity="activity_tags", relation="Тег", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
    ],
    Material: [
        FKDependency(
            entity="service_materials", relation="Услуга", nullable=False,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
    ],
}


# ─── 409 response shape (§5) ────────────────────────────────────────────────────


class DependencyItem(BaseModel):
    """One one-line "what exactly will be deleted" entry (#285 D9б/в).

    ``id`` identifies the dependent row (UUID str; join-table rows are
    identified by the same id the id-collectors use — record_tags →
    ``tag_id`` within the parent record's scope, mirroring
    :func:`collect_dependency_ids`). ``label`` is the backend-built
    human-readable line the DeleteDialog renders.
    """

    id: str
    label: str


class DependencyNode(BaseModel):
    """One entry in the 409 ``dependencies`` array.

    Original spec §5 shape: ``{"entity", "count", "allowed_actions",
    "message", "cascade_preview"}`` plus the human ``relation`` label —
    built manually by :func:`collect_dependencies` (no ORM
    ``from_attributes`` mapping needed). Historically counters + sums
    only, never individual row data.

    #285 D9б/в: for RECORD deps (``visits`` / ``payments`` /
    ``record_tags``) the node additionally carries ``items`` — one
    ``{id, label}`` entry per dependent row, so the tree does expose
    individual rows there. Other entities keep
    ``items=None`` (§5 boundary — their dialogs are unchanged) and stay
    counters + sums only.

    rev8: ``auto`` mirrors :attr:`FKDependency.auto` (copied from the
    matrix in :func:`collect_dependencies` — no entity-name hardcode) so
    the client filters server-resolved deps (record_tags) by field
    instead of hardcoding entity names. Serialized ALWAYS — ``bool``
    is never None, ``False`` survives ``model_dump(exclude_none=True)``.
    """

    model_config = ConfigDict(extra="forbid")

    entity: str
    relation: str
    count: int
    allowed_actions: list[str]
    auto: bool = False
    message: str | None = None
    cascade_preview: dict[str, int] | None = None
    items: list[DependencyItem] | None = None


# ─── resolutions/422 path (§6, §16) ─────────────────────────────────────────────


class ResolutionIssue(BaseModel):
    """One issue from :func:`validate_resolutions` (returns ``[]`` when valid)."""

    model_config = ConfigDict(extra="forbid")

    relation: str
    message: str


# ─── Per-relation counters ──────────────────────────────────────────────────────
# Each counter returns ``(count, cascade_preview)`` — the preview is non-None
# only for Client → visitors (the spec's only user-choice cascade). Zero-count
# deps are filtered out by :func:`collect_dependencies`, so counters may assume
# any non-zero count they produce is included as a tree node.

_CountResult = tuple[int, dict[str, int] | None]
_CounterFn = Callable[[AsyncSession, str], Awaitable[_CountResult]]


async def _count_m_activities(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Activity).where(Activity.master_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_m_users(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(User).where(User.staff_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_m_master_tags(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(master_tags)
        .where(master_tags.c.master_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_m_masters(s: AsyncSession, entity_id: str) -> _CountResult:
    """GH #266: the 1:0..1 extension row — 1 when the card is a master."""
    r = await s.execute(
        select(func.count()).select_from(Master)
        .where(Master.staff_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_m_staff_positions(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(staff_positions)
        .where(staff_positions.c.staff_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_l_activities(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Activity).where(Activity.location_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_l_location_tags(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(location_tags)
        .where(location_tags.c.location_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_l_photos(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Photo).where(Photo.location_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_s_activities(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Activity).where(Activity.service_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_s_tariffs(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Tariff).where(Tariff.service_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_s_photos(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Photo).where(Photo.service_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_s_service_tags(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(service_tags)
        .where(service_tags.c.service_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_s_service_materials(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(ServiceMaterial)
        .where(ServiceMaterial.service_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_mat_service_materials(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(ServiceMaterial)
        .where(ServiceMaterial.material_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_c_records(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Record).where(Record.client_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_c_visitors(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Visitor).where(Visitor.client_id == entity_id)
    )
    n_visitors = r.scalar_one()
    if not n_visitors:
        return 0, None
    # Spec §5: cascade_preview counts downstream visits that would be physically
    # deleted when visitors cascade. Payments are EXCLUDED — they are record-scoped
    # and survive the (nullify) on records, so they are NOT part of the cascade.
    visits_r = await s.execute(
        select(func.count(Visit.id))
        .join(Visitor, Visit.visitor_id == Visitor.id)
        .where(Visitor.client_id == entity_id)
    )
    n_visits = visits_r.scalar_one()
    return n_visitors, {"visits": n_visits}


async def _count_c_client_tags(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(client_tags)
        .where(client_tags.c.client_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_c_photos(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Photo).where(Photo.client_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_r_visits(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Visit).where(Visit.record_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_r_payments(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Payment).where(Payment.record_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_r_record_tags(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(record_tags)
        .where(record_tags.c.record_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_a_records(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Record).where(Record.activity_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_a_photos(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(Photo).where(Photo.activity_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_a_activity_tags(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(activity_tags)
        .where(activity_tags.c.activity_id == entity_id)
    )
    return r.scalar_one(), None


_COUNTERS: dict[tuple[type[Base], str], _CounterFn] = {
    (Staff, "activities"): _count_m_activities,
    (Staff, "users"): _count_m_users,
    (Staff, "masters"): _count_m_masters,
    (Staff, "master_tags"): _count_m_master_tags,
    (Staff, "staff_positions"): _count_m_staff_positions,
    (Location, "activities"): _count_l_activities,
    (Location, "location_tags"): _count_l_location_tags,
    (Location, "photos"): _count_l_photos,
    (Service, "activities"): _count_s_activities,
    (Service, "tariffs"): _count_s_tariffs,
    (Service, "photos"): _count_s_photos,
    (Service, "service_tags"): _count_s_service_tags,
    (Service, "service_materials"): _count_s_service_materials,
    (Material, "service_materials"): _count_mat_service_materials,
    (Client, "records"): _count_c_records,
    (Client, "visitors"): _count_c_visitors,
    (Client, "client_tags"): _count_c_client_tags,
    (Client, "photos"): _count_c_photos,
    (Record, "visits"): _count_r_visits,
    (Record, "payments"): _count_r_payments,
    (Record, "record_tags"): _count_r_record_tags,
    (Activity, "records"): _count_a_records,
    (Activity, "photos"): _count_a_photos,
    (Activity, "activity_tags"): _count_a_activity_tags,
}


# ─── #285 D9б/в: per-row label builders → 409 ``items`` ────────────────────────
# Mirror of ``_COUNTERS``/``_ID_COLLECTORS`` dispatch: each collector selects the
# dependent rows WITH their human label. Wired ONLY for Record deps
# (``visits``/``payments``/``record_tags``) — other entities keep the bare tree
# (items=None; §5 boundary). Item ids match ``_ID_COLLECTORS`` exactly (the
# ``expected`` commit is built from these same ids: visit.id / payment.id /
# record_tags.tag_id).

type _ItemsFn = Callable[[AsyncSession, str], Awaitable[list[DependencyItem]]]

_NO_TARIFF_LABEL = "Без тарифа"  # tariff_id IS NULL (или service title недоступен)
_NO_METHOD_LABEL = "—"  # method IS NULL (D9б)
_ANONYMOUS_LABEL = "Аноним"  # client_id IS NULL / имя клиента пусто (#286 D1)


async def _items_r_visits(s: AsyncSession, entity_id: str) -> list[DependencyItem]:
    """Visit label «{service.title}, {price}» — service via ``tariff_id``.

    ``tariff_id IS NULL`` → «Без тарифа, {price}»; a tariff whose service
    row is missing (не возникает по FK-матрице — tariffs.service_id NOT
    NULL, но fallback безопасен) → title becomes «Без тарифа» as well.
    """
    r = await s.execute(
        select(
            Visit.id.label("visit_id"),
            Visit.price.label("price"),
            Tariff.id.label("tariff_id"),
            Service.title.label("service_title"),
        )
        .outerjoin(Tariff, Visit.tariff_id == Tariff.id)
        .outerjoin(Service, Tariff.service_id == Service.id)
        .where(Visit.record_id == entity_id)
    )
    items: list[DependencyItem] = []
    for row in r.all():
        title = (
            row.service_title
            if row.tariff_id is not None and row.service_title is not None
            else _NO_TARIFF_LABEL
        )
        items.append(DependencyItem(id=row.visit_id, label=f"{title}, {row.price}"))
    return items


async def _items_r_payments(s: AsyncSession, entity_id: str) -> list[DependencyItem]:
    """Payment label «{amount}, {method}»; ``method IS NULL`` → «{amount}, —»."""
    r = await s.execute(
        select(Payment.id, Payment.amount, Payment.method)
        .where(Payment.record_id == entity_id)
    )
    return [
        DependencyItem(
            id=row.id,
            label=f"{row.amount}, {row.method if row.method is not None else _NO_METHOD_LABEL}",
        )
        for row in r.all()
    ]


async def _items_r_record_tags(s: AsyncSession, entity_id: str) -> list[DependencyItem]:
    """record_tags label «{tag title}» per link row — id = ``tag_id``."""
    r = await s.execute(
        select(record_tags.c.tag_id, Tag.title)
        .join(Tag, record_tags.c.tag_id == Tag.id)
        .where(record_tags.c.record_id == entity_id)
    )
    return [
        DependencyItem(id=row.tag_id, label=row.title) for row in r.all()
    ]


async def _items_a_records(s: AsyncSession, entity_id: str) -> list[DependencyItem]:
    """Record label «{service.title}, {start date}, {client | Аноним}» (#286 D1).

    One query: Record → Activity → Service (the activity's service) +
    LEFT JOIN Client (``client_id`` nullable → «Аноним»; a NULL/empty
    client name degrades the same way). Date = ``Activity.start`` date
    part, ISO ``YYYY-MM-DD`` (locale-free). PII boundary per #285 D9б:
    the client name is visible to admin callers (not masked).
    """
    r = await s.execute(
        select(
            Record.id.label("record_id"),
            Service.title.label("service_title"),
            Activity.start.label("start"),
            Client.name.label("client_name"),
        )
        .join(Activity, Record.activity_id == Activity.id)
        .join(Service, Activity.service_id == Service.id)
        .outerjoin(Client, Record.client_id == Client.id)
        .where(Record.activity_id == entity_id)
    )
    return [
        DependencyItem(
            id=row.record_id,
            label=(
                f"{row.service_title}, {row.start.date().isoformat()}, "
                f"{row.client_name if row.client_name else _ANONYMOUS_LABEL}"
            ),
        )
        for row in r.all()
    ]


_ITEM_COLLECTORS: dict[tuple[type[Base], str], _ItemsFn] = {
    (Record, "visits"): _items_r_visits,
    (Record, "payments"): _items_r_payments,
    (Record, "record_tags"): _items_r_record_tags,
    (Activity, "records"): _items_a_records,
}


# ─── #286 D1: recursive two-level Activity subtree ─────────────────────────────
# FK_MATRIX[Activity] lists only DIRECT FK children (records/photos/
# activity_tags). The deferred-delete dialog needs the full subtree: for
# each direct record its own non-auto deps (visits/payments; record_tags
# is auto and excluded). The recursion reuses the Record-level counters +
# label-builders (#285) AS IS, per record id. Visit/Payment have no
# non-auto deps of their own, so the recursion stops at depth 2.

type _ChildrenFn = Callable[[AsyncSession, str], Awaitable[list[DependencyNode]]]


async def _activity_children_nodes(
    session: AsyncSession, activity_id: str,
) -> list[DependencyNode]:
    """Second-level nodes for an activity: aggregated visits + payments.

    For every NON-AUTO dep of ``FK_MATRIX[Record]`` (visits, payments),
    sums the per-record counts and concatenates the per-record items
    (``_COUNTERS``/``_ITEM_COLLECTORS`` — the #285 builders run
    unchanged per record). Zero-total deps are skipped (§5). Nodes are
    appended after the matrix nodes, so the client-side auto-filter
    keeps the dialog order records → visits → payments.
    """
    r = await session.execute(
        select(Record.id).where(Record.activity_id == activity_id)
    )
    record_ids = list(r.scalars().all())
    if not record_ids:
        return []

    nodes: list[DependencyNode] = []
    for dep in FK_MATRIX.get(Record, []):
        if dep.auto:
            continue  # record_tags — auto, excluded from the subtree (#286 D1).
        counter = _COUNTERS[(Record, dep.entity)]
        item_collector = _ITEM_COLLECTORS.get((Record, dep.entity))
        total = 0
        items: list[DependencyItem] = []
        for record_id in record_ids:
            count, _preview = await counter(session, record_id)
            total += count
            if item_collector is not None and count:
                items.extend(await item_collector(session, record_id))
        if not total:
            continue
        nodes.append(
            DependencyNode(
                entity=dep.entity,
                relation=dep.relation,
                count=total,
                allowed_actions=list(dep.allowed_actions),
                auto=dep.auto,
                items=items or None,
            )
        )
    return nodes


_RECURSIVE_CHILDREN: dict[type[Base], _ChildrenFn] = {
    Activity: _activity_children_nodes,
}


# ─── 409 builder ────────────────────────────────────────────────────────────────


async def collect_dependencies(
    session: AsyncSession, model: type, entity_id: str,
) -> list[DependencyNode]:
    """Run COUNT queries for each FK relation in ``FK_MATRIX[model]``.

    Returns the 409 ``dependencies`` array. Zero-count deps are skipped (§5).
    Each node carries: ``entity``, ``relation``, ``count``, ``allowed_actions``,
    ``message``; Client → visitors additionally carries
    ``cascade_preview`` = ``{"visits": N}`` (NO payments per §5); Record
    deps (#285 D9б/в) additionally carry ``items`` = one ``{id, label}``
    per dependent row (other entities → ``items=None``, §5 boundary).
    Every node also carries ``auto`` = the matrix's ``FKDependency.auto``
    (rev8: server-resolved deps like record_tags are flagged so the
    client can filter them without hardcoding entity names).

    #286 D1: entities whose dialog tree spans MORE than one matrix level
    (``_RECURSIVE_CHILDREN`` — Activity → records → visits/payments)
    append their second-level nodes after the matrix nodes; the matrix
    itself stays the direct-FK mirror.

    Used by Task 9's unified DELETE route — the no-body 409 builder AND
    both #285 409 paths (``has_dependencies`` dry-run + ``stale_dependencies``
    commit), so items appear in every serialized tree.
    """
    deps = FK_MATRIX.get(model, [])
    if not deps:
        return []

    nodes: list[DependencyNode] = []
    for dep in deps:
        counter = _COUNTERS.get((model, dep.entity))
        if counter is None:  # defensive — full matrix wires every dep.
            continue
        count, preview = await counter(session, entity_id)
        if not count:
            continue  # §5: skip zero-count deps.
        # #285 D9б/в: Record deps carry per-row one-line labels; other
        # entities have no collector → items stays None (§5 boundary).
        item_collector = _ITEM_COLLECTORS.get((model, dep.entity))
        items = await item_collector(session, entity_id) if item_collector else None
        nodes.append(
            DependencyNode(
                entity=dep.entity,
                relation=dep.relation,
                count=count,
                allowed_actions=list(dep.allowed_actions),
                auto=dep.auto,
                message=dep.message,
                cascade_preview=preview,
                items=items,
            )
        )
    # #286 D1: second-level nodes (Activity → records → visits/payments)
    # appended after the matrix nodes — the client-side auto-filter keeps
    # the dialog order records → visits → payments.
    recursion = _RECURSIVE_CHILDREN.get(model)
    if recursion is not None:
        nodes.extend(await recursion(session, entity_id))
    return nodes


def has_blocking_deps(nodes: list[DependencyNode]) -> bool:
    """``True`` if any node has ``allowed_actions == []`` (the activities case).

    Such an entity cannot be deleted by either DELETE mode — only archived.
    """
    return any(not n.allowed_actions for n in nodes)


# ─── #285: id-collectors for the expected-state check (rev5/rev6) ──────────────
# Mirror of ``_COUNTERS``: same (model, entity) dispatch, but each collector
# returns the dependent rows' IDs instead of a count — the input for the
# deferred-delete commit's ``expected`` id-set verification.
# Join tables have no single-column PK: a record_tags link row is identified
# by its ``tag_id`` within the parent record's scope.

type _IdsFn = Callable[[AsyncSession, str], Awaitable[list[str]]]


async def _ids_r_visits(s: AsyncSession, entity_id: str) -> list[str]:
    r = await s.execute(select(Visit.id).where(Visit.record_id == entity_id))
    return list(r.scalars().all())


async def _ids_r_payments(s: AsyncSession, entity_id: str) -> list[str]:
    r = await s.execute(select(Payment.id).where(Payment.record_id == entity_id))
    return list(r.scalars().all())


async def _ids_r_record_tags(s: AsyncSession, entity_id: str) -> list[str]:
    r = await s.execute(
        select(record_tags.c.tag_id).where(record_tags.c.record_id == entity_id)
    )
    return list(r.scalars().all())


# ─── #286 D2: Activity direct id-collectors ─────────────────────────────────────
# Mirror of the Record collectors: records (direct FK child), photos (auto)
# and activity_tags (auto join rows) — the direct level of the subtree.


async def _ids_a_records(s: AsyncSession, entity_id: str) -> list[str]:
    r = await s.execute(select(Record.id).where(Record.activity_id == entity_id))
    return list(r.scalars().all())


async def _ids_a_photos(s: AsyncSession, entity_id: str) -> list[str]:
    r = await s.execute(select(Photo.id).where(Photo.activity_id == entity_id))
    return list(r.scalars().all())


async def _ids_a_activity_tags(s: AsyncSession, entity_id: str) -> list[str]:
    r = await s.execute(
        select(activity_tags.c.tag_id).where(
            activity_tags.c.activity_id == entity_id
        )
    )
    return list(r.scalars().all())


_ID_COLLECTORS: dict[tuple[type[Base], str], _IdsFn] = {
    (Record, "visits"): _ids_r_visits,
    (Record, "payments"): _ids_r_payments,
    (Record, "record_tags"): _ids_r_record_tags,
    (Activity, "records"): _ids_a_records,
    (Activity, "photos"): _ids_a_photos,
    (Activity, "activity_tags"): _ids_a_activity_tags,
}


# ─── #286 D2: second-level id-collection (Activity → records → visits/payments) ─
# The Activity dialog tree spans TWO matrix levels; the ``expected`` commit
# carries id-sets for BOTH levels. visits/payments are not direct FK deps of
# Activity (absent from FK_MATRIX[Activity]), so they are collected by a
# dedicated subtree extender instead of the direct ``_ID_COLLECTORS`` loop —
# mirror of ``_RECURSIVE_CHILDREN`` in the preview path.


async def _activity_dependency_ids(
    session: AsyncSession, activity_id: str,
) -> dict[str, list[str]]:
    """Second-level id-sets: visits and payments of EVERY record of the
    activity (one JOIN query each — no per-record N+1). Only non-empty
    lists are included, mirroring :func:`collect_dependency_ids`."""
    out: dict[str, list[str]] = {}
    visit_r = await session.execute(
        select(Visit.id)
        .join(Record, Visit.record_id == Record.id)
        .where(Record.activity_id == activity_id)
    )
    visits = list(visit_r.scalars().all())
    if visits:
        out["visits"] = visits
    payment_r = await session.execute(
        select(Payment.id)
        .join(Record, Payment.record_id == Record.id)
        .where(Record.activity_id == activity_id)
    )
    payments = list(payment_r.scalars().all())
    if payments:
        out["payments"] = payments
    return out


_RECURSIVE_IDS: dict[type[Base], Callable[[AsyncSession, str], Awaitable[dict[str, list[str]]]]] = {
    Activity: _activity_dependency_ids,
}


async def collect_dependency_ids(
    session: AsyncSession, model: type, entity_id: str,
) -> dict[str, list[str]]:
    """Collect the id-lists of dependent rows per FK entity (#285 rev6).

    Returns ``{entity: [dependent row ids]}`` for every relation wired in
    :data:`_ID_COLLECTORS` (only non-empty lists are included). This is the
    CURRENT state side of the deferred-delete ``expected`` verification:
    the route compares these sets against the id-sets the caller confirmed
    at dry-run time (subset semantics — spec §3 D9a).

    Auto-deps (e.g. ``record_tags``) ARE collected here (the task's payload
    is per-entity and complete); whether they participate in the check is
    decided by :func:`stale_expected_entities`.

    #286 D2: entities with a two-level dialog tree
    (``_RECURSIVE_IDS`` — Activity → records → visits/payments) extend
    their per-entity map with the second-level id-sets after the direct
    loop.
    """
    deps = FK_MATRIX.get(model, [])
    if not deps:
        return {}
    out: dict[str, list[str]] = {}
    for dep in deps:
        collector = _ID_COLLECTORS.get((model, dep.entity))
        if collector is None:  # defensive — mirrors _COUNTERS wiring.
            continue
        ids = await collector(session, entity_id)
        if ids:
            out[dep.entity] = ids
    # #286 D2: second-level subtree ids appended after the direct level —
    # the per-entity payload stays complete across both matrix levels.
    recursion = _RECURSIVE_IDS.get(model)
    if recursion is not None:
        for entity, ids in (await recursion(session, entity_id)).items():
            out.setdefault(entity, []).extend(ids)
    return out


# ─── #286 D2: entities verified at the SECOND matrix level ─────────────────────
# Activity's dialog tree spans two matrix levels (direct records + each
# record's visits/payments). visits/payments are NOT direct FK deps of
# Activity (absent from FK_MATRIX[Activity]) yet ARE part of the
# user-confirmed subtree — verified like non-auto deps by
# :func:`stale_expected_entities`. Derived from FK_MATRIX[Record]'s
# non-auto deps so a future Record-level dep stays consistent.
_RECURSIVE_VERIFY: dict[type[Base], frozenset[str]] = {
    Activity: frozenset(
        dep.entity for dep in FK_MATRIX[Record] if not dep.auto
    ),
}


def stale_expected_entities(
    model: type,
    now_ids: dict[str, list[str]],
    expected: dict[str, list[str]],
) -> list[str]:
    """Entity keys whose CURRENT id-set is NOT a subset of ``expected`` (#285).

    Subset, not equality (spec §3 D9a): a dependency that disappeared during
    the undo window does NOT block (deleting less than was confirmed); a
    dependency that APPEARED does block. A missing ``expected`` key means
    «nothing was confirmed» for that entity — any current row is stale.

    Auto-deps (``FKDependency.auto``, e.g. record_tags) NEVER participate:
    they resolve themselves during execution, so the user could not have
    confirmed them and a mid-window tag link is not a race.

    #286 D2: for two-level trees (``_RECURSIVE_VERIFY`` — Activity), the
    second-level entities (visits/payments) verify the same way even though
    they are not direct FK deps — a visit that appeared inside an
    already-confirmed record is a mid-window race the user never confirmed.
    """
    matrix = {dep.entity: dep for dep in FK_MATRIX.get(model, [])}
    recursive_verify = _RECURSIVE_VERIFY.get(model, frozenset())
    stale: list[str] = []
    for entity, ids in now_ids.items():
        dep = matrix.get(entity)
        if dep is None:
            if entity not in recursive_verify:
                continue  # unknown entities are never verified.
            # Second-level subtree entity — verified like a user choice.
        elif dep.auto:
            continue
        if not set(ids) <= set(expected.get(entity, [])):
            stale.append(entity)
    return stale


def validate_resolutions(
    model: type,
    nodes: list[DependencyNode],
    resolutions_body: dict[str, str],
) -> list[ResolutionIssue]:
    """Validate the user's ``resolutions`` body against the FK matrix (§6, §16).

    For each NON-AUTO dep with count > 0 (present in ``nodes``):
      * the action MUST be present in ``allowed_actions``.

    Blocked deps (``allowed_actions == []``, e.g. activities) → INVALID regardless
    of the body (raising them maps to 422 'archive instead').

    Auto deps (Master→users, *_tags, tariffs, photos) → IGNORED — any user-sent
    action for an auto dep is silently accepted (§16); never an error.

    Returns ``[]`` when valid.
    """
    deps_by_entity = {dep.entity: dep for dep in FK_MATRIX.get(model, [])}
    errors: list[ResolutionIssue] = []

    for node in nodes:
        dep = deps_by_entity.get(node.entity)
        if dep is None:
            continue  # unknown entity in tree — defensive, should not happen.

        if not dep.allowed_actions:
            # Blocked → invalid no matter what the body says (§6 rule 4).
            errors.append(
                ResolutionIssue(
                    relation=node.relation,
                    message=(
                        f"Есть блокирующая зависимость ({node.relation}); "
                        f"удалите вручную или архивируйте"
                    ),
                )
            )
            continue

        if dep.auto:
            # §16: auto deps are resolved automatically; user-sent values ignored.
            continue

        user_action = resolutions_body.get(node.entity)
        if user_action is None:
            errors.append(
                ResolutionIssue(
                    relation=node.relation,
                    message=(
                        f"Не указано действие для «{node.relation}» "
                        f"(allowed: {dep.allowed_actions})"
                    ),
                )
            )
        elif user_action not in dep.allowed_actions:
            errors.append(
                ResolutionIssue(
                    relation=node.relation,
                    message=(
                        f"Недопустимое действие «{user_action}» для "
                        f"«{node.relation}»; allowed: {dep.allowed_actions}"
                    ),
                )
            )

    return errors


# ─── Per-(Model, FK-entity) dep handlers — Task 10 executor dispatch ───────────
# Called by ``ArchiveService.resolve_delete`` (spec §6 execution order
# nullify → cascade → hard delete). Each handler is a free async function
# taking ``(self, session, entity_id)`` so that ``_h_cascade_client_visitors``
# can access ``self._visitor_service`` (injected only on ``ClientService``);
# all other handlers ignore the ``self`` arg.

type _FkHandlerFn = Callable[
    ["ArchiveService", AsyncSession, str], Awaitable[None]
]


# ─── nullify handlers ───────────────────────────────────────────────────────────


async def _h_nullify_service_photos(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Service → photos auto-nullify: ``Photo.service_id`` set NULL (survives)."""
    await session.execute(
        update(Photo).where(Photo.service_id == entity_id).values(service_id=None)
    )


async def _h_nullify_client_records(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Client → records user-choice nullify: ``Record.client_id`` set NULL
    (records become anonymous — survive with their payments record-scoped)."""
    await session.execute(
        update(Record).where(Record.client_id == entity_id).values(client_id=None)
    )


async def _h_nullify_client_photos(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Client → photos auto-nullify (GH #211): ``Photo.client_id`` set NULL.
    The photo row survives — losing its owner never deletes a photo."""
    await session.execute(
        update(Photo).where(Photo.client_id == entity_id).values(client_id=None)
    )


async def _h_nullify_location_photos(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Location → photos auto-nullify (GH #211): ``Photo.location_id`` set NULL.
    The photo row survives — losing its owner never deletes a photo."""
    await session.execute(
        update(Photo).where(Photo.location_id == entity_id).values(location_id=None)
    )


# ─── cascade handlers ───────────────────────────────────────────────────────────


async def _h_cascade_master_users(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Staff → users auto-cascade (§4.1, Change 2): hard-delete the linked
    ``User`` row. The User is the staff member's login account; deleting the
    card but keeping the account = orphan, so the account goes with it (no
    user choice).

    GH #262: the linked users' ``user_profiles`` rows (private half of
    «Мои данные») die with their accounts — deleted FIRST, in the same
    executor flush (the FK also carries ON DELETE CASCADE, but the
    service-level delete keeps the executor deterministic regardless of
    PRAGMA state — same belt-and-suspenders as the masters extension).

    NB: ``user_settings.user_id`` (NOT NULL, no ``ondelete``) FK-references
    ``users.id`` — if a settings row exists for the linked user, this DELETE will
    FK-violate. Spec §4.1 scopes this to a User with NO downstream rows; the
    #207 test scenarios use the bare ``_user`` fixture which inserts no settings.
    A future spec revision would have to extend this handler (e.g., delete
    user_settings first) — out of scope for #207.
    """
    await session.execute(
        delete(UserProfile).where(
            UserProfile.user_id.in_(
                select(User.id).where(User.staff_id == entity_id)
            )
        )
    )
    await session.execute(delete(User).where(User.staff_id == entity_id))


async def _h_cascade_master_extension(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Staff → masters auto-cascade (GH #266): hard-delete the 1:0..1
    schedule-extension row. The FK also carries ON DELETE CASCADE, but the
    service-level delete keeps the executor deterministic regardless of
    the SQLite PRAGMA foreign_keys state."""
    await session.execute(delete(Master).where(Master.staff_id == entity_id))


async def _h_cascade_staff_positions(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Staff → staff_positions auto-cascade (GH #266): hard-delete the M2M
    join rows. Position dictionary entries themselves survive."""
    await session.execute(
        delete(staff_positions).where(staff_positions.c.staff_id == entity_id)
    )


async def _h_cascade_master_tags(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Master → master_tags auto-cascade (join): hard-delete rows where master_id."""
    await session.execute(
        delete(master_tags).where(master_tags.c.master_id == entity_id)
    )


async def _h_cascade_location_tags(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Location → location_tags auto-cascade (join): hard-delete rows where location_id."""
    await session.execute(
        delete(location_tags).where(location_tags.c.location_id == entity_id)
    )


async def _h_cascade_service_tariffs(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Service → tariffs auto-cascade: hard-delete rows where service_id."""
    await session.execute(delete(Tariff).where(Tariff.service_id == entity_id))


async def _h_cascade_service_tags(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Service → service_tags auto-cascade (join): hard-delete rows where service_id."""
    await session.execute(
        delete(service_tags).where(service_tags.c.service_id == entity_id)
    )


async def _h_cascade_service_materials(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Service → service_materials auto-cascade (join, GH #223 §7): hard-delete
    link rows where service_id. Materials themselves are untouched — only the
    links die with the service."""
    await session.execute(
        delete(ServiceMaterial).where(ServiceMaterial.service_id == entity_id)
    )


async def _h_cascade_material_service_materials(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Material → service_materials auto-cascade (join, GH #223 §7): hard-delete
    link rows where material_id. Services themselves are untouched — deleting a
    material only detaches it from the services that referenced it."""
    await session.execute(
        delete(ServiceMaterial).where(ServiceMaterial.material_id == entity_id)
    )


async def _h_cascade_client_tags(
    _self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Client → client_tags auto-cascade (join): hard-delete rows where client_id."""
    await session.execute(
        delete(client_tags).where(client_tags.c.client_id == entity_id)
    )


async def _h_cascade_client_visitors(
    self: ArchiveService, session: AsyncSession, entity_id: str,
) -> None:
    """Client → visitors USER-CHOICE cascade — loop ``VisitorService._delete_cascade``
    on the SHARED session (atomicity with the outer ``ClientService.resolve_delete``
    transaction — spec §8 BLOCKER-class: NO per-visitor commit).

    Each iteration triggers (per ``VisitorService._delete_cascade`` §8 reference):
      1. ``DELETE FROM visits WHERE visitor_id=<vid>``
      2. ``DELETE FROM visitor_tags WHERE visitor_id=<vid>``
      3. ``DELETE FROM visitors WHERE id=<vid>``

    Photos are NOT touched — since GH #211 a photo is never visitor-owned
    (4-owner model: client|service|activity|location).

    Payments are record-scoped and EXCLUDED — records are nullified (not deleted)
    so their payments do not flow through this cascade (§5).

    ``self`` is the ``ClientService`` instance — only it carries
    ``self._visitor_service`` (injected via DI in ``get_client_service``).
    Base ``ArchiveService`` is never dispatched here for visitors because
    ``(Client, "visitors")`` appears only in ``FK_MATRIX[Client]``.
    """
    visitor_ids_result = await session.execute(
        select(Visitor.id).where(Visitor.client_id == entity_id)
    )
    visitor_ids = list(visitor_ids_result.scalars().all())
    visitor_service = self._visitor_service  # type: ignore[attr-defined]
    for vid in visitor_ids:
        await visitor_service._delete_cascade(session, vid)


# ─── Dispatch tables ───────────────────────────────────────────────────────────
# Per-(Model, dep_entity) → handler. Adding a new pair requires BOTH a
# FKDependency entry in :data:`FK_MATRIX` above (with the right ``action``) AND
# a handler entry in the matching table below (nullify/cascade). The base
# ``ArchiveService.resolve_delete`` executor iterates ``FK_MATRIX[self._model]``
# in spec §6 order (nullify → cascade → hard delete) and dispatches each dep.

NULLIFY_HANDLERS: dict[tuple[type[Base], str], _FkHandlerFn] = {
    (Service, "photos"): _h_nullify_service_photos,
    (Client, "records"): _h_nullify_client_records,
    (Client, "photos"): _h_nullify_client_photos,
    (Location, "photos"): _h_nullify_location_photos,
}

CASCADE_HANDLERS: dict[tuple[type[Base], str], _FkHandlerFn] = {
    (Staff, "users"): _h_cascade_master_users,
    (Staff, "masters"): _h_cascade_master_extension,
    (Staff, "master_tags"): _h_cascade_master_tags,
    (Staff, "staff_positions"): _h_cascade_staff_positions,
    (Location, "location_tags"): _h_cascade_location_tags,
    (Service, "tariffs"): _h_cascade_service_tariffs,
    (Service, "service_tags"): _h_cascade_service_tags,
    (Service, "service_materials"): _h_cascade_service_materials,
    (Material, "service_materials"): _h_cascade_material_service_materials,
    (Client, "client_tags"): _h_cascade_client_tags,
    (Client, "visitors"): _h_cascade_client_visitors,  # uses self._visitor_service
}
