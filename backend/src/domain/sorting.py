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

    from sqlalchemy import Select
    from sqlalchemy.orm import InstrumentedAttribute

    from src.schemas.common import SortOrder

    #: The join helper's passthrough type — any single-entity select
    #: (``Select[tuple[Service]]`` at the call sites; the generic param
    #: keeps the helper entity-agnostic).
    _AnySelect = Select[tuple[Any]]

__all__ = [
    "NullsPolicy",
    "SortExpr",
    "SortKeyMap",
    "SortKeySpec",
    "apply_sort",
    "services_specialty_join",
    "staff_specialty_aggregate",
]

#: Type alias for SQLAlchemy order-by expression elements. Two honest
#: arms: a plain SQL ``ColumnElement`` (labeled scalar subqueries, unary
#: expressions) or an ORM ``InstrumentedAttribute`` (``Model.column`` —
#: NOT a ``ColumnElement`` subclass in SQLAlchemy 2.0 typings). Both
#: carry ``asc``/``desc``/``nullsfirst``/``nullslast`` (ColumnOperators),
#: which is all ``apply_sort`` needs. The PEP 695 ``type`` statement is
#: fine here: the alias is never subscripted (unlike ``ModelList`` in
#: ``src/repositories/generic.py``, which must keep the ``TypeAlias``
#: form for mypy subscript support).
type SortExpr = ColumnElement[Any] | InstrumentedAttribute[Any]

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


# ─── GH #599 R2: JOIN-carried sort keys ────────────────────────────────────────
#
# The services ``specialty`` key orders by ``Specialty.title`` — a column
# of ANOTHER table, so the key needs a JOIN in the list statement (spec
# §4.5). The join lives HERE (not as a local resolver at the entity —
# those are banned, docs/domain-rules/_overview.md): both the sort key
# (``api/v1/services.py``) and the eager-load statements
# (``services/service.py``) reference this one builder, so the criterion
# can never drift between ordering and loading.


def services_specialty_join(stmt: _AnySelect) -> _AnySelect:
    """LEFT OUTER JOIN ``specialties`` onto a services select (GH #599 §4.5).

    Many-to-one over a NOT NULL FK — the join is 1:1 for every row, so
    it never changes the row count or the repo COUNT. It carries BOTH
    the ``specialty`` sort key (``ORDER BY specialties.title`` becomes
    addressable) and the eager load of the display title — call it with
    ``contains_eager(Service.specialty_ref)`` in the statement options.
    """
    from src.models.service import Service
    from src.models.specialty import Specialty

    return stmt.outerjoin(Specialty, Service.specialty_id == Specialty.id)



# ─── GH #599 Task 4: aggregate (scalar-subquery) sort keys ────────────────────
#
# The staff ``specialty`` key orders by the DISPLAY STRING — the linked
# dictionary titles joined «, » alphabetically. On a M2M that string is
# per-row aggregated, so the key is a CORRELATED SCALAR SUBQUERY over
# ``staff_specialties`` (spec §4.5): NOT a GROUP BY over the outer query
# — the expression stays a plain ORDER BY term, fully compatible with
# ``apply_sort`` (direction + ``always_nulls_last`` wrap it) and the
# pagination/tie-break mechanics. NULL (no links — no master section)
# falls to the end via the key's nulls policy.
#
# Dialects: ``string_agg(x, ', ' ORDER BY x)`` is the SAME spelling on
# PostgreSQL (native) and SQLite ≥ 3.44 (ordered aggregates; string_agg
# is the group_concat alias). The ORDER BY rides inside the aggregate
# parens as a literal fragment of the separator argument — SQLAlchemy
# has no structural API for in-aggregate ordering, and its ``WITHIN
# GROUP`` spelling is invalid for string_agg on BOTH engines (PG
# rejects it — string_agg is not an ordered-set aggregate). The
# fragment is pinned by unit tests on both dialects
# (tests/domain/test_sorting.py).


def staff_specialty_aggregate() -> SortExpr:
    """The staff ``specialty`` sort key — the DISPLAY string itself
    (GH #599 §4.5): a correlated scalar subquery aggregating the linked
    dictionary titles::

        (SELECT string_agg(specialties.title, ', ' ORDER BY title)
           FROM staff_specialties
           JOIN specialties ON specialties.id = staff_specialties.specialty_id
          WHERE staff_specialties.staff_id = staff.id)

    NOT a GROUP BY over the outer query — a scalar subquery composes
    with ``apply_sort`` (direction + NULLS LAST wrap the whole
    expression) and with pagination/tie-break, and the row count is
    untouched. No master-section links → the aggregate over an empty
    set is NULL → the key's ``always_nulls_last`` policy puts the card
    last in BOTH directions.

    Same string the response carries: the serializer joins the titles
    in Python with the identical alphabetical order (codepoint sort —
    SQLite's BINARY collation on UTF-8 agrees with it). Fresh
    expression per call — callers bake it into ``SortKeySpec`` maps at
    module import.
    """
    from sqlalchemy import func, select, text

    from src.models.specialty import Specialty, staff_specialties
    from src.models.staff import Staff

    return (
        select(
            func.string_agg(Specialty.title, text("', ' ORDER BY title")),
        )
        .select_from(
            staff_specialties.join(
                Specialty, Specialty.id == staff_specialties.c.specialty_id
            )
        )
        .where(staff_specialties.c.staff_id == Staff.id)
        .correlate(Staff)
        .scalar_subquery()
    )
