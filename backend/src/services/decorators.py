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

Usage — two supported forms, both called NATURALLY with their own
declared arguments (no placeholder slot, no leading ``None``)::

    from src.services.decorators import transactional

    class MyService:                       # 1. instance method
        @transactional
        async def create(self, db_session, data):
            ...
            return result

    @transactional                         # 2. selfless scenario function
    async def create_record(db_session, data):
        ...
        return record

Convention: the session parameter sits right after ``self`` for
instance methods, or first for selfless functions (any name —
``db_session``, ``session``). The signature is inspected ONCE, at
decoration time; off-contract shapes are rejected with a loud
TypeError at import, not as an IndexError deep inside a call.

On exception: does NOT commit (let get_db_session rollback).
Double-commit is safe: SQLAlchemy treats commit() on an already-committed
session as a no-op (documented behavior).
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any

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

    Two supported forms (validated ONCE, here at decoration time — the
    signature is not re-inspected per call):

    1. instance method — first parameter ``self``, the session is the
       next parameter (any name: ``db_session``, ``session``, ...);
    2. selfless function (usecases scenario) — no ``self``, the session
       is the first parameter.

    Both forms are called naturally: a bound method receives the
    instance as its implicit first positional argument (delivered by
    Python's binding mechanics), a scenario is called with its own
    declared arguments — keyword pass-through by convention.

    Signature shapes OUTSIDE the contract are rejected loudly at
    decoration (import) time: ``cls`` first (classmethod form), no
    parameters at all, ``*args`` where the session is expected, or
    ``self`` with no session parameter after it.

    Post-commit emit (spec §3.3): resolves the service's canonical entity
    name ONCE per call, opens the accumulator with it (auto-mark), runs
    the method, commits, then publishes the accumulated entities + origin
    to the hub. On exception: no commit, no publish, accumulator
    discarded. ``self``-less functions: no entity resolution, empty
    initial accumulation — any marks they make still publish.

    On exception: does NOT commit (let the caller / get_db_session rollback).
    Double-commit is safe: SQLAlchemy treats commit() on an already-committed
    session as a no-op (documented behavior).
    """
    params = list(inspect.signature(func).parameters.values())
    param_names = [p.name for p in params]
    if not param_names:
        raise TypeError(
            f"@transactional: {func.__name__}() has no parameters — "
            f"a session parameter is required"
        )
    if param_names[0] == "cls":
        raise TypeError(
            f"@transactional: {func.__name__}() starts with ``cls`` — "
            f"the classmethod form is not supported; use an instance "
            f"method (``self``) or a selfless function"
        )
    # Form detection hinges on the wrapped function's first parameter
    # being literally named ``self`` — the Python convention for
    # instance methods. A bound-method call delivers the instance as
    # the implicit FIRST positional argument (args[0] in the wrapper);
    # a selfless scenario arrives with its own clean arguments.
    has_self = param_names[0] == "self"
    session_pos = 1 if has_self else 0
    if len(params) <= session_pos:
        raise TypeError(
            f"@transactional: {func.__name__}() declares ``self`` with "
            f"no session parameter after it — a session is required"
        )
    if params[session_pos].kind is inspect.Parameter.VAR_POSITIONAL:
        raise TypeError(
            f"@transactional: {func.__name__}() has ``*{param_names[session_pos]}`` "
            f"where the session parameter is expected — the session cannot "
            f"be resolved positionally"
        )
    session_name = param_names[session_pos]

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        # Session lookup: the convention is named pass-through (kwargs);
        # the positional branch is a safety net. For a bound method
        # args[0] is the INSTANCE (implicit first positional), so the
        # session sits at index 1; a selfless function takes it at 0.
        if session_name in kwargs:
            session: Any = kwargs[session_name]
        else:
            idx = 1 if has_self else 0  # bound method: args[0] = instance
            if len(args) <= idx:
                raise TypeError(
                    f"@transactional: session parameter '{session_name}' "
                    f"not found in call to {func.__name__}"
                )
            session = args[idx]

        # ── GH #239: open the accumulator (auto-mark the own entity) ──────
        # LAZY import — a top-level import would create a hard cycle
        # (decorators → entities → src.services.generic partially
        # initialized); see the WARNING in src/events/entities.py.
        from src.events.entities import resolve_entity_name

        if has_self:
            entity_name = resolve_entity_name(type(args[0]))
            if entity_name is None:
                raise RuntimeError(
                    f"@transactional: cannot resolve the canonical entity "
                    f"name for {type(args[0]).__qualname__} — declare "
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
    return wrapper
