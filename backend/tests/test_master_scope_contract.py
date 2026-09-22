"""GH #263 T7 — scope-coverage contract: every master-readable ``/api/v1``
route either passes through the scope layer or is explicitly allowlisted.

Above the per-entity suites (T2–T5) this contract closes the LOOPHOLE the
point tests cannot: a NEW route added to a master-readable router without
scope wiring must fail here. Mirrors the #247 default-deny contract
(``test_auth_contract.py`` walks the same route tree for auth guards).

Two allowlists, both staleness-checked against the live route table:

* ``SCOPE_WIRED_ROUTERS`` — routers whose master-readable read paths are
  narrowed server-side by ``get_scope`` / ``get_optional_scope`` through
  the service scope layer (activities, records, clients, visitors, visits,
  payments, photos);
* ``ALLOWED_UNSCOPED`` — exact ``(METHOD, normalized path)`` entries that a
  master may reach WITHOUT scope, each with a one-line justification:
  dictionary reads (masters/locations/services/tags — reference data, not
  master-owned), the auth surface, own-data endpoints (``/my``,
  ``/user-settings``), public surfaces (``/photos/web``, health) and the
  SSE transport (``/events`` — a transport, not an entity).

A route in a scope-wired router that is NOT a read path (mutations carry
their own gates: permission, admin role, or scope-in-service owner checks)
is covered by ``UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS`` — the mutation
entries are either permission-gated (master 403) or scope-checked in the
service layer by T2–T5; the CONTRACT only demands an explicit decision for
every route, not that the decision is always «scope».

Path normalization follows the ``src/auth/public.py`` convention: every
``{...}`` segment becomes ``{id}``.

404-fast-path (spec D1: «чужое ≈ не существует»): the second contract pins
that for every master-readable point-get the FOREIGN id and a MISSING id
return the SAME status code (404) — an owner probe must not leak 403 or a
200. Status-equality only, per plan wording (query-count pinning lives in
``test_list_activities_query_count.py``).

Spec: docs/specs/2026-09-10-master-role-design.md (Scope-слой, D1)
Domain rules: docs/domain-rules/auth.md (Per-master data scoping #263)
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.routing import APIRoute

pytestmark = pytest.mark.misc

#: Routers whose reads go through the scope layer (``get_scope`` /
#: ``get_optional_scope`` → service ``master_key`` filters). Module names
#: relative to ``src/api/v1``.
SCOPE_WIRED_ROUTERS: frozenset[str] = frozenset({
    "activities",  # T2: list kwargs + get_scoped (optional scope — public list)
    "records",     # T2: list/view stmt-builder + get_scoped (+ create gate)
    "clients",     # T3: EXISTS-scope list + get_scoped + mask + /get
    "visitors",    # T2: visibility predicate + get_scoped gates
    "visits",      # T2: visit → record → activity predicates + gates
    "payments",    # T4: stmt-builder + get_scoped + totals filter
    "photos",      # T5: EXISTS-scope + get_scoped
})

#: The exact scope-narrowed routes per wired router — pinned BOTH ways
#: (a route loses its ``get_scope``/``get_optional_scope`` wiring → the
#: staleness test fails; a route disappears → the staleness test fails).
#: The scope dependency sits in the endpoint SIGNATURE (not in
#: ``route.dependencies``), so the only honest contract is enumeration:
#: these are the routes whose behavior T2–T5 pin per entity.
SCOPE_WIRED_ROUTES: dict[str, dict[tuple[str, str], str]] = {
    "activities": {
        ("GET", "/api/v1/activities"): "public list, get_optional_scope (T2)",
        ("GET", "/api/v1/activities/{id}"): "public get, get_optional_scope (T2)",
    },
    "records": {
        ("GET", "/api/v1/records"): "get_scope → scoped stmt (T2)",
        ("GET", "/api/v1/records/view"): "get_scope → scoped view stmt (T2)",
        ("GET", "/api/v1/records/{id}"): "get_scope + get_scoped (T2)",
        ("POST", "/api/v1/records"): "public booking, get_optional_scope parent gate (T2)",
    },
    "clients": {
        ("GET", "/api/v1/clients"): "get_scope → EXISTS-scope (T3)",
        ("GET", "/api/v1/clients/get"): "get_scope → scope-free search + MASK (T3/D3/D4)",
        ("GET", "/api/v1/clients/{id}"): "get_scope + get_scoped + mask (T3)",
        ("GET", "/api/v1/clients/{id}/visitors"): "get_scope + get_scoped gate (T3-fix)",
    },
    "visitors": {
        ("GET", "/api/v1/visitors"): "get_scope → visibility predicate (T2)",
        ("GET", "/api/v1/visitors/{id}"): "get_scope + get_scoped (T2)",
    },
    "visits": {
        ("GET", "/api/v1/visits"): "get_scope → visit→record→activity predicate (T2)",
        ("GET", "/api/v1/visits/{id}"): "get_scope + get_scoped (T2)",
    },
    "payments": {
        ("GET", "/api/v1/payments"): "get_scope → scoped stmt (T4)",
        ("GET", "/api/v1/payments/totals"): "get_scope → totals filter (T4)",
        ("GET", "/api/v1/payments/{id}"): "get_scope + get_scoped (T4)",
    },
    "photos": {
        ("GET", "/api/v1/photos"): "get_optional_scope → EXISTS-scope (T5)",
        ("GET", "/api/v1/photos/{id}"): "get_scope + get_scoped (T5)",
    },
}

#: ``(METHOD, normalized path)`` a master may reach WITHOUT scope.
#: Every entry carries a one-line justification; staleness is checked
#: against the live route table (a removed endpoint must not linger).
ALLOWED_UNSCOPED: dict[tuple[str, str], str] = {
    # ── Dictionary reads: reference data, no master-owned rows ──
    ("GET", "/api/v1/masters"): "dictionary read (acting masters, public + masters:read)",
    ("GET", "/api/v1/masters/all"): "dictionary read (masters:read)",
    ("GET", "/api/v1/locations"): "dictionary read (public + locations:read)",
    ("GET", "/api/v1/locations/{id}"): "dictionary read (public + locations:read)",
    ("GET", "/api/v1/locations/all"): "dictionary read (locations:read)",
    ("GET", "/api/v1/services"): "dictionary read (public + services:read)",
    ("GET", "/api/v1/services/{id}"): "dictionary read (public + services:read)",
    ("GET", "/api/v1/services/all"): "dictionary read (services:read)",
    ("GET", "/api/v1/tags"): "dictionary read (public + tags:read)",
    ("GET", "/api/v1/tags/{id}"): "dictionary read (public + tags:read)",
    ("GET", "/api/v1/tags/all"): "dictionary read (tags:read)",
    # ── System / transport ──
    ("GET", "/api/v1/health"): "system probe, anonymous",
    ("GET", "/api/v1/events"): "SSE transport, require_session — not entity data",
    # ── Auth surface: resolves the session itself, no scope needed ──
    ("POST", "/api/v1/auth/login"): "auth surface (anonymous by design)",
    ("POST", "/api/v1/auth/logout"): "auth surface (own session teardown)",
    ("GET", "/api/v1/auth/me"): "auth surface (returns own principal + permissions)",
    ("POST", "/api/v1/auth/change-password"): "auth surface (own password, require_session)",
    # ── Own-data endpoints: per-user rows keyed by the session user ──
    ("GET", "/api/v1/my"): "own profile (#262) — per-user, not master-scoped",
    ("PUT", "/api/v1/my"): "own profile (#262)",
    ("POST", "/api/v1/my/portrait"): "own portrait (#262)",
    ("GET", "/api/v1/user-settings"): "own settings — per-user",
    ("POST", "/api/v1/user-settings"): "own settings — per-user",
    ("PUT", "/api/v1/user-settings"): "own settings — per-user",
    ("PATCH", "/api/v1/user-settings"): "own settings — per-user",
    ("DELETE", "/api/v1/user-settings/{id}"): "own settings — per-user",
    # ── Public surfaces ──
    ("GET", "/api/v1/photos/web"): "public gallery (is_public only)",
    # ── Admin-only surfaces: master holds NO permission token for these
    #    (ROLE_PERMISSIONS has no staff/positions/materials/:write entries)
    #    → the permission gate answers 403 before scope would ever run.
    ("GET", "/api/v1/staff"): "staff:read — master has no token → 403",
    ("GET", "/api/v1/staff/{id}"): "staff:read → 403",
    ("GET", "/api/v1/staff/all"): "staff:read → 403",
    ("POST", "/api/v1/staff"): "staff:write → 403",
    ("PUT", "/api/v1/staff/{id}"): "staff:write → 403",
    ("PATCH", "/api/v1/staff/{id}"): "staff:write → 403",
    ("DELETE", "/api/v1/staff/{id}"): "staff:write → 403",
    ("POST", "/api/v1/staff/{id}/archive"): "staff:write → 403",
    ("POST", "/api/v1/staff/{id}/restore"): "staff:write → 403",
    ("GET", "/api/v1/positions"): "positions:read — master has no token → 403",
    ("GET", "/api/v1/positions/{id}"): "positions:read → 403",
    ("GET", "/api/v1/positions/all"): "positions:read → 403",
    ("POST", "/api/v1/positions"): "positions:write → 403",
    ("PUT", "/api/v1/positions/{id}"): "positions:write → 403",
    ("PATCH", "/api/v1/positions/{id}"): "positions:write → 403",
    ("DELETE", "/api/v1/positions/{id}"): "positions:write → 403",
    ("GET", "/api/v1/materials"): "materials:read — master has no token → 403",
    ("GET", "/api/v1/materials/{id}"): "materials:read → 403",
    ("GET", "/api/v1/materials/all"): "materials:read → 403",
    ("POST", "/api/v1/materials"): "materials:write → 403",
    ("PUT", "/api/v1/materials/{id}"): "materials:write → 403",
    ("PATCH", "/api/v1/materials/{id}"): "materials:write → 403",
    ("DELETE", "/api/v1/materials/{id}"): "materials:write → 403",
    ("POST", "/api/v1/materials/{id}/archive"): "materials:write → 403",
    ("POST", "/api/v1/materials/{id}/restore"): "materials:write → 403",
    # ── Audit journal (#344 §6): require_admin role gate — masters 403
    #    at the guard itself; no master-scope layer exists or is needed. ──
    ("GET", "/api/v1/audit-logs"): "admin-only journal (#344 §6) — require_admin → 403",
    ("GET", "/api/v1/audit-logs/authors"): "admin-only journal (#344 §6) — require_admin → 403",
    # ── Dictionary mutations: :write tokens master lacks → 403 ──
    # (masters.py is read-only since #266 D8 — no write routes exist there)
    ("POST", "/api/v1/locations"): "locations:write → 403",
    ("PUT", "/api/v1/locations/reorder"): "locations:write → 403",
    ("PUT", "/api/v1/locations/{id}"): "locations:write → 403",
    ("PATCH", "/api/v1/locations/{id}"): "locations:write → 403",
    ("DELETE", "/api/v1/locations/{id}"): "locations:write → 403",
    ("POST", "/api/v1/locations/{id}/archive"): "locations:write → 403",
    ("POST", "/api/v1/locations/{id}/restore"): "locations:write → 403",
    ("POST", "/api/v1/services"): "services:write → 403",
    ("PUT", "/api/v1/services/{id}"): "services:write → 403",
    ("PATCH", "/api/v1/services/{id}"): "services:write → 403",
    ("DELETE", "/api/v1/services/{id}"): "services:write → 403",
    ("POST", "/api/v1/services/{id}/archive"): "services:write → 403",
    ("POST", "/api/v1/services/{id}/restore"): "services:write → 403",
    ("POST", "/api/v1/tags"): "tags:write → 403",
    ("PUT", "/api/v1/tags/{id}"): "tags:write → 403",
    ("PATCH", "/api/v1/tags/{id}"): "tags:write → 403",
    ("DELETE", "/api/v1/tags/{id}"): "tags:write → 403",
}

#: Within a scope-wired router, routes that are not scope reads: mutations
#: gated by permission/admin/owner-checks (T2–T5 pin their behavior).
#: Keys are module names; values map (METHOD, path) → justification.
UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS: dict[str, dict[tuple[str, str], str]] = {
    "activities": {
        ("POST", "/api/v1/activities"): "activities:write — master has no token → 403",
        ("POST", "/api/v1/activities/copy-week"): "activities:write — master has no token → 403",
        ("PUT", "/api/v1/activities/{id}"): "activities:write → 403",
        ("PATCH", "/api/v1/activities/{id}"): "activities:write → 403",
        ("DELETE", "/api/v1/activities/{id}"): "activities:write → 403",
    },
    "records": {
        ("PUT", "/api/v1/records/{id}"): "records:write + scope owner gate (T2)",
        ("PATCH", "/api/v1/records/{id}"): "records:write + scope owner gate (T2)",
        ("DELETE", "/api/v1/records/{id}"): "records:write + scope owner gate (T2)",
    },
    "clients": {
        ("POST", "/api/v1/clients"): "clients:write (create allowed, D7)",
        ("PUT", "/api/v1/clients/{id}"): "clients:write + require_admin → 403",
        ("PATCH", "/api/v1/clients/{id}"): "clients:write + require_admin → 403",
        ("DELETE", "/api/v1/clients/{id}"): "clients:write + require_admin → 403",
        ("POST", "/api/v1/clients/{id}/archive"): "clients:write + require_admin → 403",
        ("POST", "/api/v1/clients/{id}/restore"): "clients:write + require_admin → 403",
    },
    "visitors": {
        ("POST", "/api/v1/visitors"): "visitors:write + scope gates (T2)",
        ("PUT", "/api/v1/visitors/{id}"): "visitors:write + scope gates (T2)",
        ("PATCH", "/api/v1/visitors/{id}"): "visitors:write + scope gates (T2)",
        ("DELETE", "/api/v1/visitors/{id}"): "visitors:write + scope gates (T2)",
    },
    "visits": {
        ("POST", "/api/v1/visits"): "visits:write + scope gates (T2)",
        ("PUT", "/api/v1/visits/{id}"): "visits:write + scope gates (T2)",
        ("PATCH", "/api/v1/visits/{id}"): "visits:write + scope gates (T2)",
        ("DELETE", "/api/v1/visits/{id}"): "visits:write + scope gates (T2)",
        ("PUT", "/api/v1/visits/{id}/status"): "visits:write + scope gates (T2)",
    },
    "payments": {
        ("POST", "/api/v1/payments"): "payments:write + scope gates (T4)",
        ("PUT", "/api/v1/payments/{id}"): "payments:write + scope gates (T4)",
        ("PATCH", "/api/v1/payments/{id}"): "payments:write + scope gates (T4)",
        ("DELETE", "/api/v1/payments/{id}"): "payments:write + scope gates (T4)",
    },
    "photos": {
        ("POST", "/api/v1/photos"): "photos:write + scope gates (T5)",
        ("PUT", "/api/v1/photos/{id}"): "photos:write + scope gates (T5)",
        ("PATCH", "/api/v1/photos/{id}"): "photos:write + scope gates (T5)",
        ("DELETE", "/api/v1/photos/{id}"): "photos:write + scope gates (T5)",
    },
}

#: Any ``{param}`` path segment → the allowlist's literal ``{id}``.
_PATH_PARAM = re.compile(r"\{[^{}]+\}")

#: Point-get endpoints a master can reach — the 404-fast-path matrix:
#: (entity, foreign-fixture key, URL builder). Populated per-entity below.
_MISSING_ID = "00000000-0000-0000-0000-000000000000"


def _normalize(path: str) -> str:
    return _PATH_PARAM.sub("{id}", path)


def _route_methods(route: Any) -> set[str]:
    """Declared methods minus HEAD (Starlette adds HEAD for GET routes)."""
    methods = set(route.methods)
    if "GET" in methods:
        methods.discard("HEAD")
    return methods


def _api_v1_routes(app: Any) -> Iterator[Any]:
    """Yield every /api/v1 path operation (same walk as test_auth_contract).

    FastAPI ≥0.141: ``_IncludedRouter.effective_candidates()`` materializes
    included routers with full prefixes and merged dependencies; the
    ``original_route`` keeps the declaring endpoint (→ its module).
    Older FastAPI: plain ``APIRoute`` objects on ``app.routes``.
    """
    for route in app.routes:
        candidates = getattr(route, "effective_candidates", None)
        if candidates is not None:
            for candidate in candidates():
                if getattr(candidate, "path", None) and candidate.path.startswith("/api/v1"):
                    yield candidate
        elif isinstance(route, APIRoute) and route.path.startswith("/api/v1"):
            yield route


def _route_module(route: Any) -> str:
    """Module name of the declaring endpoint, relative to ``src/api/v1``."""
    endpoint = getattr(route, "endpoint", None)
    module: str = getattr(endpoint, "__module__", "") if endpoint is not None else ""
    prefix = "src.api.v1."
    return module[len(prefix):] if module.startswith(prefix) else module


def _is_test_probe(route: Any) -> bool:
    """True for routes declared by TEST modules — not contract material.

    Some suites (test_auth_scope ``/api/v1/_scope_probe``, test_auth_api
    ``/api/v1/_guard_smoke``) mount probe routers onto the session-scoped
    ``app`` fixture; the mount persists for the whole session, so the full
    suite ordering leaks those routes into this contract's walk. The
    contract governs PRODUCTION routers (``src.*``): test-declared
    endpoints are outside its subject (and their own suites pin them).
    """
    endpoint = getattr(route, "endpoint", None)
    module: str = getattr(endpoint, "__module__", "") if endpoint is not None else ""
    return module.startswith("tests.")


def _route_has_scope_dependency(route: Any) -> bool:
    """True if ``get_scope``/``get_optional_scope`` is in the dep tree.

    Identity checks on the module-level callables (no fresh closures
    involved, unlike ``require_permission``). Walks decorator/router-level
    ``dependencies`` AND the signature dependant recursively — the scope
    param may sit anywhere in the tree.
    """
    from src.auth.scope import get_optional_scope, get_scope

    wanted = (get_scope, get_optional_scope)
    for dep in route.dependencies:
        call = getattr(dep, "dependency", None) or getattr(dep, "call", None)
        if call is not None and any(call is w for w in wanted):
            return True
    stack: list[Any] = [getattr(route, "dependant", None)]
    while stack:
        dependant = stack.pop()
        if dependant is None:
            continue
        if any(dependant.call is w for w in wanted):
            return True
        stack.extend(getattr(dependant, "dependencies", []) or [])
    return False


class TestMasterScopeCoverageContract:
    """Every /api/v1 route: scope-wired router (with explicit mutation
    decisions) or the unscoped allowlist — nothing undocumented."""

    @pytest.fixture(scope="module")
    def contract_app(self) -> Iterator[Any]:
        """FRESH ``create_app()`` — the contract walks its OWN app instance.

        The session-scoped ``app`` fixture (conftest) is MUTATED by other
        suites: ``test_auth_scope`` / ``test_auth_api`` mount probe routers
        (``/api/v1/_scope_probe``, ``/api/v1/_guard_smoke``) that persist
        for the whole session, so full-suite ordering leaks them into any
        walk of the shared app. A fresh instance makes the contract immune
        to session-order pollution; production routers are byte-identical
        (same ``create_app()`` — cf. ``test_main.py``). One boot per module
        (~0.5s), not per test. ``_is_test_probe`` stays as a second line of
        defense.
        """
        from src.main import create_app

        yield create_app()

    def test_scope_wired_routers_exist_as_modules(self, contract_app) -> None:
        """The contract names real router modules (guards renames)."""
        from src.api import v1 as v1_package

        for name in SCOPE_WIRED_ROUTERS:
            assert hasattr(v1_package, name), (
                f"SCOPE_WIRED_ROUTERS entry '{name}' is not a src.api.v1 module"
            )
        for name in SCOPE_WIRED_ROUTES:
            assert hasattr(v1_package, name), (
                f"SCOPE_WIRED_ROUTES entry '{name}' is not a src.api.v1 module"
            )

    def test_every_api_v1_route_is_scope_wired_or_allowlisted(
        self, contract_app,
    ) -> None:
        """A new route without a scope decision fails with an actionable message."""
        violations: list[str] = []
        for route in _api_v1_routes(contract_app):
            if _is_test_probe(route):
                continue
            module = _route_module(route)
            for method in sorted(_route_methods(route)):
                key = (method, _normalize(route.path))
                if key in ALLOWED_UNSCOPED:
                    continue
                wired = SCOPE_WIRED_ROUTES.get(module, {})
                if key in wired:
                    continue
                if module in SCOPE_WIRED_ROUTERS and key in (
                    UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS.get(module, {})
                ):
                    continue
                if module in SCOPE_WIRED_ROUTERS:
                    violations.append(
                        f"{method} {route.path} (src/api/v1/{module}.py — scope-wired "
                        "router: route is neither in SCOPE_WIRED_ROUTES (add + wire "
                        "get_scope/get_optional_scope + a T2–T5 style test) nor in "
                        "UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS (mutations))"
                    )
                else:
                    violations.append(
                        f"{method} {route.path} (src/api/v1/{module or '?'}.py — not in "
                        "SCOPE_WIRED_ROUTERS: wire the scope layer or add an "
                        "ALLOWED_UNSCOPED entry with a justification)"
                    )
        assert not violations, (
            "Routes without a master-scope decision (GH #263 contract): "
            f"{violations}"
        )

    def test_allowlists_have_no_stale_entries(self, contract_app) -> None:
        """Every allowlist entry must match a real route (all three maps)."""
        real = {
            (method, _normalize(route.path))
            for route in _api_v1_routes(contract_app)
            if not _is_test_probe(route)
            for method in _route_methods(route)
        }
        stale: list[tuple[str, str]] = []
        for entry in ALLOWED_UNSCOPED:
            if entry not in real:
                stale.append(entry)
        for per_module in UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS.values():
            for entry in per_module:
                if entry not in real:
                    stale.append(entry)
        for per_module in SCOPE_WIRED_ROUTES.values():
            for entry in per_module:
                if entry not in real:
                    stale.append(entry)
        assert not stale, (
            f"Stale scope-contract allowlist entries (no matching route): {stale}"
        )

    def test_scope_wired_router_routes_are_fully_classified(self, contract_app) -> None:
        """Reverse staleness for SCOPE_WIRED_ROUTES: every route of a wired
        router must be pinned there (or in the within-router mutation map)
        — a DEMOTED read (scope wiring removed from the endpoint) fails
        here even though it still exists."""
        for route in _api_v1_routes(contract_app):
            if _is_test_probe(route):
                continue
            module = _route_module(route)
            if module not in SCOPE_WIRED_ROUTERS:
                continue
            for method in sorted(_route_methods(route)):
                key = (method, _normalize(route.path))
                assert (
                    key in SCOPE_WIRED_ROUTES.get(module, {})
                    or key in UNSCOPED_ALLOWED_WITHIN_WIRED_ROUTERS.get(module, {})
                    or key in ALLOWED_UNSCOPED
                ), (
                    f"{method} {route.path} (src/api/v1/{module}.py) is not pinned "
                    "in SCOPE_WIRED_ROUTES — scope wiring lost or route added "
                    "without a scope decision (GH #263)"
                )

    def test_scope_wired_routes_carry_real_scope_dependency(self, contract_app) -> None:
        """The pin must reflect REALITY: every route in SCOPE_WIRED_ROUTES
        actually carries ``get_scope``/``get_optional_scope`` in its
        dependency tree. Catches a demoted endpoint that kept its
        contract entry (mutated endpoint verified: pin without wiring →
        this test fails)."""
        demoted: list[str] = []
        for route in _api_v1_routes(contract_app):
            if _is_test_probe(route):
                continue
            module = _route_module(route)
            for method in sorted(_route_methods(route)):
                key = (method, _normalize(route.path))
                if key in SCOPE_WIRED_ROUTES.get(module, {}) and not (
                    _route_has_scope_dependency(route)
                ):
                    demoted.append(f"{method} {route.path}")
        assert not demoted, (
            "SCOPE_WIRED_ROUTES pins a route without actual scope wiring "
            f"(get_scope/get_optional_scope missing): {demoted}"
        )

    def test_allowlisted_unscoped_entries_are_justified(self) -> None:
        """No empty justifications in either allowlist."""
        unjustified = [
            entry for entry, why in ALLOWED_UNSCOPED.items() if not why.strip()
        ]
        assert not unjustified, f"ALLOWED_UNSCOPED entries without justification: {unjustified}"

    def test_api_v1_surface_is_nonempty(self, contract_app) -> None:
        """Sanity: the walk sees routes (guards against app changes)."""
        assert sum(1 for _ in _api_v1_routes(contract_app)) > 10


class Test404FastPath:
    """«Чужое ≈ не существует»: foreign id and missing id return the SAME
    404 — no 403, no 200 leak — on every master-readable point-get."""

    @pytest.mark.parametrize(
        ("url_foreign", "url_missing"),
        [
            ("/api/v1/activities/{foreign}", f"/api/v1/activities/{_MISSING_ID}"),
            ("/api/v1/records/{foreign}", f"/api/v1/records/{_MISSING_ID}"),
            ("/api/v1/clients/{foreign}", f"/api/v1/clients/{_MISSING_ID}"),
            ("/api/v1/visits/{foreign}", f"/api/v1/visits/{_MISSING_ID}"),
            ("/api/v1/visitors/{foreign}", f"/api/v1/visitors/{_MISSING_ID}"),
            ("/api/v1/payments/{foreign}", f"/api/v1/payments/{_MISSING_ID}"),
            ("/api/v1/photos/{foreign}", f"/api/v1/photos/{_MISSING_ID}"),
        ],
        ids=["activities", "records", "clients", "visits", "visitors", "payments", "photos"],
    )
    def test_foreign_equals_missing(
        self,
        api_client,
        create_service,
        create_location,
        make_master,
        url_foreign: str,
        url_missing: str,
    ) -> None:
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user(
            f"+7999{_uuid_hex()}", hash_password("x")
        )["staff_id"]

        # Build ONE foreign row per entity via the admin API (admin is
        # unscoped): an activity for a foreign master — the minimal
        # foreign object for every entity family (records/visits/
        # visitors/payments/photos all hang off the activity, clients
        # off the record).
        act = api_client.post("/api/v1/activities", json={
            "master_id": foreign_staff,
            "service_id": svc["id"], "location_id": loc["id"],
            "start": _tomorrow(), "duration": 90, "capacity": 10,
            "is_private": False,
        })
        assert act.status_code == 201, act.text
        act = act.json()
        client = api_client.post("/api/v1/clients", json={
            "name": "Чужой fast-path",
            "phone": f"+7999{_uuid_hex()}",
            "channel": "telegram",
        }).json()
        rec = api_client.post("/api/v1/records", json={
            "activity_id": act["id"],
            "client_id": client["id"],
            "visits": [{"name": "Гость", "price": 100, "status": "waiting"}],
        }).json()
        url_foreign = url_foreign.format(
            foreign=_foreign_id_for(url_foreign, act, rec, client, api_client)
        )

        mc = master["client"]
        foreign_resp = mc.get(url_foreign)
        missing_resp = mc.get(url_missing)
        assert foreign_resp.status_code == missing_resp.status_code == 404, (
            f"404-fast-path violated for {url_foreign}: foreign="
            f"{foreign_resp.status_code} ({foreign_resp.text[:200]}), missing="
            f"{missing_resp.status_code} ({missing_resp.text[:200]})"
        )


def _uuid_hex() -> str:
    import uuid as _uuid

    return _uuid.uuid4().hex[:7]


def _tomorrow() -> str:
    from datetime import UTC, datetime, timedelta

    return (datetime.now(UTC) + timedelta(days=1)).isoformat()


def _foreign_id_for(
    url: str,
    act: dict[str, Any],
    rec: dict[str, Any],
    client: dict[str, Any],
    api_client: Any,
) -> str:
    """Pick the foreign id matching the entity of the parametrized URL."""
    foreign_id: str
    if "/activities/" in url:
        foreign_id = act["id"]
    elif "/records/" in url:
        foreign_id = rec["id"]
    elif "/clients/" in url:
        foreign_id = client["id"]
    elif "/visits/" in url or "/visitors/" in url:
        visits = api_client.get(
            "/api/v1/visits", params={"record_id": rec["id"]}
        ).json()["items"]
        assert visits, "foreign record must carry a visit for the fast-path probe"
        if "/visits/" in url:
            foreign_id = visits[0]["id"]
        else:
            visitors = api_client.get(
                f"/api/v1/clients/{client['id']}/visitors"
            ).json()
            assert visitors, "foreign client must carry a visitor for the fast-path probe"
            foreign_id = visitors[0]["id"]
    elif "/payments/" in url:
        pay = api_client.post("/api/v1/payments", json={
            "record_id": rec["id"], "amount": 100, "method": "card",
        })
        assert pay.status_code == 201, pay.text
        foreign_id = pay.json()["id"]
    elif "/photos/" in url:
        photo = api_client.post("/api/v1/photos", json={
            "filename": f"fast-path-{_uuid_hex()}.jpg",
            "activity_id": act["id"],
        })
        assert photo.status_code == 201, photo.text
        foreign_id = photo.json()["id"]
    else:
        raise AssertionError(f"Unhandled fast-path URL: {url}")
    return str(foreign_id)
