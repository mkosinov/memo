# GH #247 — Full API & admin app authentication (sessions, roles, guards, login front)

- **Issue:** #247 `auth: полная авторизация API и admin-приложения — сейчас API полностью открыт (токены/сессии, гарды на роутах, логин-фронт)`
- **Status:** DESIGN phase, G1a passed 2026-09-08; G1b revision 1 (5-reviewer panel + user decisions) same day
- **Scope:** `backend/src/auth/` (new package: hashing, sessions, permissions, auth router) + all `backend/src/api/v1/*` routers (guards) + `backend/src/admin/` (sqladmin login) + one alembic migration (`sessions` table) + `backend/src/errors.py` (new codes) + `backend/pyproject.toml` (pwdlib) + `packages/api-client` (credentials, 401 hook, auth endpoints, user-settings signature) + `frontend/admin` (login page, AuthContext, guards, permission-aware UI) + backend seed (demo staff) + backend test fixtures + admin e2e infra (storageState). **No changes** to `frontend/web` behavior.
- **Grounding:** host scout recon 2026-09-08 (backend + frontend zones) + live-tree spot checks (models, routers, user-settings API, conftest, e2e factories, api-client) + 5-reviewer panel verification (completeness/consistency/feasibility/simplicity/best-practices with OWASP/NIST research). All file:line facts verified against the live tree.

---

## 1. Context & Problem

The backend API is completely open today: 15 routers are registered flat with prefixes (`backend/src/main.py:138-151`), none has auth dependencies, there is no auth middleware, and grep for `HTTPBearer|OAuth2|jwt|jose|passlib` over `backend/src` is empty. sqladmin is mounted without an authentication backend (`backend/src/admin/setup.py:158`). The admin app (`frontend/admin`) has no login page and no session concept; the shared `api()` client (`packages/api-client/src/client.ts:15`) sends no credentials and ignores 401.

The `User` entity already exists and is designed for staff accounts: `backend/src/models/user.py:9-20` — `phone` (unique, String(20)), `email` (nullable unique), `password_hash` (String(255), NOT NULL — wide enough for any pwdlib/Argon2 output incl. scheme migration; do not tighten), `role` (String(20)), `master_id` (nullable unique FK→masters, 1:1), confirmation flags, soft-delete. `UserRole` enum already defines exactly two roles: `ADMIN = "admin"`, `MASTER = "master"` (`backend/src/models/enums.py:16-19`). No users are created anywhere: `backend/src/seed/seed.py` has no `User(`, user management exists only as the sqladmin `UserAdmin` view (`admin/setup.py:34`). The `users` table is created by the initial migration (`alembic/versions/4af69d9eff31_*.py:160`).

Two live consumers must keep working:

- **Public site** (`frontend/web`) reads dictionaries via `@memo/api-client` (`app/hooks/useSchedule.ts:5` — masters, services, locations, activities) and gallery photos, and **creates records anonymously**: `POST /api/v1/records` from the booking form (`frontend/web/app/lib/api/records.ts:30`).
- **Admin e2e suite** talks to the API without any session today (`frontend/admin/e2e/`, no `storageState` in `playwright.config.ts`); its factories insert `users` rows with a literal placeholder as `password_hash` (`password_hash: 'seeded'`, `e2e/fixtures/factories.ts:390`) — that must become a real Argon2 hash for any login to work.

Known hole found during recon: `/api/v1/user-settings` takes `?user_id=` and lets any caller read/write **any** user's settings (`backend/src/api/v1/user_settings.py:31-37`); `UserSettingsContext` uses the constant `DEV_USER_ID = 'dev-user-001'` with a TODO to replace it with the real auth user (`frontend/admin/contexts/UserSettingsContext.tsx:29`).

#239 (SSE push, designed, queued for IMPL) recorded two constraints for #247: (a) its events router guard must be one `Depends` line; (b) native `EventSource` cannot send `Authorization` headers — cookie-session with credentials is the integration path. This spec's session design satisfies both and resolves #239's option (a) — cookie-session — as the chosen path.

## 2. Locked decisions (G1a user-approved 2026-09-08; G1b revision decisions folded in)

1. **Scope = staff authentication only.** Roles `admin` and `master` log into `frontend/admin`. Client authentication (phone verification for booking) is #8's scope; the client web cabinet is later still. `POST /records` **stays anonymous until #8** — public site behavior is preserved exactly.
2. **Session = server-side row + opaque cookie, sliding.** Table `sessions` (token, user_id, created_at, last_extended_at, idle_deadline, absolute_deadline); cookie `memo_session` carries only the random token: `HttpOnly`, `SameSite=Lax`, `Secure` iff production, `Path=/`, Max-Age 30 days (the cap — a cookie outliving its row is harmless; the row governs). Lifetime: **idle window 7 days** (any authenticated request extends it; extension written at most once per hour — no DB write on every request) + **absolute cap 30 days** from creation, after which a fresh login is required (user-approved: "refresh при активности"). Logout deletes the row — instant revocation; an admin can force-logout a user by deleting their `sessions` rows via sqladmin or archiving the user. No `SECRET_KEY` is needed for API sessions (the token is random, not signed).
3. **Login = phone + password.** Exact match on the stored `phone` string after trimming whitespace. Password hashing: **pwdlib** (`pwdlib[argon2]` extra; user-confirmed) with **pinned Argon2 parameters** (§3.2). Argon2 embeds a per-password random salt inside the hash string — no salt column, two equal passwords hash differently.
4. **Roles & permissions live in code, checked by FastAPI dependencies.** One matrix `ROLE_PERMISSIONS` in `backend/src/auth/permissions.py`, keyed by `UserRole` values; permissions are `<entity>:read` / `<entity>:write`; admin holds the single literal `"*"`. The matcher is exactly `"*" in perms or perm in perms` — no `entity:*` wildcard tier, no server-side expansion (G1b simplification). `/me` returns the stored set as-is; the frontend `can()` handles `"*"`. DB-driven RBAC (roles/permissions tables, role-management UI) is explicitly rejected for MVP: two code-defined roles cover the need; adding a role later is a one-file edit.
5. **Master's permission set (user-approved, incl. `payments:read` "мастеру надо видеть какие записи уже оплачены"):** full working data (records, visits, visitors — the booking UI mutates visitors directly, `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx`), read-only dictionaries (masters, locations, services, tags, activities, photos), read-only clients, read-only payments, own user-settings. **No** materials, **no** management writes. Admin = everything.
6. **Default-deny, enforced by a contract test.** Every `/api/v1` route must either carry an auth dependency or appear in the `PUBLIC_ROUTES` allowlist constant (`backend/src/auth/public.py`); a contract test walks `app.routes` (APIRoute objects only — CORS middleware answers OPTIONS preflights before routing, so they never appear here) and enforces exactly that, plus fails on stale allowlist entries. New routers are protected automatically (a route without a dependency fails the test unless explicitly allowlisted).
7. **Public allowlist (the whole list):** `GET` on masters, locations, services, tags, activities, photos (site + gallery); `POST /api/v1/records` (anonymous booking until #8); `GET /api/v1/health`; the auth endpoints themselves (`login`/`logout`/`me`). Nothing else is public.
8. **sqladmin gets its standard login screen** via an `AuthenticationBackend(secret_url=..., secret_key=settings.SECRET_KEY)` — the backend ships and mounts its own `SessionMiddleware` with that secret; the app does **not** add one manually. Form login checks the `users` table (phone + password, pwdlib verify, `is_active` filter) and admits **role=admin only**. The `UserAdmin` form gets a write-only password field via a `scaffold_form` override (§3.9). Settings gain `SECRET_KEY` (env `SECRET_KEY`): in production it **fails fast when unset**; in dev an unset value resolves to a fixed dev constant (signs only the sqladmin session cookie; stable across dev restarts — random-per-boot was rejected by the panel as a footgun).
9. **User provisioning:** a small CLI (`python -m src.cli create-user --phone ... --role admin|master`, password via double `getpass` prompt) creates the first admin — **no default passwords committed** (the repo is public). Flags kept minimal (`--phone`, `--role` only; G1b simplification — master linking and later staff happen in sqladmin). Dev seed additionally creates two demo users (admin + master linked to the first seeded master) with fixed obviously-dev passwords, guarded by `ENV != production`.
10. **Password policy (user-approved, NIST 800-63B spirit — length over composition):** 8–64 characters after trimming edge whitespace; no control characters; **no** composition rules; minimum 8 is a recorded, deliberate deviation from NIST's 15-for-single-factor (staff-only accounts, lockout throttles online guessing; user-approved). Breach-list checking is out of scope. One validator function used everywhere a password is **created or changed** (CLI, sqladmin form, future flows). **The requirements are shown as a hint at every password-creation site** (user requirement): one constant hint string (`backend/src/auth/passwords.py`) rendered in the sqladmin form help text and the CLI prompt. The login page deliberately shows no hint (nothing is being set there).
11. **Brute-force throttle on login (G1b re-scoped per OWASP/NIST):** the **primary counter is per-phone** (the account) — ≥5 failures within 15 minutes locks that phone with HTTP 429 + `Retry-After`; a **secondary per-IP counter** (≥20 failures within 15 min across any phones) slows credential stuffing across many accounts. Both in-memory (single-process runtime by design, #239-verified) and simple: counter + window-start timestamp per key, not a timestamp deque.
12. **Frontend:** `/login` page (phone + password, controlled inputs — the repo has no form library), `AuthContext` in providers (`/me` on mount), `api()` gains `credentials: 'include'` plus a registrable 401 handler (admin registers a redirect to `/login?returnTo=…`; the shared client stays framework-neutral so `frontend/web` is unaffected). Client-side guard in the `(main)` layout. Navigation and write actions render by `can(permission)`. `UserSettingsContext` switches from `DEV_USER_ID` to the session user's id (closes the existing TODO). No Next.js `middleware.ts` — the session cookie is opaque (edge runtime cannot verify it against the DB), so the guard is client-side plus the 401 interceptor.
13. **User-settings access is own-scoped, param dropped (breaking change, G1b):** all `/api/v1/user-settings` endpoints require a session; the `?user_id=` query parameter is **removed** from GET/PUT/PATCH (the session user is the only addressable user); `DELETE /{settings_id}` resolves the row and applies the same ownership rule; violation → 403. Both call sites (admin frontend, TS client) live in this monorepo and are updated in the same task. This closes the any-user-settings hole.
14. **CSRF posture (G1b, user-approved): two independent lines.** Primary (already inherent): the API is JSON-only and CORS-with-credentials allows only listed origins — a browser page on another origin cannot send a JSON mutation without a preflight we reject. Secondary (new, ~10 lines): a `verify_fetch_metadata` dependency on **authenticated mutating endpoints** (POST/PUT/PATCH/DELETE behind `require_*`) rejects requests whose browser-set `Sec-Fetch-Site` header equals `cross-site`; a missing header passes (legacy clients/tools/tests). Anonymous public routes (incl. `POST /records`) are exempt by design — CSRF is an authenticated-session attack.
15. **SameSite=Lax, deliberately (G1b, user-approved):** Lax keeps link-entry working (opening the admin app from a messenger link carries the cookie) while cross-site POSTs never receive it; Strict would only re-close scenarios already covered by CORS + Sec-Fetch-Site and breaks first-entry UX. The `__Host-` cookie-name prefix requires HTTPS and is **deferred to the first production deployment** (recorded here; when enabled the name becomes `__Host-memo_session` behind a production-only config).

## 3. Backend architecture (binding)

### 3.1 New package `backend/src/auth/`

```
backend/src/auth/
├── __init__.py
├── passwords.py      # PasswordHash (pinned Argon2), validate_password(), PASSWORD_POLICY_HINT_RU
├── session.py        # Session ORM model
├── service.py        # AuthService: login/logout/resolve + lockout counters + sliding extension
├── permissions.py    # ROLE_PERMISSIONS, require_session, require_permission, verify_fetch_metadata
├── public.py         # PUBLIC_ROUTES constant (method + path template)
└── router.py         # /api/v1/auth: login / logout / me
```

### 3.2 Password hashing — `passwords.py`

- `from pwdlib import PasswordHash; from pwdlib.hashers.argon2 import Argon2Hasher` (pwdlib ≥0.2 actual API; `PasswordHash((Argon2Hasher(...),))`).
- Parameters **pinned**: `Argon2Hasher(time_cost=3, memory_cost=65536, parallelism=4)` — above the OWASP Password Storage floor (`m=19 MiB, t=2, p=1`) and equal to argon2-cffi/pwdlib defaults; pinned explicitly so a dependency upgrade cannot silently weaken them.
- `validate_password(pw)`: trims edge whitespace, then 8 ≤ len ≤ 64, rejects control characters; raises `PasswordPolicyError` whose message is the human hint (reused verbatim in UI).
- `PASSWORD_POLICY_HINT_RU`: «Пароль: от 8 до 64 символов, пробелы по краям обрезаются» — single source for all hints.
- The `password_hash` column (String(255)) comfortably holds any Argon2 encoded string (~100 chars) — do not tighten it.

### 3.3 Session model & migration

```python
class Session(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)  # secrets.token_urlsafe(32)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime]
    last_extended_at: Mapped[datetime]
    idle_deadline: Mapped[datetime]      # last_extended_at + IDLE_WINDOW
    absolute_deadline: Mapped[datetime]  # created_at + ABSOLUTE_CAP
```

One alembic revision creates the table. Constants live in the auth package (not settings — G1b simplification): `IDLE_WINDOW = 7 days`, `ABSOLUTE_CAP = 30 days`, extension throttle 1 hour. Hard-deleted rows (logout/expiry); opportunistic cleanup deletes expired rows for the user on login. Multiple concurrent sessions per user allowed.

Cookie: name `memo_session`, `httponly=True`, `samesite="lax"`, `secure=settings.ENV == "production"`, `path="/"`, `max_age=ABSOLUTE_CAP` (the row governs actual validity; a stale cookie yields 401 and is simply not re-sent by the browser after it expires).

### 3.4 Auth service — `service.py`

- `login(phone, password, client_ip) -> (User, token)`: lockout check (per-phone, then per-IP) → normalize phone (trim) → fetch by phone **with `is_active == True`** (archived users cannot log in) → `verify`. **Timing parity:** when the user is not found, run `verify` against a module-level dummy Argon2 hash anyway, so both branches take similar time. Failure increments both relevant counters and raises `AUTH_INVALID_CREDENTIALS` (identical for unknown phone and wrong password — no user enumeration). Success resets both counters, **deletes any `memo_session` row presented in the request** (session-id rotation on privilege change, OWASP), creates the session row, runs opportunistic cleanup.
- `logout(token)`: delete row (idempotent).
- `resolve(token) -> User | None`: row must satisfy `idle_deadline > now` and `absolute_deadline > now`; if valid and `last_extended_at` is older than 1 hour, extend `idle_deadline = now + IDLE_WINDOW` (respecting `absolute_deadline`); expired rows are deleted lazily and return None.

Lockout store: module-level `dict[key, (count, window_start)]`; keys `"phone:<phone>"` (threshold 5) and `"ip:<ip>"` (threshold 20); window 15 min; success resets the phone key.

### 3.5 Permissions — `permissions.py`

```python
ROLE_PERMISSIONS: dict[str, set[str]] = {   # keys are UserRole values
    UserRole.ADMIN.value: {"*"},
    UserRole.MASTER.value: {
        "records:read", "records:write",
        "visits:read", "visits:write",
        "visitors:read", "visitors:write",
        "masters:read", "locations:read", "services:read", "tags:read",
        "activities:read", "photos:read",
        "clients:read", "payments:read",
    },
}
```

- `require_session` dependency: cookie → `resolve` → 401 `AUTH_UNAUTHORIZED` if absent/expired; injects the `AuthedUser`.
- `require_permission(perm)` dependency factory: `require_session` → matcher `"*" in perms or perm in perms` → 403 `AUTH_FORBIDDEN` if missing.
- `verify_fetch_metadata` dependency (decision 14): applied alongside auth on mutating endpoints; rejects `Sec-Fetch-Site: cross-site`, passes when the header is absent.
- `GET /auth/me` returns the stored permission set as-is (admin gets `["*"]`; the frontend `can()` handles it).

### 3.6 Auth router — `router.py`

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/v1/auth/login` | `{phone, password}` | `200 {user, permissions, master?}` + Set-Cookie | 401 `AUTH_INVALID_CREDENTIALS`; 429 `AUTH_LOCKED_OUT` + Retry-After; 422 validation |
| `POST /api/v1/auth/logout` | — | `204` + cookie cleared | always (idempotent, works without session) |
| `GET /api/v1/auth/me` | — | `200 {user, permissions, master?}` | 401 `AUTH_UNAUTHORIZED` |

`user` = `{id, phone, role, master_id, email}` (id is the users.id UUID string — feeds user-settings); `master` = the linked master profile snapshot (`{first_name, last_name}`) when `master_id` is set, else `null` — the topbar falls back to the phone when `master` is null (a master user without a linked profile is valid and must not break the UI). Registered in `main.py` (`prefix="/api/v1/auth"`); all three are in `PUBLIC_ROUTES` (`me` returns 401 rather than requiring the dependency — the frontend must distinguish "no session" from "wrong password"; `getMe()` therefore resolves 401 to `null`, not an exception — §4.1).

### 3.7 Router guards — binding access matrix

Each `api/v1/*.py` router gains dependencies (router-level for reads, decorator-level for writes; mutating routes also carry `verify_fetch_metadata`):

| Router | Public | admin | master |
|---|---|---|---|
| masters | GET | read + write | read |
| locations | GET | read + write | read |
| services | GET | read + write | read |
| tags | GET | read + write | read |
| activities | GET | read + write | read |
| photos | GET | read + write | read |
| records | **POST** (anonymous booking, until #8) | read + write | read + write |
| visits | — | read + write | read + write |
| visitors | — | read + write | read + write |
| clients | — | read + write | read |
| payments | — | read + write | read |
| materials | — | read + write | — |
| user-settings | — | own-only (§3.8) | own-only |
| system `/health` | public | — | — |
| auth | public (by design) | — | — |

(«read + write» = the role holds both `<entity>:read` and `<entity>:write`; the matrix in §3.5 is the canonical token list.) Public method-level exceptions are expressed as decorator-level dependencies on the mutating routes; the open GETs are listed in `PUBLIC_ROUTES`.

### 3.8 User-settings scoping (breaking change)

All four endpoints get `Depends(require_session)`. **The `user_id` query parameter is removed** from GET/PUT/PATCH — the addressed user is always the session user. `DELETE /{settings_id}` resolves the row's `user_id` and rejects non-owned rows with 403 `AUTH_FORBIDDEN`. The TS client (`packages/api-client`) drops the parameter in the same task; `UserSettingsContext` stops sending it.

### 3.9 sqladmin login — `admin/setup.py`

- `class SqlAdminAuth(AuthenticationBackend)` with `secret_url="/admin/auth"`, `secret_key=settings.SECRET_KEY` — sqladmin mounts its own `SessionMiddleware` with that key; no manual middleware add (ordering with CORS is handled by the Admin mount). `login` reads the standard form (phone + password), verifies via `AuthService` (incl. `is_active`), requires `role == "admin"`; stores `{"user_id": ...}` in the sqladmin session. `logout` clears it. `authenticate` checks the stored key. The stock sqladmin login page is used, no custom templates.
- `UserAdmin` form: override `scaffold_form` to replace `password_hash` with a WTForms `PasswordField("password")` (never populated from the model, never rendered back). On **create**: required → `validate_password` → `hash` → store. On **edit**: optional; blank leaves `password_hash` unchanged; filled → validate + hash. Help text = `PASSWORD_POLICY_HINT_RU`.
- Testing env does not mount sqladmin (`main.py:134-135`) — unchanged; the sqladmin auth test builds its own app instance with admin mounted.

### 3.10 CLI — `backend/src/cli.py`

argparse, no new dependencies; async DB access via `asyncio.run(...)` (the same pattern as `backend/src/seed/seed.py`):

```
uv run python -m src.cli create-user --phone "+79990000001" --role admin
  # password: getpass prompt (repeated); validate_password; hash; INSERT
```

Errors: duplicate phone → clear message; invalid role → list choices. **Bootstrap sequence (production):** deploy → migration runs → `create-user` for the first admin → login. Until that step the production app has an empty `users` table and nobody can log in — by design (no default credentials in a public repo).

### 3.11 Seed

`backend/src/seed/seed.py` gains a `seed_staff_users()` step (skipped when `ENV == "production"`): admin `+79990000001 / admin12345` and master `+79990000002 / master12345` linked to the first seeded master. Passwords satisfy the policy; the obviously-fake values are deliberate (public repo, dev/demo only). **Deployment note:** staging environments must set `ENV=production` (or otherwise never run the seed) — a staging box running with a dev ENV would accept these demo credentials.

### 3.12 Dependencies & config

- `backend/pyproject.toml`: add `pwdlib[argon2]`.
- `backend/src/core/config.py`: add `SECRET_KEY: str = ""` (env `SECRET_KEY`; dev default resolves to the fixed dev constant `"dev-sqladmin-secret"` when `ENV != "production"`; **production fails fast on empty**).
- Session lifetime constants live in `backend/src/auth/` (§3.3), not in settings.
- CORS is already correct for cookies (`allow_credentials=True`, `main.py:45-51`; defaults include `localhost:3000-3002`). Deployment note: the admin origin must be in `CORS_ORIGINS`; subdomains of one registrable domain are fine for `SameSite=Lax` (site = eTLD+1, ports irrelevant). If the admin and API ever live on **different registrable domains**, `SameSite` must flip to `None` + `Secure` — a config change recorded here, not built now.

## 4. Frontend architecture (binding)

### 4.1 `packages/api-client`

- `api()` in `client.ts` adds `credentials: "include"` to every call.
- New `setUnauthorizedHandler(fn)` module-level registration; `api()` invokes it once per 401 response, **excluding** `/auth/*` calls. The admin registers a redirect handler; `frontend/web` registers nothing (its calls are all public).
- `endpoints.ts` gains `login(phone, password)`, `logout()`, `getMe()` with zod schemas (`AuthMeSchema`: user + permissions array + optional master). **`getMe()` resolves a 401 to `null`** (guest) instead of throwing — that is the AuthContext bootstrap contract. User-settings endpoints drop the `user_id` parameter (§3.8).

### 4.2 Login page — `frontend/admin/app/login/page.tsx`

Outside the `(main)` route group (no sidebar/topbar). Controlled inputs (phone, password), submit → `login()` → success: `router.replace(returnTo ?? "/")`; failure: inline error + `showToast` (existing `parseApiError` + toast system, repo style). Already authenticated (mount-time `/me` says so) → redirect to `/`. No policy hint on this page (deliberate, decision 10).

### 4.3 AuthContext — `frontend/admin/contexts/AuthContext.tsx`

State `{user, permissions, master?, status: "loading" | "authenticated" | "guest"}`; on mount `getMe()` → `authenticated` / `guest` (401 = guest, not an error). `login(phone, password)` (updates state + returns user), `logout()`, `can(permission): boolean` — handles `"*"` and set membership. Mounted in `app/providers.tsx` inside `UIProvider`, beside `UserSettingsProvider`.

### 4.4 Guards

- `(main)/layout.tsx`: `status === "loading"` → minimal spinner shell; `guest` → `router.replace("/login?returnTo=" + current)`. Client-side only (deliberate, decision 12).
- 401 interceptor (registered by AuthProvider): `window.location.assign("/login?returnTo=…")` — covers mid-work expiry in one place. **Accepted limitation (MVP):** unsaved form input at the moment of expiry is lost; `returnTo` returns the user to the same page. No pre-emptive expiry warning is built.

### 4.5 Permission-aware UI

- Navigation items (Topbar/Sidebar) carry `requiredPermission` and are filtered via `can()`: master does not see «Материалы»; «Платежи» and «Клиенты» are visible (read).
- Write affordances (create/edit/delete buttons, inline editors) check `can("<entity>:write")` and hide/disable when absent — master's «Платежи»/«Клиенты» render read-only. The API 403 is the enforcing layer; the UI is courtesy, not the guard.
- Topbar user label: master profile name when present, else phone (§3.6).

### 4.6 UserSettings integration

`UserSettingsContext` reads the user id from `AuthContext` (`user.id`, a UUID string — replaces `DEV_USER_ID`, closing the TODO at `UserSettingsContext.tsx:29`). Settings load only after auth resolves (`authenticated`); no data migration (dev-only data; a fresh user id simply starts with defaults).

### 4.7 #239 note

When the SSE provider lands, `new EventSource(url, { withCredentials: true })` — the cookie flows to the events endpoint; the events router adds its one-line `Depends(require_session)`. This resolves #239's recorded EventSource constraint (option a: cookie-session).

### 4.8 Admin e2e infrastructure

- `e2e/fixtures/factories.ts`: the user factory's `password_hash` value — currently the literal `'seeded'` — is replaced by a **precomputed Argon2 hash constant** (hash of the fixed e2e plaintext, generated once with the pinned parameters from §3.2; the salt lives inside the hash string, so a fixed constant verifies fine).
- `e2e/globalSetup.ts`: after DB seed, `request.post('/api/v1/auth/login')` as the seeded admin → save cookies to a Playwright `storageState` file; `playwright.config.ts` sets it as the default project state. Existing specs keep working unchanged (session cookie attached automatically); login-flow specs use a fresh context without the state.
- New specs cover the User Scenarios below (§6).

## 5. Error handling (binding)

| Situation | HTTP | Code | Notes |
|---|---|---|---|
| No/expired session on guarded route | 401 | `AUTH_UNAUTHORIZED` | Frontend: 401 handler → login redirect |
| Wrong phone or password | 401 | `AUTH_INVALID_CREDENTIALS` | Same message and timing profile for both cases |
| Locked out | 429 | `AUTH_LOCKED_OUT` | + `Retry-After` header |
| Authenticated but insufficient permission | 403 | `AUTH_FORBIDDEN` | incl. non-owned user-settings rows |
| Password policy violation (create/change) | 422 | `PASSWORD_POLICY` | message = the hint string |

**IMPL adds five codes to `backend/src/errors.py`'s `ErrorCode`** (the four `AUTH_*` + `PASSWORD_POLICY` — none exist today); the existing global handlers (`main.py:57-122`) keep ownership of formatting (`ErrorDetail`). `WWW-Authenticate` headers are not used (cookie sessions, not challenge auth — recorded deliberately).

## 6. User Scenarios (each maps to an E2E test)

1. **Admin signs in** — phone + password on `/login` → lands in the app, sees all sections (incl. «Материалы», «Платежи»). → e2e: login flow as seeded admin, assert sections.
2. **Master signs in** — sees working sections; no «Материалы»; «Платежи»/«Клиенты» visible but read-only (no write buttons). → e2e: login as seeded master, assert nav + hidden affordances.
3. **Wrong password** — inline error + toast, stays on `/login`, no cookie set. → e2e.
4. **Logout** — session row deleted; protected page redirects to `/login`; guarded API now answers 401. → e2e (+ backend API test for the 401).
5. **Anonymous boundaries** — guarded endpoints 401 without a cookie; public site surface unchanged: dictionary GETs 200 and `POST /records` 201 anonymously. → backend API tests (parametrized), contract test for the allowlist.
6. **Master hits a forbidden endpoint** — `POST /api/v1/payments` as master → 403; as admin → normal. → backend API test.
7. **sqladmin is closed** — `/admin/*` redirects to the sqladmin login; role=admin passes; role=master is rejected with the standard login error. → backend test on a dedicated app instance with sqladmin mounted.

## 7. Testing strategy

- **Unit:** hash/verify round-trip; `validate_password` table (lengths, trimming, control chars); permission matcher (`"*"` and concrete tokens). Lockout is covered at API level only (one test: threshold + `Retry-After`; G1b simplification — no fake-clock ceremony; the counter is count + window-start).
- **API (pytest `TestClient`):** login success / wrong password / lockout+Retry-After; `me` with/without cookie; logout revokes; login rotates a presented stale session; per-router guard matrix parametrized by role × representative endpoints; user-settings own-only scoping (session-user reads own settings OK; foreign/legacy `user_id` param rejected); public allowlist (anonymous dictionary GETs 200, anonymous `POST /records` 201); Sec-Fetch-Site rejection (`cross-site` → 403 on an authenticated mutation; missing header passes); sqladmin auth on a dedicated app fixture.
- **Fixtures (`backend/tests/conftest.py`):** the shared `api_client` becomes **function-scoped with a per-test login** (the truncate-per-test reset wipes `sessions`, so a session-scoped login would 401 from the second test — panel finding); the `Session` model joins the conftest model imports so truncation covers it; role-specific tests build fresh clients with explicit logins.
- **Contract:** every `/api/v1` route either has an auth dependency or matches `PUBLIC_ROUTES`; every `PUBLIC_ROUTES` entry matches a real route (staleness check). Walks `APIRoute` objects only — CORS preflights are answered by middleware before routing. Follows the existing `test_generic_api_contract.py` genre.
- **Admin e2e (Playwright):** §4.8; new specs for scenarios 1–4; existing specs unchanged behavior via storageState.
- **Backend e2e runner** stays `uv run --extra dev`; no CI workflow changes beyond what tests themselves need.

## 8. Out of scope (deliberately not built)

- Client authentication & phone verification for booking → **#8**; client web cabinet → later. `POST /records` remains anonymous until then.
- DB-driven RBAC (roles/permissions tables), role-management UI; the `CLIENT` role itself (added with #8).
- Password reset / change in the admin UI (sqladmin suffices for MVP); 2FA; "remember me"; session-management UI (device list) — an admin force-logs-out via sqladmin (delete session rows) or archiving the user.
- Per-master data scoping ("master sees only their own records") — master's records access is studio-wide; a separate task if ever needed.
- SMS/OTP, email-based login, breach-list password checks, pre-emptive session-expiry warnings.
- `__Host-` cookie prefix and any HTTPS-only hardening → first production deployment.

## 9. Dependencies & ordering

- Independent of #239 (SSE). If #239 lands first, FastAPI is ≥0.140 — no interaction with anything here (no version pins added). This spec satisfies #239's recorded constraints: cookie session (`SameSite=Lax`, credentials) + one-line `Depends` guard on the future events router.
- FastAPI version itself: whatever is current in `uv.lock` at IMPL time (0.136.3 today; #239's planned upgrade does not conflict).
- No frontend dependency changes; no changes to `frontend/web`.
- **Deliberate posture deviations recorded (G1b):** password floor 8 (vs NIST 15 single-factor); SameSite=Lax + Sec-Fetch-Site (vs strictest OWASP menu); idle 7d/cap 30d (vs OWASP 15–30 min idle); in-memory lockout (single-process runtime). Each is a conscious MVP tradeoff for an internal staff tool, revisit at production hardening.
