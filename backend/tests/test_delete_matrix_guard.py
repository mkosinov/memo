"""GH #324 Task 4 — the schema ↔ matrix guard (spec §7, stage 3).

Two one-directional invariants pin ``FK_MATRIX`` to the live tree, so
schema or route drift turns red in the SAME PR:

1. SCHEMA → MATRIX — for every subject ``M`` keyed in ``FK_MATRIX``,
   introspection of ``Base.metadata`` must find every INCOMING FK edge of
   ``M`` (some other table's column referencing ``M``, m2m join tables
   included) declared as a dependency row in ``FK_MATRIX[M]``. A new
   incoming FK column without a matrix row → red.

   OUTGOING edges of the subject are deliberately NOT checked in its own
   matrix: they belong to the OWNERS' matrices (``visit.record_id`` /
   ``visit.visitor_id`` are the ``visits`` rows of ``FK_MATRIX[Record]``
   and ``FK_MATRIX[Visitor]``; in ``FK_MATRIX[Visit]`` — a leaf — they
   are absent and must stay absent). The reverse (a matrix row without a
   direct metadata edge) is legal too: ``FK_MATRIX[Staff]`` carries
   ``activities`` via the masters 1:1 extension row — an indirect edge
   the introspection cannot see.

2. ROUTES → MATRIX — walking ``app.routes`` through the SAME wrapper the
   auth contract uses (``tests.test_auth_contract._api_v1_routes``:
   FastAPI ≥0.141 ``_IncludedRouter`` mounts resolved via
   ``effective_candidates()``), every ``DELETE /api/v1/.../{id}`` maps by
   its static prefix onto a matrix subject (normalization incl. the
   hyphenated ``/api/v1/user-settings/{id}`` mount and the own-scoped
   ``/api/v1/my/settings/{id}`` alias → ``UserSettings``); the subject
   must be an ``FK_MATRIX`` key — leaves carry the empty list. A new
   DELETE route without a matrix key → red.

Known boundary (spec §7): an FK edge created OUTSIDE ``Base.metadata``
(raw SQL or a migration-only constraint without an ORM model) is
invisible to side 1 — a documented limitation, not coverage.

Spec: docs/specs/2026-09-21-delete-family-remaining-324-design.md §7
Domain rules: docs/domain-rules/_overview.md (Hard-delete FK dependency
matrix)
"""

from __future__ import annotations

import pytest

from src.db.base import Base
from src.domain.deletion import FK_MATRIX
from src.models import (
    Activity,
    Client,
    Location,
    Material,
    Payment,
    Photo,
    Position,
    Record,
    Service,
    Staff,
    Tag,
    UserSettings,
    Visit,
    Visitor,
)
from tests.test_auth_contract import _api_v1_routes

pytestmark = pytest.mark.misc


# ─── Side 1: schema → matrix ──────────────────────────────────────────────────


def _incoming_edge_tables(subject: type[Base]) -> set[str]:
    """Dependent-table names of every INCOMING FK edge of ``subject``.

    An incoming edge is any ``ForeignKey`` declared on ANY table of
    ``Base.metadata`` whose referenced column belongs to the subject's
    table — plain child tables (``records.activity_id``) and m2m join
    tables (``activity_tags``) alike. Multiple edges from one table
    collapse into one name: the matrix declares one row per dependent
    TABLE (``dep.entity``), not per column.
    """
    target = subject.__table__
    return {
        table.name
        for table in Base.metadata.sorted_tables
        for fk in table.foreign_keys
        if fk.column.table is target
    }


class TestSchemaToMatrix:
    def test_every_incoming_fk_edge_is_declared(self) -> None:
        """Spec §7 side 1: an incoming FK edge without a dependency row → red."""
        violations: list[str] = []
        for subject, deps in FK_MATRIX.items():
            declared = {dep.entity for dep in deps}
            undeclared = _incoming_edge_tables(subject) - declared
            if undeclared:
                violations.append(
                    f"{subject.__name__} <- {sorted(undeclared)} "
                    "(incoming FK edge(s) with no FK_MATRIX row — declare "
                    "the dependency)"
                )
        assert not violations, (
            f"FK_MATRIX is missing rows for live schema edges (spec §7 side 1): {violations}"
        )

    def test_outgoing_edges_stay_out_of_own_matrix(self) -> None:
        """Pin the guard's one-direction: ``visit.record_id`` and
        ``visit.visitor_id`` are OUTGOING edges of Visit — rows of the
        owners' matrices (``FK_MATRIX[Record]`` / ``FK_MATRIX[Visitor]``
        carry ``visits``), never of the leaf ``FK_MATRIX[Visit]`` (spec §7:
        none there and there must not be)."""
        assert FK_MATRIX[Visit] == []
        assert "visits" in {dep.entity for dep in FK_MATRIX[Record]}
        assert "visits" in {dep.entity for dep in FK_MATRIX[Visitor]}


# ─── Side 2: routes → matrix ──────────────────────────────────────────────────

#: Static path under ``/api/v1`` (up to the first ``{param}`` segment) →
#: the ``FK_MATRIX`` subject owning the DELETE route. Normalization covers
#: the hyphenated ``user-settings`` mount AND the own-scoped ``my/settings``
#: alias (spec §7) — both are ``UserSettings``.
_PREFIX_TO_SUBJECT: dict[str, type[Base]] = {
    "staff": Staff,
    "positions": Position,
    "locations": Location,
    "services": Service,
    "tags": Tag,
    "activities": Activity,
    "clients": Client,
    "visitors": Visitor,
    "records": Record,
    "photos": Photo,
    "visits": Visit,
    "payments": Payment,
    "materials": Material,
    "user-settings": UserSettings,
    "my/settings": UserSettings,
}


def _static_prefix(path: str) -> str:
    """``/api/v1/staff/{staff_id}`` → ``staff``; ``/api/v1/my/settings/{id}``
    → ``my/settings``; a param-less path stays whole (``records``)."""
    stripped = path.removeprefix("/api/v1/")
    head, sep, _ = stripped.partition("/{")
    return head if sep else stripped


class TestRoutesToMatrix:
    def test_every_delete_route_maps_to_a_matrix_subject(self, app) -> None:
        """Spec §7 side 2: a DELETE route whose prefix maps to no subject
        (or whose subject is not an ``FK_MATRIX`` key) → red."""
        violations: list[str] = []
        mapped = 0
        for route in _api_v1_routes(app):
            if "DELETE" not in (route.methods or set()):
                continue
            prefix = _static_prefix(route.path)
            subject = _PREFIX_TO_SUBJECT.get(prefix)
            if subject is None:
                violations.append(
                    f"DELETE {route.path}: prefix {prefix!r} has no subject in "
                    "_PREFIX_TO_SUBJECT — declare the mapping or drop the route"
                )
                continue
            if subject not in FK_MATRIX:
                violations.append(
                    f"DELETE {route.path}: subject {subject.__name__} is not an "
                    "FK_MATRIX key — leaves must carry the empty list"
                )
                continue
            mapped += 1
        assert not violations, (
            f"DELETE routes outside the FK_MATRIX contract (spec §7 side 2): {violations}"
        )
        # Walker liveness: if the app/walker shape changes and the DELETE
        # surface silently empties, this fires instead of a vacuous green
        # (same purpose as test_auth_contract's nonempty-surface sanity).
        assert mapped >= 10, f"only {mapped} DELETE routes mapped — walker broken?"
