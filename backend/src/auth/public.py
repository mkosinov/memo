"""PUBLIC_ROUTES — the whole anonymous allowlist — GH #247 §2.7.

The API is default-deny (spec §2.6): a contract test (T7) walks ``app.routes``
and requires every ``/api/v1`` route to either carry an auth dependency or
match an entry here; stale entries fail the same test.

Path convention: the param segment is normalized to ``{id}`` — actual routers
use entity-specific names (``{master_id}``, ``{photo_id}``, …), so the
contract test normalizes route path params before comparing.

Exactly this list, no more, no less:
- ``GET`` dictionaries: masters, locations, services, tags, activities;
- ``GET /api/v1/public/photos`` — ``photos`` is NOT anonymous: bare
  photo GETs are staff-only (``photos:read``); the showcase lives at
  ``GET /api/v1/public/photos`` (ADR-015 audience namespace);
- ``GET /api/v1/health``;
- the auth endpoints themselves (login / logout / me) + the public
  password-setup pair (#348 spec §5/§7: the authority of
  ``password-setup`` is the one-time token itself — validate probes a
  link, setup consumes it; both feed the shared per-IP failure counter
  on invalid tokens).

NOT here: ``GET /api/v1/events`` (SSE, GH #239) — it gets a session guard
in T7; user-settings — own-only since #247; and ``POST /api/v1/records``
— the anonymous full-contract booking is CLOSED (GH #479 Изменение 5:
``records:write`` guard; guest booking itself is #499).

Spec: docs/specs/2026-09-08-auth-design.md §2.7, §3.7
Domain rules: docs/domain-rules/auth.md (Public Access)
"""

from __future__ import annotations

PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/health"),
        # GH #266 D8: the masters view is read-only acting masters — the public
        # paginated list stays (schedule + client site #48); GET /{id} was
        # REMOVED with the mutations, so its allowlist entry is gone too.
        # ``GET /masters/all`` carries the masters:read guard (NOT public).
        ("GET", "/api/v1/masters"),
        ("GET", "/api/v1/locations"),
        ("GET", "/api/v1/locations/{id}"),
        ("GET", "/api/v1/services"),
        ("GET", "/api/v1/services/{id}"),
        ("GET", "/api/v1/tags"),
        ("GET", "/api/v1/tags/{id}"),
        ("GET", "/api/v1/activities"),
        ("GET", "/api/v1/activities/{id}"),
        # ADR-015: anonymous showcase namespace. The prefix exposes nothing —
        # entries here ARE the exposure (default-deny walk).
        ("GET", "/api/v1/public/photos"),
        # GH #600: the anonymous schedule list — minimal audience schema,
        # private rows excluded server-side (is_private IS NOT TRUE).
        # The two OLD bare activity entries above stay until Task 2 of
        # the #600 plan flips the shared routes to activities:read.
        ("GET", "/api/v1/public/activities"),
        # GH #493: bare ("GET", "/api/v1/photos") and ("GET",
        # "/api/v1/photos/{id}") were removed from here — both routes carry
        # the photos:read guard now; the anonymous showcase is the
        # /public/photos entry above (ADR-015).
        # GH #479 (Изменение 5): ("POST", "/api/v1/records") was removed —
        # the full contract now carries the records:write guard; guest
        # booking is a separate contract (#499).
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/logout"),
        ("GET", "/api/v1/auth/me"),
        # GH #348 (spec §5/§7): the public password-setup pair — the
        # authority is the one-time token itself (256-bit). Invalid-token
        # attempts feed the shared §3.4 per-IP failure counter.
        ("POST", "/api/v1/auth/password-setup/validate"),
        ("POST", "/api/v1/auth/password-setup"),
        # GH #499 (spec §4.2): the client OTP pair — exact (method, path)
        # pairs, no wildcard; the authority is the code itself (rate-limited
        # + one-time). verify issues the CLIENT session cookie; both carry
        # their own Origin-vs-CORS line (verify_origin).
        ("POST", "/api/v1/auth/otp/request"),
        ("POST", "/api/v1/auth/otp/verify"),
        # GH #593 (spec §Реестр): the client-auth method registry — a
        # read-only availability list for the login picker; resolvers (not
        # env vars) decide the flags, so the route leaks no configuration.
        ("GET", "/api/v1/auth/methods"),
        # GH #593 (spec §Эндпоинты): the callcheck pair — the authority is
        # the check itself (rate-limited initiate, one-time handle; the
        # status poll never discloses which checks exist — 404 is the one
        # answer for invalid/replaced/consumed handles). Both carry their
        # own Origin-vs-CORS line (verify_origin), like the OTP pair.
        # dev-done is the dev imitation, resolver-gated per request: it
        # answers 404 unless the DEV transport is resolved (the double
        # gate of dev_code) — registered + allowlisted so the contract
        # walk stays exact in every configuration.
        ("POST", "/api/v1/auth/call/initiate"),
        ("POST", "/api/v1/auth/call/status"),
        ("POST", "/api/v1/auth/call/dev-done"),
    }
)
