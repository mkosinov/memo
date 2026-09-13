# Employee cabinet (#262) — design spec

- **Date / status:** 2026-09-09 → revision 2 on 2026-09-10 (panel folded + user amendments); **revision 3 on 2026-09-12 — rewritten under the staff vocabulary after #266** (task T12 of the #266 plan). G1b.
- **Depends on:** #247 (auth) — **strictly after** its IMPL: this spec assumes `require_session`, `verify_fetch_metadata`, auth router (login/logout/me), login page, `AuthContext`, the bottom-left user block (T13), pwdlib Argon2, `PASSWORD_POLICY`, CLI create-user. And **after #266** (staff restructuring) — the vocabulary below (`Staff` card, `masters` extension, positions) assumes it.
- **Sibling:** #263 (master role v1 — data scoping, phone masking, payments, photos, role-gated nav) — separate issue, later design; nothing from #263 is built here.
- **Seam amendments to #247 (committed together with this spec, before its IMPL):** (1) the `master` snapshot in `GET /auth/me` is assembled from the linked staff card (`first_name`, `last_name`, `avatar_url`) + master fields; (2) the user block shows staff-card avatar + name only — fallback «Аноним», no phone, no role label; (3) the T13 logout control is pinned to a text button «Выйти» — the popup menu defined here replaces it.

## 0. Терминология (#266)

Ревизия 3 переписана под staff-словарь спеки `docs/specs/2026-09-10-staff-restructuring-design.md`:

- **Карточка сотрудника (`Staff`)** — `first_name`, `last_name`, `avatar_url`, `is_active`; есть у **каждого** (мастера, администраторы, СММ, …).
- **Master-секция (`Master`)** — 1:0..1 к карточке: `specialty` (CSV), `color`, `is_active` (распределение / расписание). Создаётся, архивируется и редактируется админом в карточке сотрудника (#266 D5/D6); на расписании ведущий = активная master-строка.
- **«Аноним»** — учётка **без карточки сотрудника** (не «без мастера»).
- Специализация доступна только у сотрудников с master-секцией; управляет ею админ (#266 D5) — в «Моих данных» она **read-only** (решение юзера 10.09).

Новой ролевой модели нет: доступ — по-прежнему единственное поле `users.role` (`admin|master`, матрица #247); должность лишь **авто-подставляет** роль по шаблону #263 D10. `user.roles` (мн. ч.) не существует.

## 1. Context (live tree, 2026-09-10)

- Theme toggle lives in the Menubar bottom row (`frontend/admin/app/components/layout/Menubar.tsx:685-697`); state in `UIContext` (`theme`, `toggleTheme`, sets `data-theme`, `frontend/admin/contexts/UIContext.tsx:35,90-98`). **No persistence** — resets to light on reload. `UserSettings.theme` column exists and stays unwired (NOT-build).
- User block bottom-left is hardcoded «А»/«Админ» (`Menubar.tsx:670-678`) until #247 T13 lands. When the sidebar is collapsed the whole block is hidden today — this spec adds a collapsed avatar-circle trigger.
- **No file upload exists anywhere**: no `UploadFile`/multipart in backend; `Photo.filename` and `Staff.avatar_url` are plain URL strings (`backend/src/models/photo.py:35`, `backend/src/models/staff.py`). The Photos page is a catalog of external links — there is no file CRUD to reuse, so the (small) avatar upload pipeline is built here.
- **`Staff`** (#266; renamed from the old `masters` people table) has `first_name`, `last_name` (String 100), `avatar_url` (Text), `sort_order`, `is_active`. **`Master`** is now the schedule extension (`staff_id` PK/FK, `specialty` (Text, CSV, `«живопись, керамика»`), `color`, `is_active`); every master row belongs to a staff card — see `docs/domain-rules/staff.md`.
- `User` has no name fields (`backend/src/models/user.py`) and links to a staff card via `users.staff_id` (nullable, unique; renamed from `master_id` by #266). No profile/passport entities exist.
- #247 makes masters GET **public** (PUBLIC_ROUTES allowlist) — private employee data lives on a separate `user_profiles` table keyed by `user_id`, structurally unreachable from public serializers.
- Settings: `backend/src/core/config.py:11`; the files setting lands there.
- Frontend patterns: action menu with outside-click/roving tabindex (`DataTable.tsx:102-132,343-376`), form modal with field-config + per-field errors + dirty-guard (`PhotoModal.tsx`), `Modal` shell, `CalendarPopover`, toasts + `parseApiError` (UIContext), invalidation helpers (`frontend/admin/lib/invalidate.ts`).

## 2. Scope

**BUILD**
1. User popup menu (cabinet) on the user block: theme slider (moved from the Menubar bottom row), «Мои данные», «Сменить пароль», «Выйти» (text items, no header).
2. Self-service profile «Мои данные»: modal + `GET/PUT /api/v1/my`.
3. New `user_profiles` table (private fields, 1:1 to users, lazily created).
4. Avatar upload: multipart endpoint + local dir + public static serving (the only file infrastructure in v1); writes `Staff.avatar_url` of the session user's staff card.
5. `POST /api/v1/auth/change-password`.
6. Theme persistence (localStorage + pre-hydration bootstrap).

**NOT BUILD** (user decisions 2026-09-09/10)
- **Passport photo — placeholder only** («давай пока заглушку… просто надпись»): the form shows a disabled row «Фото первой страницы паспорта — появится позже»; no upload, no private file storage, no private file serving, no download audit log (reviewer's suggestion declined for v1).
- «Выданные пропуска» (issued passes) — dropped.
- Admin access to employee profiles (beyond the stock sqladmin table view) — separate future task.
- Role, patronymic, birth date, addresses, passport fields in public responses.
- Cross-device theme sync (wiring `UserSettings.theme`).
- **Specialty editing from the cabinet** — read-only here (admin manages it in the staff card, #266 D5/D6).
- Everything from #263; client-facing gallery (#48); receipt photos; moderation of self-edits; i18n (strings stay hardcoded RU, recorded here).

## 3. Data model

### 3.1 `user_profiles` (new, private by construction)

| column | type | notes |
|---|---|---|
| user_id | FK users.id, unique | 1:1; row created lazily on first `PUT /my` |
| patronymic | String(100), null | отчество |
| birth_date | Date, null | дата рождения |
| residence_address | String(255), null | адрес фактического проживания |
| birth_place | String(255), null | место рождения |
| passport_series_number | String(30), null | серия и номер; normalized on save (trim, collapse spaces) |
| passport_issued_date | Date, null | когда выдан |
| passport_issued_by | String(255), null | кем выдан |
| registration_address | String(255), null | адрес регистрации |

All columns optional. No `passport_photo` column in v1 (placeholder decision); it will be added together with the private-file pipeline when the user decides. The table is never joined into public serializers.

### 3.2 `staff` / `masters` changes

- **`Staff`** is the person card (all employees): `first_name`, `last_name` (public; self-editable via `/my`), `avatar_url` (public; portrait upload writes here), `is_active` (person archive), `sort_order`.
- **`Master`** extension holds `specialty` and `color`; both are managed by the admin in the staff card (#266 D5) and are **read-only** in `/my`. `specialty` stores **comma-separated values** from the vocabulary («живопись, керамика») — it is `Text` since #266; the public masters API keeps returning the raw string (display-compatible), `GET /my` returns it as an array for display.
- `avatar_url` (existing Text on `Staff`, public): after a portrait upload it holds the **served path** `/api/v1/files/avatar/<uuid>.<ext>`; legacy external URLs keep rendering as-is; the admin URL field keeps working (two writers, last write wins — recorded, no locking).
- Master-section archival (`masters.is_active = false`) does **not** remove the staff card: name/avatar stay, specialty remains stored for old records and is not exposed as an active specialty.

### 3.3 Specialties vocabulary

`SPECIALTIES = ["живопись", "керамика"]` — the domain rule `docs/domain-rules/staff.md` is the single source; a backend constant (validation, future admin write) and a frontend read-only renderer reference it. `Service.specialty` stays single-value, unchanged.

### 3.4 Avatar files (the only file infrastructure)

- Storage: `FILES_DIR` setting (`core/config.py`, default `<backend data>/files`), subdir `avatars/`.
- Upload `POST /api/v1/my/portrait`: check `Content-Length` first (reject `FILE_TOO_LARGE` 413 before reading), stream to disk with a byte cap, sniff magic bytes of the first chunk (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF…WEBP`) — **stdlib only, no new dependency**; wrong type → `FILE_INVALID_TYPE` 415 and the temp file deleted. Stored under a server-generated UUIDv4 name + whitelisted extension; user input never reaches the path. A successful upload overwrites `Staff.avatar_url` of the session user's card and **deletes the previous file** if it was a served UUID path (no orphans; external URLs never touched).
- Serving: Starlette `StaticFiles` mount at `/api/v1/files/avatar` rooted at `FILES_DIR/avatars` — public, confined to that one directory by construction (a request can never resolve into another dir), `X-Content-Type-Options: nosniff`, `Content-Type` from the stored extension. No dynamic public file route exists at all; passport photos do not exist in v1 — **there is nothing private on disk to reach**, which is the structural answer to the panel's traversal BLOCKER (the strict uuid+extension naming stays as belt-and-suspenders).

## 4. API

`/my` routes require a session (`require_session`); mutating routes (incl. multipart) carry `verify_fetch_metadata` (#247 decision 14). Errors use the app envelope; new codes: `FILE_TOO_LARGE` (413), `FILE_INVALID_TYPE` (415); policy violations reuse `PASSWORD_POLICY` (422).

| Method & path | Auth | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/v1/my` | session | — | `200` flat profile (below) | 401 |
| `PUT /api/v1/my` | session | JSON subset (below) | `200` same shape | 422 validation |
| `POST /api/v1/my/portrait` | session | multipart `file` | `200 {avatar_url}` | 413, 415, 422 |
| `POST /api/v1/auth/change-password` | session | `{current_password, new_password}` | `204`; **deletes all other sessions** of the user, keeps the current one | 401 `AUTH_INVALID_CREDENTIALS` (wrong current, timing-parity dummy verify), 422 `PASSWORD_POLICY` |

`GET /my` response (flat):

```json
{
  "role": "master",
  "has_staff": true,
  "has_master": true,
  "first_name": "…", "last_name": "…", "avatar_url": "/api/v1/files/avatar/….jpg",
  "specialties": ["керамика"],
  "patronymic": null, "birth_date": null, "residence_address": null,
  "birth_place": null, "passport_series_number": null, "passport_issued_date": null,
  "passport_issued_by": null, "registration_address": null
}
```

- `has_staff` = a linked staff card exists **and is not archived**; `has_master` = that card has a master-section row that is not archived. When `has_staff` is false, name/avatar/specialties are `null` (and name writes are ignored); when `has_master` is false, `specialties` is `null` (the modal hides the row). «Аноним» = `has_staff: false` (#266 vocabulary; a user without a card is valid).
- **PUT semantics:** an omitted key keeps its current value; an explicit `null` clears it (nullable columns only). `first_name`/`last_name` are required when present and must be non-empty; they write the **staff card**. `specialties` is **read-only** in this endpoint (present in the response, ignored on write — the admin owns it, #266 D5). Private fields write the lazily created `user_profiles` row.
- One `@transactional` service method writes the staff-card fields and the private fields (lazy profile create) **in a single transaction**, then emits the existing **`staff`-updated SSE event** (other tabs' staff tables refresh; the `me` query is invalidated locally by the calling client — no new SSE entity, no new invalidation family). No master-section fields are written here (specialty/color are admin-owned); the frontend still refreshes the `masters` family because its read-only view joins the card (name/avatar).
- `/auth/me` stays the auth snapshot (session boot: `{user, permissions, master}` — `master` snapshot assembled from the staff card + master fields); `/my` is the editable profile (modal). No overlap in purpose.

## 5. Frontend

### 5.1 UserMenu popup

- The user block (Menubar bottom-left, post-#247/post-#266: avatar + name from the staff card, fallback «Аноним») becomes the trigger; popup opens **upward**. In the collapsed sidebar an avatar-only circle renders as the trigger (today the whole block is hidden when collapsed — new behavior). Visual reference: the ZCode user menu (user screenshot 2026-09-09) — compact rounded card with shadow.
- Items, **no header**: theme slider (Sun/Moon control moved from the Menubar bottom row; layout adapts to the popup), «Мои данные», «Сменить пароль», «Выйти».
- A11y per WAI-ARIA Menu Button pattern: `aria-haspopup="menu"` + `aria-expanded` on the trigger; arrow keys navigate; **Tab moves out and closes**; outside click and Escape close; focus returns to the trigger.
- «Выйти» calls the #247 logout flow → `/login`. The T13 «Выйти» button is removed (replaced by this menu).

### 5.2 MyDataModal

- Medium modal via the shared `Modal` shell; field-config pattern of `PhotoModal` (per-field errors, dirty-guard confirm on close, Escape, submit → `PUT /my`).
- Top block: portrait — avatar circle preview + «Загрузить фото» + «Удалить» (sets `avatar_url: null`); upload → `POST /my/portrait` → block avatar updates immediately.
- Fields: Роль (read-only), Имя*, Фамилия* (hidden entirely when `has_staff === false`), **Специализация — read-only строка** (array joined for display; only shown when `has_master === true`; the admin owns it in the staff card, #266 D5), Отчество, Дата рождения (`CalendarPopover`), Адрес фактического проживания; «Паспорт» section: Место рождения, Серия и номер, Когда выдан (date), Кем выдан, Адрес регистрации, and the placeholder row «Фото первой страницы паспорта — появится позже» (disabled, no interaction).
- Required: only Имя/Фамилия (when `has_staff`); everything else optional, cleared via `null`.

### 5.3 PasswordModal

- Small modal: Старый пароль, Новый пароль, Повторите новый; hint reuses `PASSWORD_POLICY_HINT_RU`.
- Wrong current → inline field error «Неверный пароль»; success → toast «Пароль изменён», modal closes; the current session is NOT touched (no redirect).

### 5.4 Theme persistence

- `UIContext`: on mount read `localStorage["memo-theme"]` (fallback `light`), apply `data-theme`; `toggleTheme` writes through.
- **Pre-hydration bootstrap:** a tiny inline script in the root layout sets `data-theme` from localStorage before React hydrates — no flash of light theme (Next.js App Router standard pattern).

### 5.5 Invalidation

- After `PUT /my` / portrait upload the mutation hooks invalidate `['me']` (local) + the existing `staff` family (the card changed) and, for safety, the `masters` family (both feed schedules and tables). No new `EntityName`, no `INVALIDATION_MAP` change, no new SSE entity, no drift-guard test change.

## 6. Testing

- **Backend unit:** `/my` GET/PUT (user without a card → `has_staff: false`, name writes ignored; user with a card but no master section → `has_master: false`, specialties null; lazy profile create; omitted-vs-null semantics; archived card → `has_staff: false`; archived master section → `has_master: false`; `specialties` ignored on write); change-password (wrong current → 401 with timing parity; policy → 422; **other sessions deleted, current kept**); portrait upload (Content-Length precheck rejects before read; byte cap; magic bytes per format incl. renamed files; uuid naming; previous served file deleted, external URLs untouched); public masters serializer key set never contains any profile field.
- **Frontend unit:** UserMenu (open/close/keyboard/Tab-closes/focus return, collapsed trigger), MyDataModal (validation, dirty-guard, no-card mode, no-master mode, read-only specialty), PasswordModal, theme persistence + bootstrap script.
- **E2E infra:** `FILES_DIR` is test-scoped and wiped together with the DB by the e2e reset (#252 globalSetup); visual-regression specs pin `localStorage["memo-theme"]="light"` in `beforeEach`; seed users carry no avatars (baselines see initials only).

## 7. User Scenarios (each maps to an E2E test)

1. **Cabinet popup + theme:** logged in, click the user block → popup with exactly 4 controls (slider, Мои данные, Сменить пароль, Выйти); toggling theme switches palette; **reload keeps the chosen theme**; the old slider row is gone from the left panel.
2. **Change password:** wrong old password → inline error, nothing changes; correct change → toast, session keeps working (no redirect); after logout the **old** password fails at `/login`, the new one succeeds.
3. **Public part of «Мои данные»:** a staff member with a master section edits first/last name, uploads a portrait → the user block shows the photo, the staff table shows the new name; the specialty is displayed **read-only** and the admin-owned value is unchanged.
4. **Private part of «Мои данные»:** fill patronymic/dob/addresses/passport fields, reopen the modal → values persisted; `GET /api/v1/my` without a session → 401; the public `GET /api/v1/masters` response key set contains **none** of the private fields.
5. **Logout from the popup:** «Выйти» → at `/login`; navigating to `/schedule` redirects back to `/login` (session dead).
6. **User without a staff card:** such a user's block shows «Аноним» + initial avatar; «Мои данные» shows role + private fields only (name/specialties/portrait hidden); private fields save and persist.

## 8. Decisions (numbered, G1a + panel + user amendments + #266 rewrite)

- **D1 — popup, no header:** the block already shows avatar+name; the popup lists only controls.
- **D2 — public/private boundary (user):** public = staff card first/last name + avatar, and (only for the master subsection) specialty; everything else owner-only via `/my`. Role is not published.
- **D3 — private data off the staff/master entities:** `user_profiles` keyed by `user_id`; public endpoints structurally cannot leak it (masters GET is public per #247, staff GET is guarded).
- **D4 — specialties are admin-owned (#266 D5):** `/my` shows `specialties` read-only; the CSV `specialty` lives on the master section; no cabinet write path.
- **D5 — avatar-only files (user amendment):** multipart upload + local dir + public StaticFiles serving. No object storage, no private file pipeline (passport photo is a placeholder).
- **D6 — change-password session semantics:** keep current, delete all others; does NOT feed the #247 lockout ladder (authenticated context; the ladder guards anonymous login brute-force).
- **D7 — user without a staff card:** «Аноним» block fallback; name/specialties/portrait hidden in the modal and ignored on write; private fields fully usable.
- **D8 — avatar single field:** the portrait upload writes `Staff.avatar_url` of the session user's card; legacy external URLs and the admin URL field keep working; upload deletes the previous served file.
- **D9 — «Аноним» fallback (user):** no phone on the block — everyone is expected to have a name; anonymous is the placeholder until a staff card is linked (a user can legitimately have no card, #266 «Валидация и правила»).
- **D10 — panel simplifications adopted:** no MultiSelect component (specialty is a read-only string now); no `profile` invalidation family/SSE entity (local `me` + `staff`/`masters` invalidation); StaticFiles instead of a hand-rolled public file route; no immutable-cache tuning; split-migration and JSON-column machinery dropped entirely (D4 makes them unnecessary).
- **D11 — /me vs /my:** auth snapshot (staff-card + master fields) vs editable profile — separate endpoints, separate purposes, documented to prevent drift.
- **D12 — i18n:** all new UI strings hardcoded RU (repo convention), recorded here deliberately.

## 9. Domain rules (committed with this spec)

- `docs/domain-rules/auth.md` — change-password rules (endpoint, current check, policy reuse, session semantics, no ladder).
- `docs/domain-rules/staff.md` — `specialty` is comma-separated multi-value on the master section, admin-owned; `avatar_url` served-path semantics on the staff card; self-edit via `/my` (two writers).
- `docs/domain-rules/profile.md` (new) — `user_profiles` entity, the public/private boundary (D2/D3), avatar file rules (D5), passport-photo placeholder status.

## 10. Sequencing

- Strictly after #247 IMPL **and after #266** (staff restructuring; task T12 of the #266 plan rewrote this spec's vocabulary — revision 3, 2026-09-12; incl. the three seam amendments to #247).
- #263 stays strictly after #262.
