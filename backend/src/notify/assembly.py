r"""Notify text assembly — the WORKER-side, database-free half of the
render seam (#485 part 4, ADR 014; grows out of the part-1 render
module of #482 §3.5).

Deliberately NO database imports here: the worker process has no DB
(ADR 009) yet assembles the task text itself (rev.5, ADR 014) from the
FROZEN ``template_body`` + ``payload`` that ride the task payload
(§4.2). The dispatcher-side half — template LOOKUP from
``notify_templates`` — stays in :mod:`src.notify.render`.

Decisions pinned by the spec:

- ``SandboxedEnvironment`` — template authors cannot escape into Python
  (dunder access raises ``SecurityError``); ``undefined=StrictUndefined``
  — a missing payload key is an ASSEMBLY ERROR, not a silent blank;
  ``autoescape=False`` — escaping is keyed by the task's channel at
  substitution time (rev.5), never a blanket HTML mode. Per-channel
  escape variants (HTML values for telegram etc., spec §5.3) arrive
  with part 4 Task 2 — this module is the Task-1 mechanical bridge on
  the part-1 environment.
- Markup control chars (``*``, ``_``, `` ` ``, ``[``, ``]`` and the
  backslash itself) are neutralized in payload STRING VALUES before
  substitution — never in the template's own markup: the author writes
  markup, data stays data. The backslash is in the set so a
  client-supplied ``\[`` cannot re-activate what escaping neutralized
  (``\\[`` would render as a literal ``\`` + ACTIVE link start).
  Client names arrive from a public form; unescaped they could break
  the message layout or inject links on behalf of the studio (panel
  finding).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import jinja2
from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment


class RenderError(Exception):
    """Assembly/lookup failed — no template found, or template/sandbox
    failure.

    The single error type of the render boundary: the dispatcher (Task 9)
    routes it into the «render error → 3 attempts → processing_error»
    policy, the worker closes the channel attempt as an ``app_error``
    (spec §5.4) instead of inspecting Jinja internals.
    """


# Neutral-markup control chars neutralized in payload string values
# (spec §3.5). Deterministic scheme: backslash prefix — readable, and a
# plain-text channel just shows the bare character. The backslash IS in
# the set: str.translate replaces single chars, so ``\[`` becomes
# ``\\\[`` — both chars prefixed, no active escape/link sequence left.
_MARKUP_CONTROL_CHARS = "*_`\\[]"
_ESCAPE_TABLE = str.maketrans({char: "\\" + char for char in _MARKUP_CONTROL_CHARS})


def _neutralize_markup(value: Any) -> Any:
    """Walk the payload and escape markup control chars in STRING VALUES.

    Returns a NEW structure — the caller's payload dict (already stored
    in ``notify_tasks.payload``) is never mutated. Keys are left alone:
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


def assemble_text(template_body: str, payload: dict[str, Any]) -> str:
    """Assemble the task text from the FROZEN template body + render
    payload (rev.5, ADR 014) — the worker-side seam.

    Task-1 mechanical bridge: the existing sandbox environment (strict
    undefineds, markup neutralization of payload values) assembles the
    text; the per-channel escape variants of spec §5.3 (HTML values for
    telegram etc.) arrive with part 4 Task 2. Any failure raises
    ``RenderError`` — the worker closes the channel attempt as an
    application error (no transport retries, deterministic failure).
    """
    data = _neutralize_markup(payload)
    try:
        return _ENV.from_string(template_body).render(**data)
    except (jinja2.TemplateError, ValueError, TypeError) as exc:
        # UndefinedError (missing key), SecurityError (sandbox),
        # TemplateSyntaxError (broken authored body), plus ValueError /
        # TypeError — a filter blowing up on a bad VALUE (e.g. fmt_dt on
        # a non-ISO string, money on None). One boundary type.
        raise RenderError(f"notify text assembly failed: {exc}") from exc
