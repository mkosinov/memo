"""Service-layer transaction decorator — Unit of Work pattern.

Commits the session after a service write method returns successfully,
ensuring data is visible BEFORE the HTTP response is sent to the client.

This fixes the read-after-write race caused by get_db_session's
yield-dependency pattern (commit-after-response).

Repository layer does flush() only; service layer owns the transaction
boundary, matching the Unit of Work pattern (Fowler, PoEAA) and
Spring's @Transactional annotation.

GH #239 — the decorator is also the SINGLE post-commit emit point
(spec §3.3): before the wrapped call it opens a fresh entity accumulator
seeded with the service's own canonical entity name; after a successful
``session.commit()`` it publishes the accumulated set to the event hub
with the request's origin envelope; on exception/rollback nothing is
published and the accumulator is discarded. The wrapper also stamps the
bound method with ``__memo_transactional__ = True`` for test
introspection (completeness discovery).

GH #344 (spec §4.4) — the wrapper is also the SINGLE audit insertion
point. It opens a parallel audit accumulator (token-based, mirroring
the #239 name accumulator) BEFORE the wrapped call; after a successful
method return and BEFORE ``commit()`` the OWNING wrapper — the one whose
``open_audit()`` returned a token — inserts the accumulated journal
rows into the same session: one commit for action + journal, one
rollback on error. Inner decorated wrappers see an already-open
accumulator and insert nothing (no duplicate rows per level). No actor
in the request context → nothing is inserted (spec §4.1: seeds, CLI,
session-less fixtures, anonymous mutations are not journaled); the
method itself still runs and commits.

Usage:
    from src.services.decorators import transactional

    class MyService:
        @transactional
        async def create(self, db_session, data):
            ...
            return result

Convention: the session must be the first parameter after ``self``
(named ``db_session`` or ``session`` — the decorator inspects the
signature to find it).

On exception: does NOT commit (let get_db_session rollback).
Double-commit is safe: SQLAlchemy treats commit() on an already-committed
session as a no-op (documented behavior).
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any, cast

from src.events import emitter
from src.events.hub import hub

type _AsyncFunc[**P, R] = Callable[P, Awaitable[R]]

# Marker attribute stamped on wrapped methods: "this method commits via
# @transactional" — test introspection (entity completeness walk) keys on it.
_TRANSACTIONAL_MARKER = "__memo_transactional__"


def _insert_audit_rows(session: Any) -> None:
    """Insert the accumulated audit rows into ``session`` (spec §4.4).

    Called by the OWNING wrapper after a successful method return and
    BEFORE ``commit()`` — action + journal in one commit, rolled back
    together on any error. Skipped entirely when no actor is staged
    (spec §4.1: no author → no journal row) or when nothing accumulated
    (no marks — repository auto-collection arrives in Task 3).

    LAZY imports — cycle hazard precedents: the audit module must not be
    imported at ``decorators`` top level (same rule as
    ``src.events.entities`` — see its WARNING), and the model import
    lives here, not in the accumulator module.
    """
    from src.events import audit

    if audit.current_actor() is None:
        return  # no author → no journal (§4.1); the action itself stands
    rows = audit.draw_rows()
    if not rows:
        return
    from src.models.audit_log import AuditLog

    session.add_all(AuditLog(**row) for row in rows)


def transactional[**P, R](func: _AsyncFunc[P, R]) -> _AsyncFunc[P, R]:
    """Decorate an async service method to commit its session after success.

    The decorated method MUST accept its session as the first positional
    argument after ``self`` (regardless of parameter name — ``db_session``,
    ``session``, etc.). The decorator inspects the function signature to
    find the session parameter, commits it after the method returns, then
    returns the result.

    Post-commit emit (spec §3.3): resolves the service's canonical entity
    name ONCE per call, opens the accumulator with it (auto-mark), runs
    the method, commits, then publishes the accumulated entities + origin
    to the hub. On exception: no commit, no publish, accumulator discarded.

    ``self``-less functions (staticmethod-style): no entity resolution,
    empty initial accumulation — any marks they make still publish.

    On exception: does NOT commit (let the caller / get_db_session rollback).
    Double-commit is safe: SQLAlchemy treats commit() on an already-committed
    session as a no-op (documented behavior).
    """

    @wraps(func)
    async def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        # Find the session parameter. Convention: the session is the first
        # parameter after ``self``. If the wrapped function has no ``self``
        # (e.g. a ``@staticmethod``), the session is the first parameter.
        sig = inspect.signature(func)
        param_names = list(sig.parameters.keys())
        has_self = bool(param_names) and param_names[0] == "self"
        session_name = param_names[1] if has_self else param_names[0]

        if session_name in kwargs:
            session = kwargs[session_name]
        elif args:
            # args[0] is the first positional arg passed after ``self`` to
            # the wrapper. In the wrapper, ``self`` is the *implicit* first
            # arg (the instance). So args[0] corresponds to the session for
            # both instance methods and staticmethods.
            session = args[0]
        else:
            raise TypeError(
                f"@transactional: session parameter '{session_name}' "
                f"not found in call to {func.__name__}"
            )

        # ── GH #239: open the accumulator (auto-mark the own entity) ──────
        # LAZY import — a top-level import would create a hard cycle
        # (decorators → entities → src.services.generic partially
        # initialized); see the WARNING in src/events/entities.py.
        from src.events.entities import resolve_entity_name

        if has_self:
            entity_name = resolve_entity_name(type(self))
            if entity_name is None:
                raise RuntimeError(
                    f"@transactional: cannot resolve the canonical entity "
                    f"name for {type(self).__qualname__} — declare "
                    f"``entity_name`` or map its model in "
                    f"src/events/entities.py (spec §3.3/§3.4)"
                )
        else:
            entity_name = None  # bare function — no service class to resolve
        token = emitter.start_accumulation({entity_name} if entity_name else set())
        # ── GH #344: open the audit accumulator (spec §4.4) ─────────────
        # The wrapper that receives a token OWNS it (transaction outer
        # boundary); nested wrappers get None and neither insert nor
        # reset. ``entity_name`` doubles as the TARGET entity (spec
        # §4.2): repository auto-collection journals rows only for the
        # transaction's own service entity; ``None`` (selfless scenario
        # wrapper) keeps auto-collection off — scenarios mark their rows
        # explicitly (§4.3). LAZY import — cycle precedent (see above +
        # audit.py).
        from src.events import audit as _audit

        audit_token = _audit.open_audit(entity_name)
        try:
            if has_self:
                result = await func(self, *args, **kwargs)
            else:
                # Staticmethod (or unbound function) — ``self`` is not a
                # real parameter of ``func``, so don't pass it.
                result = await func(*args, **kwargs)
            # Audit insert BEFORE commit (§4.4): action + journal in one
            # commit; owner-only (nested wrappers inserted nothing).
            if audit_token is not None:
                _insert_audit_rows(session)
            await session.commit()
            # Emit only on success — after commit, before returning (§3.3).
            hub.publish(emitter.accumulated() or set(), emitter.get_origin())
            return result
        finally:
            # Rollback path: the accumulator is discarded without publishing.
            emitter.reset_accumulation(token)
            # Owner-only reset (§4.4); None token (inner wrapper) is a no-op.
            _audit.reset_audit(audit_token)

    setattr(wrapper, _TRANSACTIONAL_MARKER, True)
    return cast("_AsyncFunc[P, R]", wrapper)
