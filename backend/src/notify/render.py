"""Notify text rendering — sandboxed Jinja2, templates from the DB (#482 §3.5).

Rendering runs ONCE at task creation (spec §3.4): the finished text is
frozen into ``notify_tasks`` and never re-rendered.

Decisions pinned by the spec:

- ``SandboxedEnvironment`` — template authors cannot escape into Python
  (dunder access raises ``SecurityError``); ``undefined=StrictUndefined``
  — a missing snapshot key is a RENDER ERROR, not a silent blank;
  ``autoescape=False`` — the output is NEUTRAL markup (Markdown common
  denominator); channel-specific conversion belongs to part 3.
- Markup control chars (``*``, ``_``, `` ` ``, ``[``, ``]``) are
  neutralized in snapshot STRING VALUES before substitution — never in
  the template's own markup: the author writes markup, data stays data.
  Client names arrive from a public form; unescaped they could break the
  message layout or inject links on behalf of the studio (panel finding).
- Template lookup: row with matching ``event_type`` first, then the
  ``is_default`` row; complete absence → ``RenderError`` (the general
  render-error path → 3 attempts → ``processing_error``, Task 9).
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

import jinja2
from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select

from src.notify.models import NotifyTemplate

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class RenderError(Exception):
    """Render failed — no template found, or template/sandbox failure.

    The single error type of the render boundary: the dispatcher (Task 9)
    routes it into the «render error → 3 attempts → processing_error»
    policy instead of inspecting Jinja internals.
    """


# Neutral-markup control chars neutralized in snapshot string values
# (spec §3.5). Deterministic scheme: backslash prefix — readable, and a
# plain-text channel just shows the bare character.
_MARKUP_CONTROL_CHARS = "*_`[]"
_ESCAPE_TABLE = str.maketrans({char: "\\" + char for char in _MARKUP_CONTROL_CHARS})


def _neutralize_markup(value: Any) -> Any:
    """Walk the snapshot and escape markup control chars in STRING VALUES.

    Returns a NEW structure — the caller's snapshot dict (already stored
    in ``domain_events.snapshot``) is never mutated. Keys are left alone:
    they are the fixed §4.1 contract, not user data.
    """
    if isinstance(value, str):
        return value.translate(_ESCAPE_TABLE)
    if isinstance(value, dict):
        return {key: _neutralize_markup(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_neutralize_markup(item) for item in value]
    return value


def fmt_dt(value: str | datetime) -> str:
    """``fmt_dt`` filter — stored naive local time → ``%d.%m.%Y %H:%M``.

    Renders the stored value AS IS (spec §3.2: the same interpretation
    as the past/future predicate — no timezone conversion). Accepts the
    ISO string the snapshot carries, or a ``datetime`` for convenience.
    """
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(value)
    return dt.strftime("%d.%m.%Y %H:%M")


def money(value: int | float) -> str:
    """``money`` filter — ``1000`` → ``1 000 ₽``.

    Thousands split by a NON-BREAKING space so channels never rewrap a
    number; a regular space separates the currency sign (spec §3.5).
    """
    return f"{value:,}".replace(",", "\u00a0") + " ₽"


def _build_environment() -> SandboxedEnvironment:
    env = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False)
    env.filters["fmt_dt"] = fmt_dt
    env.filters["money"] = money
    return env


# Module-level singleton: environments are stateless for from_string(),
# and the filter registration happens exactly once.
_ENV = _build_environment()


async def _template_body(session: AsyncSession, event_type: str) -> str:
    """§3.5 lookup: typed row first, then the default; neither → error.

    ``created_at, id`` ordering keeps the choice deterministic should a
    future CRUD (part 5) ever leave duplicate rows.
    """
    typed = await session.execute(
        select(NotifyTemplate.body)
        .where(NotifyTemplate.event_type == event_type)
        .order_by(NotifyTemplate.created_at, NotifyTemplate.id)
        .limit(1)
    )
    body = typed.scalar_one_or_none()

    if body is None:
        default = await session.execute(
            select(NotifyTemplate.body)
            .where(NotifyTemplate.is_default.is_(True))
            .order_by(NotifyTemplate.created_at, NotifyTemplate.id)
            .limit(1)
        )
        body = default.scalar_one_or_none()

    if body is None:
        raise RenderError(
            f"no notify template for event_type={event_type!r} "
            "and no default template (spec §3.5)"
        )
    return body


async def render_event(
    session: AsyncSession,
    event_type: str,
    snapshot: dict[str, Any],
) -> str:
    """Render the §4.1 ``snapshot`` into the final neutral-markup text.

    Called by the scenario handler with the scenario's own session after
    the predicate gates pass; the result is stored frozen in
    ``notify_tasks.text``. Any failure raises ``RenderError``.
    """
    body = await _template_body(session, event_type)
    data = _neutralize_markup(snapshot)
    try:
        return _ENV.from_string(body).render(**data)
    except jinja2.TemplateError as exc:
        # UndefinedError (missing key), SecurityError (sandbox),
        # TemplateSyntaxError (broken authored body) — one boundary type.
        raise RenderError(
            f"notify template render failed for event_type={event_type!r}: {exc}"
        ) from exc
