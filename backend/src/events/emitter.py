"""GH #239 — post-commit emit primitives (spec §3.3, §5).

Two request-scoped contextvars power the emit path:

* **Accumulator** — the set of entity names changed by the CURRENT
  ``@transactional`` transaction. The decorator opens it (token-based
  ``start_accumulation``/``reset_accumulation`` — no cross-request bleed:
  every request runs in its own context, and the wrapper ALWAYS resets in
  ``finally``), seeds it with the service's own entity, and publishes the
  accumulated set to the hub after a successful commit. Service code adds
  cross-entity cascade marks via :func:`mark_changed`.

* **Origin** — the ``X-Memo-Tab-Id`` envelope (spec §2.4) set by the
  middleware for mutating requests; the decorator reads it at publish time.
  Absent header / non-mutating request → ``None``.

``mark_changed`` outside an active transaction is a **no-op with a debug
log** (spec §5) — e.g. called from code that is not under ``@transactional``.

Task semantics (contractual, spec §3.3): the accumulator lives in the
transaction's own task context. ``asyncio.create_task`` snapshots the
CURRENT contextvars values at task-creation time, so a task spawned
BEFORE the transaction opened sees no accumulator (its ``mark_changed``
is a no-op) and a task spawned mid-transaction sees the accumulator as
it was at spawn time. Cascade marking must therefore stay in the
transaction's own task, BEFORE the wrapper's commit — marks from other
tasks are not guaranteed to be delivered.
"""

from __future__ import annotations

import contextvars
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.events.hub import Origin

logger = logging.getLogger("memo.events")

# None = no active transaction in this context → mark_changed is a no-op.
_accumulator: contextvars.ContextVar[set[str] | None] = contextvars.ContextVar(
    "changed_entities", default=None
)
_origin: contextvars.ContextVar[Origin | None] = contextvars.ContextVar(
    "event_origin", default=None
)


def mark_changed(entity: str) -> None:
    """Add ``entity`` to the current transaction's accumulated set.

    No-op with a dev-mode log when called outside an active transaction
    (spec §5) — e.g. from code not under ``@transactional``, or from a
    task spawned before the transaction opened.
    """
    acc = _accumulator.get()
    if acc is None:
        logger.debug("mark_changed(%s) outside a transaction — ignored", entity)
        return
    acc.add(entity)


def set_origin(origin: Origin | None) -> contextvars.Token[Origin | None]:
    """Set the request-scoped origin envelope (middleware, mutating requests)."""
    return _origin.set(origin)


def get_origin() -> Origin | None:
    """Read the origin at publish time; ``None`` when absent."""
    return _origin.get()


def start_accumulation(initial: set[str]) -> contextvars.Token[set[str] | None]:
    """Open a fresh accumulator seeded with ``initial`` (the auto-mark).

    Returns the reset token; the wrapper MUST call
    :func:`reset_accumulation` with it in ``finally``.
    """
    return _accumulator.set(set(initial))


def reset_accumulation(token: contextvars.Token[set[str] | None]) -> None:
    """Close the accumulator (wrapper ``finally``) — no cross-request bleed."""
    _accumulator.reset(token)


def accumulated() -> set[str] | None:
    """The current accumulated set; ``None`` outside a transaction."""
    return _accumulator.get()
