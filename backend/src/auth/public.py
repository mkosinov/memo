"""PUBLIC_ROUTES — the whole anonymous allowlist — GH #247 §2.7.

The API is default-deny (spec §2.6): a contract test (T7) walks ``app.routes``
and requires every ``/api/v1`` route to either carry an auth dependency or
match an entry here; stale entries fail the same test.

Path convention: the param segment is normalized to ``{id}`` — actual routers
use entity-specific names (``{master_id}``, ``{photo_id}``, …), so the
contract test normalizes route path params before comparing.

Exactly this list, no more, no less:
- ``GET`` dictionaries: masters, locations, services, tags, activities,
  photos (public site + gallery; the public gallery surface is
  ``GET /api/v1/photos/web`` — ``frontend/web`` ``useGallery``);
- ``POST /api/v1/records`` — anonymous booking until #8;
- ``GET /api/v1/health``;
- the auth endpoints themselves (login / logout / me).

NOT here: ``GET /api/v1/events`` (SSE, GH #239) — it gets a session guard
in T7; and user-settings — own-only since #247.

Spec: docs/specs/2026-09-08-auth-design.md §2.7, §3.7
Domain rules: docs/domain-rules/auth.md (Public Access)
"""

from __future__ import annotations

PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset({
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/masters"),
    ("GET", "/api/v1/masters/{id}"),
    ("GET", "/api/v1/locations"),
    ("GET", "/api/v1/locations/{id}"),
    ("GET", "/api/v1/services"),
    ("GET", "/api/v1/services/{id}"),
    ("GET", "/api/v1/tags"),
    ("GET", "/api/v1/tags/{id}"),
    ("GET", "/api/v1/activities"),
    ("GET", "/api/v1/activities/{id}"),
    ("GET", "/api/v1/photos"),
    ("GET", "/api/v1/photos/{id}"),
    ("GET", "/api/v1/photos/web"),
    ("POST", "/api/v1/records"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/logout"),
    ("GET", "/api/v1/auth/me"),
})
