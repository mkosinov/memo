"""Search predicate builder for list `?q=` params (GH #212).

One pure helper; per-entity fields are declared on service classes as
`search_fields`. Substring = case-insensitive ilike '%q%' with %/_ escaping;
exact = equality (e.g. location URLs); uuid = equality only when q is a full
UUID (normalized lowercase — stored ids are lowercase str(uuid4)).
GH #232 §3.1 adds the ``ids_in_predicate`` narrowing helper — the typed
``?id=`` set filter shared by the universal path and the view builders.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import ColumnElement, or_

_ESCAPE = "\\"


@dataclass(frozen=True)
class SearchField:
    column: ColumnElement  # InstrumentedAttribute at call sites
    kind: Literal["substring", "exact", "uuid"] = "substring"


def _escape_like(q: str) -> str:
    return q.replace(_ESCAPE, _ESCAPE * 2).replace("%", f"{_ESCAPE}%").replace("_", f"{_ESCAPE}_")


def _full_uuid(q: str) -> str | None:
    if len(q) != 36:
        return None
    try:
        return str(UUID(q))  # normalizes case + validates
    except ValueError:
        return None


def search_predicate(q: str, fields: Sequence[SearchField]) -> ColumnElement[bool]:
    """OR'd predicate for q over declared fields. Raises ValueError if fields empty."""
    if not fields:
        raise ValueError("search_fields must be non-empty when q is provided")
    uuid_q = _full_uuid(q)
    clauses = []
    for f in fields:
        if f.kind == "substring":
            clauses.append(f.column.ilike(f"%{_escape_like(q)}%", escape=_ESCAPE))
        elif f.kind == "exact":
            clauses.append(f.column == q)
        else:  # uuid
            if uuid_q is not None:
                clauses.append(f.column == uuid_q)
    return or_(*clauses)


def ids_in_predicate(
    column: Any, ids: Sequence[UUID] | None
) -> ColumnElement[bool] | None:
    """GH #232 §3.1 — typed ``column IN (…)`` narrowing from ``PaginationParams.id``.

    The ONE-LINE narrowing helper for both consumers of the shared ``?id=``
    mechanism: the universal ``GenericService`` path and the view builders
    (``list_clients_with_stats`` / records / masters / photos). Values are
    canonicalized to ``str(uuid)`` BEFORE the IN-expansion — stored ids are
    ``str(uuid4)`` (String(36) columns), never UUID driver objects.
    ``None`` / empty list → ``None`` (no predicate — the filter is opt-in).
    ``column`` is an ORM instrumented attribute (``Any`` — the same
    loose-typing precedent as ``SearchField.column`` call sites).
    """
    if not ids:
        return None
    pred: ColumnElement[bool] = column.in_([str(i) for i in ids])
    return pred
