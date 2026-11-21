"""PUBLIC_ROUTES — the whole anonymous allowlist — GH #247 §2.7.

The API is default-deny (spec §2.6): a contract test (T7) walks ``app.routes``
and requires every ``/api/v1`` route to either carry an auth dependency or
match an entry here; stale entries fail the same test.

Path convention: the param segment is normalized to ``{id}`` — actual routers
use entity-specific names (``{master_id}``, ``{photo_id}``, …), so the
contract test normalizes route path params before comparing.

Exactly this list, no more, no less:
- NO bare dictionary GET is anonymous anymore: the last one — tags —
  left with #606 Task 3.2 (staff-only, tags:read; no showcase of its
  own — the public services showcase below carries tag titles as
  sorted strings), like bare masters/services GETs with #606
  (masters:read / services:read), bare location GETs with #601
  (locations:read), bare activity GETs before them (#600), and bare
  photo GETs (#493); each of those keeps its anonymous showcase in
  the ``/public`` namespace below (tags — via the services one);
- ``GET /api/v1/public/photos`` — ``photos`` is NOT anonymous: bare
  photo GETs are staff-only (``photos:read``); the showcase lives at
  ``GET /api/v1/public/photos`` (ADR-015 audience namespace);
- ``GET /api/v1/public/activities`` — the anonymous schedule list
  (#600): bare activity GETs are staff-only (``activities:read``),
  private rows are excluded server-side;
- ``GET /api/v1/public/locations`` — the anonymous location dictionary
  (#601): bare location GETs are staff-only (``locations:read``),
  archived and non-public rows are excluded server-side;
- ``GET /api/v1/public/masters`` — the anonymous masters dictionary
  (#606): only acting masters (``masters.is_active``), minimal 5-field
  showcase schema — the former anonymous bare ``GET /masters`` entry
  left this list with the #606 Task 3 cleanup (masters:read guard);
- ``GET /api/v1/public/services`` — the anonymous services dictionary
  (#606): only active AND ``is_public`` services (the #601 visibility
  mirror), minimal 10-field showcase schema with nested tariffs /
  materials and tags as sorted title strings — the former anonymous
  bare ``GET /services`` entries left with the same cleanup
  (services:read guard);
- ``GET /api/v1/health``;
- the auth endpoints themselves (login / logout) + the public
  password-setup pair (#348 spec §5/§7: the authority of
  ``password-setup`` is the one-time token itself — validate probes a
  link, setup consumes it; both feed the shared per-IP failure counter
  on invalid tokens). The former ``GET /api/v1/auth/me`` entry is GONE
  (#584 ADR-015, spec §4.5): the route was removed — «кто я» is the
  session-guarded ``GET /api/v1/my`` whoami.

NOT here: ``GET /api/v1/events`` (SSE, GH #239) — it gets a session guard
in T7; the settings branches (``/my/{master,admin,client}/settings``, #584;
former user-settings) — own-only since #247; and ``POST /api/v1/records``
— the anonymous full-contract booking is CLOSED (GH #479 Изменение 5:
``records:write`` guard; guest booking itself is #499).

Spec: docs/specs/2026-09-08-auth-design.md §2.7, §3.7
Domain rules: docs/domain-rules/auth.md (Public Access)
"""

from __future__ import annotations

PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/health"),
        # GH #606 Task 3 (#601 / #600 / #493 precedents): bare
        # ("GET", "/api/v1/masters"), ("GET", "/api/v1/services") and
        # ("GET", "/api/v1/services/{id}") were removed from here — all
        # three routes carry the masters:read / services:read guards
        # now; the anonymous dictionaries are the /public/masters and
        # /public/services entries below (ADR-015).
        # GH #601: bare ("GET", "/api/v1/locations") and ("GET",
        # "/api/v1/locations/{id}") were removed from here — both routes
        # carry the locations:read guard now; the anonymous dictionary
        # is the /public/locations entry below (ADR-015).
        # GH #606 Task 3.2: bare ("GET", "/api/v1/tags") and ("GET",
        # "/api/v1/tags/{id}") were removed from here — both routes
        # carry the tags:read guard now; tags have NO showcase of
        # their own (the anonymous services showcase below carries
        # tag titles as sorted title strings, spec §3.3).
        # GH #600: bare ("GET", "/api/v1/activities") and ("GET",
        # "/api/v1/activities/{id}") were removed from here — both routes
        # carry the activities:read guard now; the anonymous schedule is
        # the /public/activities entry below (ADR-015).
        # ADR-015: anonymous showcase namespace. The prefix exposes nothing —
        # entries here ARE the exposure (default-deny walk).
        ("GET", "/api/v1/public/photos"),
        # GH #600: the anonymous schedule list — minimal audience schema,
        # private rows excluded server-side (is_private IS NOT TRUE).
        ("GET", "/api/v1/public/activities"),
        # GH #601: the anonymous location dictionary — minimal 4-field
        # audience schema, archived and non-public (is_public = false)
        # rows excluded server-side.
        ("GET", "/api/v1/public/locations"),
        # GH #606: the anonymous masters dictionary — minimal 5-field
        # audience schema, only acting masters (masters.is_active, the
        # staff-list filter; masters have no is_public flag).
        ("GET", "/api/v1/public/masters"),
        # GH #606: the anonymous services dictionary — minimal 10-field
        # audience schema (nested tariffs/materials, tags as sorted
        # title strings), only active AND is_public services (the #601
        # visibility mirror); the former bare GET /services entries
        # left this list with the #606 Task 3 cleanup (services:read
        # guard).
        ("GET", "/api/v1/public/services"),
        # GH #493: bare ("GET", "/api/v1/photos") and ("GET",
        # "/api/v1/photos/{id}") were removed from here — both routes carry
        # the photos:read guard now; the anonymous showcase is the
        # /public/photos entry above (ADR-015).
        # GH #479 (Изменение 5): ("POST", "/api/v1/records") was removed —
        # the full contract now carries the records:write guard; guest
        # booking is a separate contract (#499).
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/logout"),
        # ADR-015 (#584, spec §4.5): ("GET", "/api/v1/auth/me") was removed
        # here together with the route itself — the session probe is the
        # guarded whoami ``GET /api/v1/my`` now.
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
