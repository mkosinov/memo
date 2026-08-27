"""Search predicate builder for list `?q=` params (GH #212).

One pure helper; per-entity fields are declared on service classes as
`search_fields`. Substring = case-insensitive ilike '%q%' with %/_ escaping;
exact = equality (e.g. location URLs); uuid = equality only when q is a full
UUID (normalized lowercase — stored ids are lowercase str(uuid4)).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal
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
