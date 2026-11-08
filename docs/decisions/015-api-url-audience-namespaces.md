# ADR 015: API URL conventions — audience namespaces (`/public/*`, `/my`, `/my/{role}`)

## Status

Accepted

**Date:** 2026-11-08

Decided at Gate B of #493 (user decision, 2026-11-08). First implementation lands in #493 (`GET /api/v1/public/photos`); everything else is a staged migration owned by a follow-up wave issue (spec #493, §5 + appendix).

## Context

The API surface grew organically and mixes audiences on bare paths:

- Anonymous surfaces ride bare entity paths: the photo gallery list (`GET /api/v1/photos` with `?is_public=true`) and the dictionary GETs (masters, locations, services, tags, activities) are all in `PUBLIC_ROUTES` — an anonymous caller of the dictionary GETs receives the **full admin contract** (masters carry staff personal data).
- The client cabinet and staff self share `/my/*`: client data (`/my/records`, `/my/photos`, `/my/payments`, `/my/client`) lives next to staff profile (`GET/PUT /my`, `POST /my/portrait`) with different guards.
- Staff whoami is `/auth/me`; per-user settings live at `/user-settings`.

No convention declares which prefix serves which audience. Enforcement, in contrast, is already strict: the API is default-deny — every `/api/v1` route has an auth dependency or an explicit `PUBLIC_ROUTES` allowlist entry (contract walk + exact-allowlist pin tests).

## Decision

URL prefixes name the **audience** of a route:

| Prefix | Audience | Guard |
|---|---|---|
| `/api/v1/{entity}` | staff CRM (admin app) — stays where it is today, zero admin migration | staff session `memo_session` + permission matrix (`photos:read`, …) |
| `/api/v1/public/{entity}` | anonymous showcase | no session; **always** a conscious explicit `PUBLIC_ROUTES` entry (see clause 1) |
| `/api/v1/my` | universal "who am I" — ANY authenticated session | **new combined guard** resolving either `memo_session` or `memo_client_session` (does not exist yet — follow-up wave) |
| `/api/v1/my/{role}` — `client` / `master` / `admin` (exactly the `UserRole` enum, `backend/src/models/enums.py`) | role-specific self-surface | respective session (+role) guard: `require_client_session` for `/my/client/*`, staff session with role check for `/my/master/*` and `/my/admin/*` |

### Clause 1 — default namespace, conscious exposure (both sides)

When designing a new endpoint and the audience is unclear, the **default namespace is `/api/v1/public/{entity}`**. However, the prefix alone exposes nothing: making any route actually anonymous is always a **conscious step** — an explicit entry in the `PUBLIC_ROUTES` allowlist (`backend/src/auth/public.py`), enforced by the default-deny contract walk and the exact-allowlist pin tests. The prefix is the naming convention; the allowlist is the enforcement. A route under `/public/*` without an allowlist entry is denied exactly like any other route.

### Clause 2 — per-audience schemas

A `/public/*` route never returns the staff contract: each public route gets a minimal per-audience schema (extends the `MyPhotoItem` precedent — `schemas/my.py`, "deliberately NOT PhotoResponse"). Bare `/api/v1/{entity}` paths belong to the staff CRM and keep the full contract.

### Clause 3 — the `/my` amendment

User's wording: «/my возвращал какие-то стандартные для всех данные, а /my/client и /my/master и /my/admin возвращал данные для меня как для клиента/мастера/админа».

- `/my` — universal whoami, one standard schema for every session: `{id, role, name, phone}`. Requires the new combined guard (either cookie, strict role read from the resolved principal; no permission implication).
- `/my/client` — client self-surface. The flat cabinet paths migrate under the branch: `GET/POST /my/client/records`, `GET /my/client/photos`, `GET /my/client/payments` (today's flat `/my/records|photos|payments`), plus `GET /my/client` itself.
- `/my/master`, `/my/admin` — staff self-surface. Admin and master share the profile shape, so **one staff-profile router (GET/PUT profile, POST portrait) is mounted under both branches** — same handlers, same schema, no fork. The rich payload of today's `/auth/me` (permissions list; master snapshot) lives here: permissions in both branches, the master snapshot only in `/my/master`.
- `/my/settings` — today's `/user-settings` moves here (staff own-only semantics unchanged; `user_id`-addressed access stays removed).
- `/auth/me` — consolidated into universal `/my`. It remains during the transition (the admin SPA still calls it), is deprecated in the follow-up wave, and is removed after the admin SPA migrates. Note: its current `PUBLIC_ROUTES` entry is a mechanical artifact — the route guard produces the real 401.

### Clause 4 — staged migration

- **Now (#493):** `GET /api/v1/public/photos` — the first resident of the namespace (minimal schema, forced `is_public`); bare `GET /photos` + `GET /photos/{id}` close to anonymous via the `photos:read` guard. No other route moves.
- **Follow-up wave (separate issue, drafted in spec #493 appendix):** dictionaries — minimal `/public/*` variants (masters/services/locations/activities/tags), guards on the bare GETs, allowlist entries removed (this closes the "anonymous receives full admin dictionary contracts" class); web booking-form migration (`useSchedule.ts`); the `/my` restructure of clause 3 (combined guard, role branches, client cabinet paths); `/user-settings` → `/my/settings`; `/auth/me` deprecation.
- **Never:** the staff CRM `{entity}` paths do not move — zero admin-app migration is a property of this ADR, not a phase.

## Rejected alternatives

- **One URL, response form depends on authentication** — violates the per-audience schema principle (`MyPhotoItem` precedent) and the typed api-client as the single source of truth: a schema that changes per caller cannot be typed honestly.
- **Strip service fields from shared schemas** — breaks admin rendering and tests that consume the full contract (photos: `photoColumns.tsx`; dictionaries likewise).
- **Move the staff CRM under `/admin/*`** — a mass URL migration of a working surface for zero behavioral gain; rejected at Gate B #493.

## Consequences

### Positive
- The URL alone tells the audience; public surface is enumerable in one allowlist and reviewed as a set.
- Admin contracts can no longer leak to anonymous callers by accident — a public route requires both a conscious allowlist entry and a minimal schema.
- A ready home (`/public/*`) for future showcase endpoints; the dictionary wave gets a pattern to copy (#493's photos route).

### Negative
- URL churn in the follow-up wave (client cabinet, settings, `/auth/me` consumers) — time-boxed by the wave issue.
- The staff profile is reachable at two paths (`/my/master`, `/my/admin`) — a deliberate consequence of the user's three-branch model; same handler, no schema fork.

### Risks
- Transitional period where old and new paths coexist (wave-scoped, not open-ended).
- The combined guard must not blur role checks: `/my` is whoami only; every role branch still verifies the role strictly — a client cookie must never satisfy `/my/master/*` and vice versa.

## References

- Spec: `docs/specs/2026-11-08-photo-public-contract-design.md` (#493, §5 + appendix — the follow-up wave)
- Gates that shaped scope: #479 (2026-10-20), #499 (2026-10-21)
- Enforcement: `PUBLIC_ROUTES` in `backend/src/auth/public.py`; domain rules `docs/domain-rules/auth.md` (Public Access)
- Precedent: `MyPhotoItem` (`backend/src/schemas/my.py`)
