"""Service-layer transaction decorator — Unit of Work pattern.

Commits the session after a service write method returns successfully,
ensuring data is visible BEFORE the HTTP response is sent to the client.

This fixes the read-after-write race caused by get_db_session's
yield-dependency pattern (commit-after-response).

Repository layer does flush() only; service layer owns the transaction
boundary, matching the Unit of Work pattern (Fowler, PoEAA) and
Spring's @Transactional annotation.

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

type _AsyncFunc[**P, R] = Callable[P, Awaitable[R]]


def transactional[**P, R](func: _AsyncFunc[P, R]) -> _AsyncFunc[P, R]:
    """Decorate an async service method to commit its session after success.

    The decorated method MUST accept its session as the first positional
    argument after ``self`` (regardless of parameter name — ``db_session``,
    ``session``, etc.). The decorator inspects the function signature to
    find the session parameter, commits it after the method returns, then
    returns the result.

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

        if has_self:
            result = await func(self, *args, **kwargs)
        else:
            # Staticmethod (or unbound function) — ``self`` is not a real
            # parameter of ``func``, so don't pass it.
            result = await func(*args, **kwargs)
        await session.commit()
        return result

    return cast("_AsyncFunc[P, R]", wrapper)
