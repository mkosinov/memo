r"""Notify templates: dispatcher-side lookup + render entry (sandboxed
Jinja2, templates from the DB — #482 §3.5; rev.5/ADR 014, #485 part 4).

Two seams of the template subsystem live in the notify family:

- HERE (:func:`find_template`) — the §3.7 rev.5 LOOKUP rule with DB
  access: exact ``(event_type, channel)`` → ``(event_type, NULL)``
  (universal) → ``is_default``. The scenario freezes the found row
  (``template_id`` + ``template_body``) into the channel task (ADR
  014): admin edits affect future tasks only.
- :mod:`src.notify.assembly` — the WORKER-side, database-free text
  assembly from the frozen body + payload (rev.5: assembly moved from
  task creation to the worker). That module deliberately imports no
  models — the worker process has no DB (ADR 009).

:func:`render_event` — the part-1 render-once entry kept for the
part-5 admin preview render (spec §3.7: a trial render on sample
variables when saving a template); complete template absence →
``RenderError`` (the general render-error path → 3 attempts →
``processing_error``, Task 9).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from src.notify.assembly import (
    RenderError,
    assemble_text,
    fmt_dt,
    money,
)
from src.notify.models import NotifyTemplate

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

#: Re-exported facade of the assembly half (``__all__`` makes the
#: re-export EXPLICIT — mypy strict has no implicit re-export; tests
#: and the scenario import these names from HERE, not from assembly).
__all__ = [
    "RenderError",
    "assemble_text",
    "find_template",
    "fmt_dt",
    "money",
    "render_event",
]


async def find_template(
    session: AsyncSession,
    event_type: str,
    channel: str | None,
) -> NotifyTemplate | None:
    """§3.7 lookup (rev.5, #485 Task 1): the template row to freeze into
    a channel task — exact ``(event_type, channel)`` → ``(event_type,
    NULL)`` (universal) → ``is_default`` (channel-agnostic: defaults
    are universal only, spec §4.2). None when no tier matches — the
    scenario raises its ``RenderError`` (the 3-attempts /
    ``processing_error`` path of part 1 owns it).

    ``channel=None`` asks for the universal task spelling: tier 1
    collapses into tier 2 (one lookup, same row set).

    ``created_at, id`` ordering keeps each tier's choice deterministic
    should a future CRUD (part 5) ever leave duplicate rows.
    """
    tiers: list[list[Any]] = []
    if channel is not None:
        tiers.append(
            [
                NotifyTemplate.event_type == event_type,
                NotifyTemplate.channel == channel,
            ]
        )
    tiers.append(
        [
            NotifyTemplate.event_type == event_type,
            NotifyTemplate.channel.is_(None),
        ]
    )
    tiers.append([NotifyTemplate.is_default.is_(True)])
    for where in tiers:
        row = await session.execute(
            select(NotifyTemplate)
            .where(*where)
            .order_by(NotifyTemplate.created_at, NotifyTemplate.id)
            .limit(1)
        )
        template = row.scalar_one_or_none()
        if template is not None:
            return template
    return None


async def render_event(
    session: AsyncSession,
    event_type: str,
    snapshot: dict[str, Any],
) -> str:
    """Render the §4.1 ``snapshot`` through the looked-up template —
    the part-1 render entry (kept for the part-5 admin preview render).

    Any failure raises ``RenderError``.
    """
    template = await find_template(session, event_type, channel=None)
    if template is None:
        raise RenderError(
            f"no notify template for event_type={event_type!r} "
            "and no default template (spec §3.5)"
        )
    return assemble_text(template.body, snapshot)
