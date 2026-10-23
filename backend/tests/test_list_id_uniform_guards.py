"""GH #371 Task 8 — the guards: wire contract + code form (spec §4.5).

Two guards keep the uniform list-entry shape (one model via
``Annotated[XListParams, Query()]``, ``id`` narrowing inherited from
``PaginationParams`` — domain rule 8) from drifting back to the
pre-#371 forms:

* Guard 1 — wire contract (``TestOpenApiIdContractGuard``): reads the
  GENERATED schema (``app.openapi()``: the query model's fields are
  already expanded into individual parameters) and requires every GET
  route whose 200 envelope is ``PaginatedResponse[...]`` to declare
  the ``id`` query parameter. Guard class #367: green by construction
  today; the value is that the FIRST new paginated list without the
  ``?id=`` contract fails on its first CI run.
* Guard 2 — code form (``TestStructuralFormGuard``): a source-scan
  test over ``backend/src`` — the ``IdQueryParam`` alias and the local
  ``IdListQuery`` sibling are banned (§4.4 deleted both: comments and
  docstrings included, a historical mention reads as a live contract),
  and no function signature may inject pagination via ``Depends`` in
  ANY spelling: a match of ``PaginationParams`` with a ``Depends()``
  default in ONE signature catches both real shapes
  (``pagination: PaginationParams = Depends()`` — the tree's
  historical form — and ``Depends(PaginationParams)``). The injection
  form is invisible on the wire, so guard 1 cannot catch a form drift;
  this one can (restoring the old shape fails the run).

Plus the §6 route-protection pin: the auth guards survive the
rewritten signatures (one unauthenticated 401 probe on a converted
route — audit-logs, router-level ``require_admin``).
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.api

SRC_DIR = Path(__file__).resolve().parents[1] / "src"

# Spec §4.5: the exact count of paginated GET routes — the 11 #371
# conversions plus the 5 already-model-shaped lists (clients, records
# list, records view, masters, photos) and the client-cabinet reads
# GET /api/v1/my/{records,photos,payments} (#513 — PaginationParams
# brick as-is). A new paginated list changes the count: extend the pin
# CONSCIOUSLY, with the ``id`` contract in place (the missing-``id``
# check below fails first if not).
EXPECTED_PAGINATED_LISTS = 19

# Spec §4.4: deleted shapes — zero occurrences allowed anywhere in
# src (code, comments, docstrings).
FORBIDDEN_NAMES = ("IdQueryParam", "IdListQuery")


def _src_files() -> list[Path]:
    return sorted(SRC_DIR.rglob("*.py"))


def _paginated_get_paths(schema: dict[str, Any]) -> list[str]:
    """GET paths whose 200 envelope is ``PaginatedResponse[...]``.

    FastAPI names the envelope component ``PaginatedResponse_<Item>_``;
    bare ``/all`` routes inline an array schema and SSE routes carry no
    JSON content — neither matches, exactly the §4.5 predicate.
    """
    paths: list[str] = []
    for path, ops in schema["paths"].items():
        get_op = ops.get("get")
        if get_op is None:
            continue
        ref = (
            get_op.get("responses", {})
            .get("200", {})
            .get("content", {})
            .get("application/json", {})
            .get("schema", {})
            .get("$ref", "")
        )
        if ref.rsplit("/", 1)[-1].startswith("PaginatedResponse"):
            paths.append(path)
    return paths


def _is_depends_call(node: ast.AST) -> bool:
    """``Depends(...)`` in either spelling: bare name or ``fastapi.Depends``."""
    return isinstance(node, ast.Call) and (
        (isinstance(node.func, ast.Name) and node.func.id == "Depends")
        or (isinstance(node.func, ast.Attribute) and node.func.attr == "Depends")
    )


class TestOpenApiIdContractGuard:
    """Guard 1 — every paginated GET publishes the ``id`` query param."""

    def test_paginated_get_route_count_is_pinned(self, app) -> None:
        paths = _paginated_get_paths(app.openapi())
        assert len(paths) == EXPECTED_PAGINATED_LISTS, (
            f"expected {EXPECTED_PAGINATED_LISTS} paginated GET routes, "
            f"found {len(paths)}: {sorted(paths)} — extend the pin "
            f"consciously (spec §4.5)"
        )

    def test_every_paginated_get_publishes_id_query_param(self, app) -> None:
        schema = app.openapi()
        missing = []
        for path in _paginated_get_paths(schema):
            params = schema["paths"][path]["get"]["parameters"]
            names = {p["name"] for p in params if p["in"] == "query"}
            if "id" not in names:
                missing.append(path)
        assert not missing, (
            f"paginated lists without the ?id= contract: {missing} — "
            f"id narrowing is a PaginationParams field (domain rule 8)"
        )


class TestStructuralFormGuard:
    """Guard 2 — the pre-#371 entry shapes stay banned in ``backend/src``."""

    def test_deleted_names_absent_from_src(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            text = py.read_text(encoding="utf-8")
            rel = py.relative_to(SRC_DIR)
            offenders += [
                f"{rel}: {name}" for name in FORBIDDEN_NAMES if name in text
            ]
        assert not offenders, (
            f"banned pre-#371 names found in src (§4.4 deleted them): {offenders}"
        )

    def test_no_pagination_depends_injection_in_signatures(self) -> None:
        offenders: list[str] = []
        for py in _src_files():
            tree = ast.parse(py.read_text(encoding="utf-8"))
            rel = py.relative_to(SRC_DIR)
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                defaults = [
                    d
                    for d in (*node.args.defaults, *node.args.kw_defaults)
                    if d is not None
                ]
                if not any(_is_depends_call(d) for d in defaults):
                    continue
                annotations = [
                    a.annotation
                    for a in (
                        *node.args.posonlyargs,
                        *node.args.args,
                        *node.args.kwonlyargs,
                    )
                    if a.annotation is not None
                ]
                sig_text = " ".join(
                    ast.unparse(part) for part in (*annotations, *defaults)
                )
                if "PaginationParams" in sig_text:
                    offenders.append(f"{rel}:{node.lineno} {node.name}")
        assert not offenders, (
            f"Depends-injected pagination found (both spellings banned, "
            f"rule 8 / spec §4.4): {offenders} — pagination rides "
            f"Annotated[XListParams, Query()]"
        )


class TestRouteGuardsSurviveConversion:
    """§6 — auth guards survive the rewritten signatures (pin: audit-logs)."""

    def test_anonymous_audit_logs_gets_401(self, app) -> None:
        anon = TestClient(app)
        resp = anon.get("/api/v1/audit-logs")
        assert resp.status_code == 401
