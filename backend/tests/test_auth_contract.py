"""GH #247 — default-deny contract: every ``/api/v1`` route is guarded or public.

Spec §2.6/§3.7: the API is default-deny. This contract walks ``app.routes``
and enforces, for every ``APIRoute`` under ``/api/v1``:

* the route carries an auth dependency (``require_session`` /
  ``require_permission`` anywhere in its dependency tree — decorator-level,
  router-level, or signature-level), **or** its ``(method, normalized path)``
  is in ``PUBLIC_ROUTES``;
* every ``PUBLIC_ROUTES`` entry matches a real route (staleness — a removed
  endpoint must not linger in the allowlist).

Path normalization (the ``src/auth/public.py`` docstring convention): real
routers use entity-specific param names (``{master_id}``, ``{photo_id}``, …)
while ``PUBLIC_ROUTES`` uses the literal ``{id}`` — every ``{...}`` segment
is normalized to ``{id}`` before comparing.

Only ``APIRoute``-declared path operations are walked (spec §2.6): CORS
middleware answers OPTIONS preflights before routing, so they never appear
here (§3.5). ``HEAD`` is dropped from ``route.methods`` when ``GET`` is
present — same handler, same guard, added by Starlette for GET routes.

FastAPI ≥0.141 (the pinned uv.lock version) exposes included routers as
lazy ``_IncludedRouter`` mounts, not flat ``APIRoute`` entries; the walk
resolves them via ``effective_candidates()`` — each candidate is the
materialized path operation with the FULL prefix and the MERGED dependency
list (router-level ``include_context.dependencies`` + decorator-level
``route.dependencies`` — fastapi/routing.py ``from_api_route``). On older
FastAPI, where ``app.routes`` holds plain ``APIRoute`` objects, the same
walker uses them directly.

Domain rules: docs/domain-rules/auth.md (Public Access).
Spec: docs/specs/2026-09-08-auth-design.md §2.6, §2.7, §3.5, §3.7, §7
"""

from __future__ import annotations

import re
from typing import Any, Iterator

import pytest
from fastapi.routing import APIRoute

from src.auth.permissions import require_session
from src.auth.public import PUBLIC_ROUTES

pytestmark = pytest.mark.misc

#: Any ``{param}`` path segment → the allowlist's literal ``{id}``.
_PATH_PARAM = re.compile(r"\{[^{}]+\}")


def _normalize(path: str) -> str:
    """``/api/v1/masters/{master_id}`` → ``/api/v1/masters/{id}``."""
    return _PATH_PARAM.sub("{id}", path)


def _is_auth_depend(call: Any) -> bool:
    """True for the two session-guard callables.

    * ``require_session`` — module-level function, identity check;
    * ``require_permission(perm)`` — returns a fresh ``_guard`` closure per
      call, so identity is useless; its qualname is
      ``require_permission.<locals>._guard`` and is stable.

    ``verify_fetch_metadata`` is deliberately NOT an auth dependency — it
    only rejects cross-site browser fetches and authenticates nobody.
    """
    if call is require_session:
        return True
    return getattr(call, "__qualname__", "").startswith("require_permission")


def _route_has_auth_dependency(route: Any) -> bool:
    """Search decorator/router-level and signature-level deps."""
    # Decorator + router level (merged by effective_candidates / APIRoute).
    # FastAPI ≥0.141 renamed ``Depends.call`` → ``Depends.dependency``.
    for dep in route.dependencies:
        call = getattr(dep, "dependency", None) or getattr(dep, "call", None)
        if call is not None and _is_auth_depend(call):
            return True
    # Signature level: Depends(...) params of the endpoint (recursive).
    stack: list[Any] = [route.dependant]
    while stack:
        dependant = stack.pop()
        if dependant is not None and _is_auth_depend(dependant.call):
            return True
        stack.extend(d for d in (getattr(dependant, "dependencies", []) or []) if d is not None)
    return False


def _api_v1_routes(app: Any) -> Iterator[Any]:
    """Yield every /api/v1 path operation (APIRoute-like) on the app.

    FastAPI ≥0.141: ``_IncludedRouter.effective_candidates()`` — the
    materialized routes with full prefixes and merged router+decorator
    dependencies. Older FastAPI: plain ``APIRoute`` objects already carry
    the same attributes (``path``, ``methods``, ``dependencies``,
    ``dependant``).
    """
    for route in app.routes:
        candidates = getattr(route, "effective_candidates", None)
        if candidates is not None:
            for candidate in candidates():
                if candidate.path.startswith("/api/v1"):
                    yield candidate
        elif isinstance(route, APIRoute) and route.path.startswith("/api/v1"):
            yield route


def _route_methods(route: APIRoute) -> set[str]:
    """Declared methods minus HEAD (Starlette adds HEAD for GET routes)."""
    methods = set(route.methods)
    if "GET" in methods:
        methods.discard("HEAD")
    return methods


class TestDefaultDenyContract:
    def test_every_api_v1_route_is_guarded_or_allowlisted(self, app) -> None:
        """No /api/v1 APIRoute may be both dependency-free and off-allowlist."""
        violations: list[str] = []
        for route in _api_v1_routes(app):
            if _route_has_auth_dependency(route):
                continue
            for method in sorted(_route_methods(route)):
                if (method, _normalize(route.path)) not in PUBLIC_ROUTES:
                    violations.append(f"{method} {route.path}")
        assert not violations, (
            "Unguarded /api/v1 routes (add an auth dependency or extend "
            f"PUBLIC_ROUTES — spec §2.6/§2.7): {violations}"
        )

    def test_public_routes_allowlist_has_no_stale_entries(self, app) -> None:
        """Every PUBLIC_ROUTES entry must match a real /api/v1 route."""
        real = {
            (method, _normalize(route.path))
            for route in _api_v1_routes(app)
            for method in _route_methods(route)
        }
        stale = sorted(set(PUBLIC_ROUTES) - real)
        assert not stale, (
            f"Stale PUBLIC_ROUTES entries (no matching route): {stale}"
        )

    def test_api_v1_surface_is_nonempty(self, app) -> None:
        """Sanity: the walk actually sees routes (guards against app changes."""
        assert sum(1 for _ in _api_v1_routes(app)) > 10
