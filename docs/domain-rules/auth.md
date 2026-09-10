# Auth — Domain Rules

## Description
Staff authentication for the API and the admin app. Users (roles `admin` / `master`) log in by **phone + password**; the server keeps sessions in the DB and identifies the caller by an opaque `HttpOnly` cookie. Permissions are derived from the role by a code-defined matrix — no DB tables for roles.

## Roles & Permissions
Two roles exist (`UserRole`, `backend/src/models/enums.py`): `admin`, `master`.

| Entity | admin | master |
|---|---|---|
| records, visits, visitors | full | full |
| masters, locations, services, tags, activities, photos | full | read-only |
| clients | full | read-only |
| payments | full | read-only (мастер видит, что оплачено) |
| materials | full | no access |
| user-settings | own only | own only |

- Permissions are `<entity>:read` / `<entity>:write`; `admin` holds the single literal `*`. The matcher is `"*" in perms or perm in perms` — no other wildcards.
- The table above is a **summary**; the canonical token list is `ROLE_PERMISSIONS` in `backend/src/auth/permissions.py`.
- Adding a role or permission = editing that one file.

## Public Access (no session)
The API is default-deny; only this allowlist works anonymously (constant `PUBLIC_ROUTES`, `backend/src/auth/public.py`):
- `GET` dictionaries: masters, locations, services, tags, activities, photos (public site + gallery)
- `POST /api/v1/records` — anonymous booking, **until #8** adds client phone verification
- `GET /api/v1/health`
- `/api/v1/auth/*` (login / logout / me)

A contract test enforces: every `/api/v1` route has an auth dependency or is allowlisted.

## CSRF Posture
Two independent lines: (1) JSON-only API + CORS with credentials restricted to listed origins (a foreign page cannot send a JSON mutation past the preflight); (2) `Sec-Fetch-Site: cross-site` is rejected on **authenticated mutating endpoints** (missing header passes). Anonymous routes are exempt — CSRF targets sessions.

## Password Rules
- 8–64 characters after trimming edge whitespace; no control characters.
- **No** composition requirements (digits/cases/symbols not enforced) — length over composition (NIST 800-63B; the floor of 8 is a recorded MVP deviation from NIST's 15-for-single-factor).
- Hashing: Argon2id via pwdlib with pinned parameters (`time_cost=3, memory_cost=65536, parallelism=4`, above the OWASP floor); salt is random per password and embedded in the hash string (no separate salt storage).
- The same human-readable hint is shown at every password-creation site (sqladmin form, CLI); the login page shows none.
- No default/committed passwords in production paths; dev seed uses obviously-fake demo passwords (`ENV != production` guard; staging must not run a dev ENV).

### Change password (#262)
- `POST /api/v1/auth/change-password` `{current_password, new_password}` — session required; `current_password` verified first (wrong → 401 `AUTH_INVALID_CREDENTIALS`, timing parity as in login); the new password follows the rules above (422 `PASSWORD_POLICY`).
- On success (204): the **current session stays**, **all other sessions of the user are deleted** (other devices must re-login).
- Does not feed the login lockout ladder (an authenticated user changing their own password; the ladder guards anonymous login brute-force).

## Sessions
- Server-side row `sessions(token, user_id, created_at, last_extended_at, idle_deadline, absolute_deadline)`; cookie `memo_session` carries only the random token: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`.
- Lifetime: **sliding** — idle window 7 days (any authenticated request extends it; written at most once per hour) + **absolute cap 30 days** from creation, then a fresh login. Cookie Max-Age = the cap; the row governs validity.
- Login rotates: any session presented in the login request is deleted before the new one is created.
- Logout deletes the row → instant revocation. Admin force-logout = delete `sessions` rows via sqladmin or archive the user.
- Multiple sessions per user allowed; archived (soft-deleted) users cannot log in and are not resolved.
- Unknown phone and wrong password give the same error and the same timing profile (dummy-hash verify when the user is missing — no user enumeration).
- Login throttle — escalation ladder per phone (user decision): **3 failures → 15-min lock; after expiry 3 more → 1-hour lock; 3 more → hard lock until an administrator resets it** (sqladmin: clear `failed_login_attempts` / `lock_level` / `locked_until` on the user). Ladder state lives on the `users` row (survives restarts). Locked accounts get 429 even with the correct password; a successful login resets the ladder (the hard lock only the admin). Secondary: per-IP 20 failures / 15 min (in-memory, anti-spray across accounts).

## User lifecycle
- First admin: CLI `python -m src.cli create-user` (no default passwords in the public repo). Production bootstrap: deploy → migrate → CLI → login.
- Further staff: created in sqladmin (admin-only login; password field hashes on save, blank on edit = unchanged). The lockout reset also lives there: clear the lock fields on the user.
- Dev seed: demo admin + demo master, dev-only.
- `SECRET_KEY` (env): signs the sqladmin session cookie; production fails fast when unset, dev defaults to a fixed dev constant.

## Error Codes
`AUTH_UNAUTHORIZED` (401), `AUTH_INVALID_CREDENTIALS` (401), `AUTH_LOCKED_OUT` (429), `AUTH_FORBIDDEN` (403, incl. non-owned user-settings rows), `PASSWORD_POLICY` (422).

## API Endpoints
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | /api/v1/auth/login | public | phone + password → user + permissions + Set-Cookie |
| POST | /api/v1/auth/logout | public | deletes session, clears cookie |
| GET | /api/v1/auth/me | public (401 when no session) | current user + permissions |

## Relationships
- User → optional 1:1 Master (`master_id` FK).
- Session → belongs to User (hard-deleted rows).
- UserSettings → addressed by the **session** user only: the `user_id` query parameter is removed (own-only since #247, breaking change).
