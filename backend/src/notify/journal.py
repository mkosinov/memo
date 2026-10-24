"""GH #482 — domain-event journal accumulator (spec §3.1; family #476).

A mechanical copy of the audit accumulator pattern
(``src/events/audit.py``): a request-scoped contextvar opened/closed
with an ownership token. The ``@transactional`` wrapper is the ONLY
writer point — it opens the accumulator before the method runs, and the
wrapper that OPENED it (the transaction's outer boundary) inserts the
accumulated event rows into the same session after a successful method
return, BEFORE ``commit()``: one record application = one commit = one
event row; a method error rolls the entity and the event back together.

KEY DIFFERENCE from audit (spec §3.1): NO actor is required — the
domain-event journal is DATA, not an action log. Rows are written
ALWAYS (seeds and CLI included); the insertion is unconditional. There
is also no auto-collection, no target entity and no seniority rule —
scenarios mark their events explicitly via :func:`mark_domain_event`
(snapshots are built by the scenario, spec §3.2; Task 6 wires the
pilot ``new_record`` mark).

``occurred_at`` is stamped at MARK time with naive UTC now — the
repository timestamp convention (``AbstractModel.created_at`` and
``AuditLog.created_at`` default to ``utc_now``).

.. NOTE:: IMPORT DISCIPLINE (precedent: ``audit.py``)
    This module imports NO models — the staged row is a plain dict
    keyed by ``DomainEvent`` column names, and the model import stays
    with the inserting wrapper (``src/services/decorators.py``).
    Consumers inside ``src/services/`` import this module lazily.
"""

from __future__ import annotations

import contextvars
import logging
from typing import Any

from src.util.utc import utc_now

logger = logging.getLogger("memo.notify.journal")

# None = no open accumulator in this context → mark_domain_event is a no-op.
_pending: contextvars.ContextVar[list[dict[str, Any]] | None] = (
    contextvars.ContextVar("notify_journal_pending", default=None)
)


def open_journal() -> contextvars.Token[list[dict[str, Any]] | None] | None:
    """Open a fresh accumulator; ``None`` when one is already open.

    The ``None`` return is the ownership signal for nested decorated
    wrappers (spec §3.1, single-owner rule): only the wrapper whose
    ``open_journal()`` returned a token is the transaction's outer
    boundary — it alone inserts and resets the accumulator; inner
    wrappers see ``None`` and do nothing.
    """
    if _pending.get() is not None:
        return None  # sentinel: an accumulator is already open — not the owner
    return _pending.set([])


def reset_journal(
    token: contextvars.Token[list[dict[str, Any]] | None] | None,
) -> None:
    """Close the accumulator (owner wrapper ``finally``); ``None`` is a no-op."""
    if token is not None:
        _pending.reset(token)


def pending_events() -> list[dict[str, Any]] | None:
    """The staged event rows; ``None`` outside an open accumulator."""
    return _pending.get()


def draw_events() -> list[dict[str, Any]] | None:
    """Take all staged rows (owner wrapper, pre-commit); clears the list.

    ``None`` when no accumulator is open; otherwise the (now emptied)
    list is returned for insertion into the owning session.
    """
    rows = _pending.get()
    if rows is None:
        return None
    drawn = list(rows)
    rows.clear()
    return drawn


def mark_domain_event(type: str, snapshot: dict[str, Any] | None) -> None:
    """Stage one domain-event row in the current transaction's accumulator.

    ``occurred_at`` is stamped NOW with naive UTC (the repository
    timestamp convention — mirrors the ``utc_now`` model
    defaults); the ``snapshot`` is stored as passed (the scenario-side
    builder owns its §4.1 serialization contract). The row is a plain
    dict keyed by ``DomainEvent`` column names. No-op with a debug log
    when no accumulator is open (outside ``@transactional``, or a task
    spawned before the transaction opened) — same contract as
    ``mark_audit`` / ``mark_changed``.
    """
    rows = _pending.get()
    if rows is None:
        logger.debug(
            "mark_domain_event(%s) outside a transaction — ignored", type
        )
        return
    rows.append(
        {
            "type": type,
            "occurred_at": utc_now(),
            "snapshot": snapshot,
        }
    )
