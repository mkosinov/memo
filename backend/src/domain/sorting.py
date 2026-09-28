"""Shared sort resolver — single source of ORDER BY mechanics (GH #367 §4.2).

All 8 sortable list entities route their ``sort_by``/``sort_order`` through
``apply_sort``; per-entity maps stay at the entities (their content), while
direction/nulls handling and the deterministic tie-break live here. Local
``_X_order_by``-style resolvers in routers/services are forbidden by the
domain rules (docs/domain-rules/_overview.md).

Input contract:

* ``sort_map`` — key → :class:`SortKeySpec` (list of SQLAlchemy expressions
  + nulls policy, per key). The map may map a key to MULTIPLE expressions
  (composite orderings, e.g. staff ``name`` → last_name, first_name);
* ``sort_order`` — ``"asc" | "desc"`` (schemas.common.SortOrder);
* ``tie_break`` — the entity PK column (a simple ``id`` for all 8 entities),
  appended as the LAST expression, always ``asc()`` and NOT subject to any
  nulls policy (a PK is NOT NULL). It guarantees cross-page stability.

The ``sort_by=None`` fallback of scalar dictionary routes stays at the
entity — it is entity content and is never passed to the resolver.

Unknown-key protection has three layers (spec §4.2): (1) per-entity Literal
validation → FastAPI 422 — the user-facing main line; (2) a CI guard keeping
each Literal and its map in sync; (3) this resolver raising
:class:`~src.domain.errors.UnknownSortKeyError`, mapped by the global
exception handler to 422 ``VALIDATION_ERROR`` — the safety net tested by a
direct unit call.

Dialect note: ``nullsfirst``/``nullslast`` are SQLAlchemy constructs over
SQL ``NULLS FIRST``/``NULLS LAST`` — supported by PostgreSQL and SQLite
3.30+; on dialects without native support SQLAlchemy would need an
emulation (CASE-based), which this project does not require.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import ColumnElement

from src.domain.errors import UnknownSortKeyError

if TYPE_CHECKING:
    from collections.abc import Sequence

    from src.schemas.common import SortOrder

__all__ = ["NullsPolicy", "SortExpr", "SortKeyMap", "SortKeySpec", "apply_sort"]

#: Type alias for SQLAlchemy order-by expression elements.
SortExpr = ColumnElement[Any]

#: Per-key nulls placement strategy (GH #367 spec §4.2).
#:
#: - ``canonical`` — the codebase canon: ``asc → nullsfirst``,
#:   ``desc → nullslast`` (matches every pre-#367 resolver).
#: - ``always_nulls_last`` — «пустые — в конце» in BOTH directions;
#:   for LEFT-JOIN-computed columns where an absent row (NULL) must sort
#:   after present ones regardless of direction (staff ``specialty``/``color``).
NullsPolicy = Literal["canonical", "always_nulls_last"]


class SortKeySpec:
    """Spec of one sort key: expressions + nulls policy, per key.

    ``expressions`` may hold multiple entries (composite orderings); they
    are applied in list order, all under the same direction and policy.
    """

    __slots__ = ("expressions", "policy")

    def __init__(
        self,
        expressions: Sequence[SortExpr],
        policy: NullsPolicy = "canonical",
    ) -> None:
        self.expressions: tuple[SortExpr, ...] = tuple(expressions)
        self.policy: NullsPolicy = policy


#: An entity's sort map: ``sort_by`` key → key spec.
SortKeyMap = dict[str, SortKeySpec]


def apply_sort(
    sort_map: SortKeyMap,
    sort_by: str,
    sort_order: SortOrder,
    tie_break: SortExpr,
) -> list[SortExpr]:
    """Apply direction + nulls policy to a sort key; append the PK tie-break.

    Returns the ORDER BY expression list: the key's expressions wrapped per
    policy, then ``tie_break.asc()`` as the LAST expression (never wrapped
    in a nulls policy — PK is NOT NULL).

    Raises ``UnknownSortKeyError`` when ``sort_by`` is missing from the map
    (safety net — see module docstring).
    """
    try:
        spec = sort_map[sort_by]
    except KeyError:
        raise UnknownSortKeyError(sort_by) from None

    ordered: list[SortExpr] = []
    for expr in spec.expressions:
        directed = expr.desc() if sort_order == "desc" else expr.asc()
        # canonical: asc → nullsfirst, desc → nullslast; always_nulls_last
        # overrides the asc half — «пустые — в конце» in BOTH directions.
        if spec.policy == "always_nulls_last" or sort_order == "desc":
            ordered.append(directed.nullslast())
        else:
            ordered.append(directed.nullsfirst())

    ordered.append(tie_break.asc())
    return ordered
