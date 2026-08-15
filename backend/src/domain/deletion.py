"""Domain layer — FK dependency matrix + dependency resolver for hard-delete.

Single source of truth for the GH #207 hard-delete + dependency-resolution
mechanism. The unified DELETE route (Task 9) reads :func:`collect_dependencies`
and the :class:`BlockingDepsError`/:class:`InvalidResolutionError` exceptions;
the ``resolve_delete`` executor (Task 10) consumes :data:`FK_MATRIX`,
:func:`has_blocking_deps`, :func:`validate_resolutions` and the exceptions.

Spec: ``docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md``
  * §4  — FK matrix (the full per-entity table).
  * §5  — 409 Conflict response shape (counters + ``cascade_preview`` only).
  * §6  — resolutions body rules.
  * §11 — context facts (Activity has no ``is_active``; Material has zero FK deps).
  * §16 — auto-deps ignored when sent in the resolutions body.

The matrix is hand-verified against the FK shapes in ``src/models/``:

  * ``Activity`` — NOT-NULL ``master_id``/``location_id``/``service_id``, no
    ``is_active`` → always blocks delete on Master/Location/Service.
  * ``User.master_id`` — nullable+unique → Master cascade (auto, Change 2 §4.1).
  * ``Tariff.service_id`` — NOT NULL → Service cascade (auto).
  * ``Photo.service_id`` — nullable → Service nullify (auto).
  * ``Record.client_id`` — nullable → Client nullify (user choice).
  * ``Visitor.client_id`` — NOT NULL → Client cascade (user choice).
  * join tables ``master_tags``/``location_tags``/``service_tags``/
    ``client_tags`` — NOT-NULL PK → cascade (auto).
  * ``Material`` — no FK dependents → always 204.
"""

from __future__ import annotations

# ruff: noqa: RUF001  -- Cyrillic text is intentional (Russian UI labels per spec §5)
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.photo import Photo
from src.models.record import Record
from src.models.service import Service
from src.models.tag import (
    client_tags,
    location_tags,
    master_tags,
    service_tags,
)
from src.models.tariff import Tariff
from src.models.user import User
from src.models.visit import Visit
from src.models.visitor import Visitor

if TYPE_CHECKING:
    from src.db.base import Base


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
    Master: [
        FKDependency(
            entity="activities", relation="Активность", nullable=False,
            action="block", auto=False, allowed_actions=[], message=_BLOCK_MESSAGE,
        ),
        FKDependency(
            entity="users", relation="Пользователь", nullable=True,
            action="cascade", auto=True, allowed_actions=["cascade"],
        ),
        FKDependency(
            entity="master_tags", relation="Тег", nullable=False,
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
    ],
    Material: [],
}


# ─── 409 response shape (§5) ────────────────────────────────────────────────────


class DependencyNode(BaseModel):
    """One entry in the 409 ``dependencies`` array.

    Matches spec §5: ``{"entity", "count", "allowed_actions", "message",
    "cascade_preview"}`` plus the human ``relation`` label. Built manually by
    :func:`collect_dependencies` (no ORM ``from_attributes`` mapping needed) so
    the 409 carries counters + sums only — never individual row data.
    """

    model_config = ConfigDict(extra="forbid")

    entity: str
    relation: str
    count: int
    allowed_actions: list[str]
    message: str | None = None
    cascade_preview: dict[str, int] | None = None


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
        select(func.count()).select_from(User).where(User.master_id == entity_id)
    )
    return r.scalar_one(), None


async def _count_m_master_tags(s: AsyncSession, entity_id: str) -> _CountResult:
    r = await s.execute(
        select(func.count()).select_from(master_tags)
        .where(master_tags.c.master_id == entity_id)
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


_COUNTERS: dict[tuple[type[Base], str], _CounterFn] = {
    (Master, "activities"): _count_m_activities,
    (Master, "users"): _count_m_users,
    (Master, "master_tags"): _count_m_master_tags,
    (Location, "activities"): _count_l_activities,
    (Location, "location_tags"): _count_l_location_tags,
    (Service, "activities"): _count_s_activities,
    (Service, "tariffs"): _count_s_tariffs,
    (Service, "photos"): _count_s_photos,
    (Service, "service_tags"): _count_s_service_tags,
    (Client, "records"): _count_c_records,
    (Client, "visitors"): _count_c_visitors,
    (Client, "client_tags"): _count_c_client_tags,
}


# ─── 409 builder ────────────────────────────────────────────────────────────────


async def collect_dependencies(
    session: AsyncSession, model: type, entity_id: str,
) -> list[DependencyNode]:
    """Run COUNT queries for each FK relation in ``FK_MATRIX[model]``.

    Returns the 409 ``dependencies`` array. Zero-count deps are skipped (§5).
    Each node carries: ``entity``, ``relation``, ``count``, ``allowed_actions``,
    ``message``; Client → visitors additionally carries
    ``cascade_preview`` = ``{"visits": N}`` (NO payments per §5).

    Used by Task 9's unified DELETE route (no-body mode → 409 builder).
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
        nodes.append(
            DependencyNode(
                entity=dep.entity,
                relation=dep.relation,
                count=count,
                allowed_actions=list(dep.allowed_actions),
                message=dep.message,
                cascade_preview=preview,
            )
        )
    return nodes


def has_blocking_deps(nodes: list[DependencyNode]) -> bool:
    """``True`` if any node has ``allowed_actions == []`` (the activities case).

    Such an entity cannot be deleted by either DELETE mode — only archived.
    """
    return any(not n.allowed_actions for n in nodes)


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
