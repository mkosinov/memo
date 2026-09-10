# Employee cabinet (#262) — design spec

- **Date / status:** 2026-09-09 → revision 2 on 2026-09-10 (panel folded + user amendments). G1b.
- **Depends on:** #247 (auth) — **strictly after** its IMPL: this spec assumes `require_session`, `verify_fetch_metadata`, auth router (login/logout/me), login page, `AuthContext`, the bottom-left user block (T13), pwdlib Argon2, `PASSWORD_POLICY`, CLI create-user.
- **Sibling:** #263 (master role v1 — data scoping, phone masking, payments, photos, role-gated nav) — separate issue, later design; nothing from #263 is built here.
- **Seam amendments to #247 (committed together with this spec, before its IMPL):** (1) `master` snapshot in `GET /auth/me` gets `avatar_url`; (2) the user block shows avatar + name only — fallback «Аноним», no phone, no role label; (3) the T13 logout control is pinned to a text button «Выйти» — the popup menu defined here replaces it.

## 0. Поправки после staff-реструктуризации #266 (решения юзера, 2026-09-10)

Этим разделом уточняются пункты ниже; полная перепись спеки под staff-словарь — задачей T12 плана #266.

- **Специализация — только чтение** (решение юзера 10.09; отменяет чекбоксы §5.2 и поле `specialties` в PUT §4). Источник — вложенная master-запись карточки сотрудника (`master: {specialty, …} | null`, мир #266): в «Моих данных» специализация отображается read-строкой, только при наличии мастер-секции. Управляет — админ в карточке сотрудника (#266 D5); сотрудник специализации не пишет.
- **Источники полей:** имя/фамилия/аватар — карточка сотрудника (staff; есть у всех, включая СММ), специализация — только у ведущих (master-секция). Флаг `has_master` §4 заменяется на пару «карточка существует» + «master-секция существует»; «Аноним» (D9) = учётка **без карточки сотрудника**.
- **Строка роли в форме** остаётся «Роль (read-only)». Доступ — по-прежнему единственное поле `users.role` (admin|master, матрица #247); должность лишь **авто-подставляет** роль по шаблону #263 D10: «мастер» → master, «админ» → admin, несколько должностей — старшая (admin > master), прочие должности и ручная правка — остаются. Новой ролевой модели нет; `user.roles` (мн. ч.) не существует.
- **Зависимости:** строго после #247 IMPL **и после #266**.

## 1. Context (live tree, 2026-09-10)

- Theme toggle lives in the Menubar bottom row (`frontend/admin/app/components/layout/Menubar.tsx:685-697`); state in `UIContext` (`theme`, `toggleTheme`, sets `data-theme`, `frontend/admin/contexts/UIContext.tsx:35,90-98`). **No persistence** — resets to light on reload. `UserSettings.theme` column exists and stays unwired (NOT-build).
- User block bottom-left is hardcoded «А»/«Админ» (`Menubar.tsx:670-678`) until #247 T13 lands. When the sidebar is collapsed the whole block is hidden today — this spec adds a collapsed avatar-circle trigger.
- **No file upload exists anywhere**: no `UploadFile`/multipart in backend; `Photo.filename` and `Master.avatar_url` are plain URL strings (`backend/src/models/photo.py:35`, `backend/src/models/master.py:24`). The Photos page is a catalog of external links — there is no file CRUD to reuse, so the (small) avatar upload pipeline is built here.
- `Master` has `first_name`, `last_name` (String 100), `specialty` (String(20), **single enum value «живопись»/«керамика»** — see `docs/domain-rules/masters.md`), `avatar_url` (Text). SQLite does not enforce VARCHAR lengths, so the existing `specialty` column holds comma-separated multi-values without any migration.
- `User` has no name fields (`backend/src/models/user.py:9-21`). No profile/passport entities exist.
- #247 makes masters GET **public** (PUBLIC_ROUTES allowlist) — private employee data lives on a separate `user_profiles` table keyed by `user_id`, structurally unreachable from public serializers.
- Settings: `backend/src/core/config.py:11`; the files setting lands there.
- Frontend patterns: action menu with outside-click/roving tabindex (`DataTable.tsx:102-132,343-376`), form modal with field-config + per-field errors + dirty-guard (`PhotoModal.tsx`), `Modal` shell, `CalendarPopover`, toasts + `parseApiError` (UIContext), invalidation helpers (`frontend/admin/lib/invalidate.ts`).

## 2. Scope

**BUILD**
1. User popup menu (cabinet) on the user block: theme slider (moved from the Menubar bottom row), «Мои данные», «Сменить пароль», «Выйти» (text items, no header).
2. Self-service profile «Мои данные»: modal + `GET/PUT /api/v1/my`.
3. New `user_profiles` table (private fields, 1:1 to users, lazily created).
4. Avatar upload: multipart endpoint + local dir + public static serving (the only file infrastructure in v1).
5. `POST /api/v1/auth/change-password`.
6. Theme persistence (localStorage + pre-hydration bootstrap).

**NOT BUILD** (user decisions 2026-09-09/10)
- **Passport photo — placeholder only** («давай пока заглушку… просто надпись»): the form shows a disabled row «Фото первой страницы паспорта — появится позже»; no upload, no private file storage, no private file serving, no download audit log (reviewer's suggestion declined for v1).
- «Выданные пропуска» (issued passes) — dropped.
- Admin access to employee profiles (beyond the stock sqladmin table view) — separate future task.
- Role, patronymic, birth date, addresses, passport fields in public responses.
- Cross-device theme sync (wiring `UserSettings.theme`).
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

### 3.2 `masters` changes

- **`specialty` column reused as-is** (user decision: «почему не используем её напрямую? она под специализации и задумывалась»): it stores **comma-separated values** from the vocabulary («живопись, керамика»). SQLite does not enforce VARCHAR(20), so no migration, no new column, no type change. The public masters API keeps returning the raw string (display-compatible); `GET /my` returns it as an array for the form.
- `first_name`, `last_name` unchanged (public; now also self-editable via `/my`).
- `avatar_url` (existing Text, public): after a portrait upload it holds the **served path** `/api/v1/files/avatar/<uuid>.<ext>`; legacy external URLs keep rendering as-is; the admin URL field keeps working (two writers, last write wins — recorded, no locking).

### 3.3 Specialties vocabulary

`SPECIALTIES = ["живопись", "керамика"]` — the domain rule `docs/domain-rules/masters.md` is the single source; a backend constant (validation) and a frontend copy (checkbox labels) reference it. Backend validation on `PUT /my`: every value ∈ vocabulary, duplicates dropped. `Service.specialty` stays single-value, unchanged.

### 3.4 Avatar files (the only file infrastructure)

- Storage: `FILES_DIR` setting (`core/config.py`, default `<backend data>/files`), subdir `avatars/`.
- Upload `POST /api/v1/my/portrait`: check `Content-Length` first (reject `FILE_TOO_LARGE` 413 before reading), stream to disk with a byte cap, sniff magic bytes of the first chunk (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF…WEBP`) — **stdlib only, no new dependency**; wrong type → `FILE_INVALID_TYPE` 415 and the temp file deleted. Stored under a server-generated UUIDv4 name + whitelisted extension; user input never reaches the path. A successful upload overwrites `Master.avatar_url` and **deletes the previous file** if it was a served UUID path (no orphans; external URLs never touched).
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
  "has_master": true,
  "first_name": "…", "last_name": "…", "specialties": ["керамика"], "avatar_url": "/api/v1/files/avatar/….jpg",
  "patronymic": null, "birth_date": null, "residence_address": null,
  "birth_place": null, "passport_series_number": null, "passport_issued_date": null,
  "passport_issued_by": null, "registration_address": null
}
```

- `has_master` = a linked master exists **and is not archived**; otherwise master fields are `null` and master-field writes in `PUT` are ignored (§8 D7).
- **PUT semantics:** an omitted key keeps its current value; an explicit `null` clears it (nullable columns only). `first_name`/`last_name` are required when present and must be non-empty. `specialties` arrives as an array.
- One `@transactional` service method writes master fields (name/specialties) and private fields (lazy profile create) **in a single transaction**, then emits the existing master-updated SSE event (other tabs' masters tables refresh; the `me` query is invalidated locally by the calling client — no new SSE entity, no new invalidation family).
- `/auth/me` stays the auth snapshot (session boot: `{user, permissions, master}` — snapshot now `{first_name, last_name, avatar_url}`); `/my` is the editable profile (modal). No overlap in purpose.

## 5. Frontend

### 5.1 UserMenu popup

- The user block (Menubar bottom-left, post-#247: avatar + name, fallback «Аноним») becomes the trigger; popup opens **upward**. In the collapsed sidebar an avatar-only circle renders as the trigger (today the whole block is hidden when collapsed — new behavior). Visual reference: the ZCode user menu (user screenshot 2026-09-09) — compact rounded card with shadow.
- Items, **no header**: theme slider (Sun/Moon control moved from the Menubar bottom row; layout adapts to the popup), «Мои данные», «Сменить пароль», «Выйти».
- A11y per WAI-ARIA Menu Button pattern: `aria-haspopup="menu"` + `aria-expanded` on the trigger; arrow keys navigate; **Tab moves out and closes**; outside click and Escape close; focus returns to the trigger.
- «Выйти» calls the #247 logout flow → `/login`. The T13 «Выйти» button is removed (replaced by this menu).

### 5.2 MyDataModal

- Medium modal via the shared `Modal` shell; field-config pattern of `PhotoModal` (per-field errors, dirty-guard confirm on close, Escape, submit → `PUT /my`).
- Top block: portrait — avatar circle preview + «Загрузить фото» + «Удалить» (sets `avatar_url: null`); upload → `POST /my/portrait` → block avatar updates immediately.
- Fields: Роль (read-only), Имя*, Фамилия* (hidden entirely when `has_master === false`), **Специализация = checkbox group** (one labeled checkbox per SPECIALTIES value — no new shared MultiSelect component, user decision), Отчество, Дата рождения (`CalendarPopover`), Адрес фактического проживания; «Паспорт» section: Место рождения, Серия и номер, Когда выдан (date), Кем выдан, Адрес регистрации, and the placeholder row «Фото первой страницы паспорта — появится позже» (disabled, no interaction).
- Required: only Имя/Фамилия; everything else optional, cleared via `null`.

### 5.3 PasswordModal

- Small modal: Старый пароль, Новый пароль, Повторите новый; hint reuses `PASSWORD_POLICY_HINT_RU`.
- Wrong current → inline field error «Неверный пароль»; success → toast «Пароль изменён», modal closes; the current session is NOT touched (no redirect).

### 5.4 Theme persistence

- `UIContext`: on mount read `localStorage["memo-theme"]` (fallback `light`), apply `data-theme`; `toggleTheme` writes through.
- **Pre-hydration bootstrap:** a tiny inline script in the root layout sets `data-theme` from localStorage before React hydrates — no flash of light theme (Next.js App Router standard pattern).

### 5.5 Invalidation

- After `PUT /my` / portrait upload the mutation hooks invalidate `['me']` (local) + the existing `masters` family. No changes to `EntityName`, `INVALIDATION_MAP`, the SSE entity list, or the drift-guard test.

## 6. Testing

- **Backend unit:** `/my` GET/PUT (no-master user incl. master-field ignore; lazy profile create; omitted-vs-null semantics; archived master → `has_master: false`); change-password (wrong current → 401 with timing parity; policy → 422; **other sessions deleted, current kept**); portrait upload (Content-Length precheck rejects before read; byte cap; magic bytes per format incl. renamed files; uuid naming; previous served file deleted, external URLs untouched); public masters serializer key set never contains any profile field.
- **Frontend unit:** UserMenu (open/close/keyboard/Tab-closes/focus return, collapsed trigger), MyDataModal (validation, dirty-guard, no-master mode, checkbox group), PasswordModal, theme persistence + bootstrap script.
- **E2E infra:** `FILES_DIR` is test-scoped and wiped together with the DB by the e2e reset (#252 globalSetup); visual-regression specs pin `localStorage["memo-theme"]="light"` in `beforeEach`; seed users carry no avatars (baselines see initials only).

## 7. User Scenarios (each maps to an E2E test)

1. **Cabinet popup + theme:** logged in, click the user block → popup with exactly 4 controls (slider, Мои данные, Сменить пароль, Выйти); toggling theme switches palette; **reload keeps the chosen theme**; the old slider row is gone from the left panel.
2. **Change password:** wrong old password → inline error, nothing changes; correct change → toast, session keeps working (no redirect); after logout the **old** password fails at `/login`, the new one succeeds.
3. **Public part of «Мои данные»:** a master edits first/last name, checks both specialties, uploads a portrait → the user block shows the photo, the masters table shows the new name/specialty string/photo.
4. **Private part of «Мои данные»:** fill patronymic/dob/addresses/passport fields, reopen the modal → values persisted; `GET /api/v1/my` without a session → 401; the public `GET /api/v1/masters` response key set contains **none** of the private fields.
5. **Logout from the popup:** «Выйти» → at `/login`; navigating to `/schedule` redirects back to `/login` (session dead).
6. **User without a master profile:** such a user's block shows «Аноним» + initial avatar; «Мои данные» shows role + private fields only (name/specialties/portrait hidden); private fields save and persist.

## 8. Decisions (numbered, G1a + panel + user amendments)

- **D1 — popup, no header:** the block already shows avatar+name; the popup lists only controls.
- **D2 — public/private boundary (user):** public = first/last name, specialty, avatar; everything else owner-only via `/my`. Role is not published.
- **D3 — private data off the masters entity:** `user_profiles` keyed by `user_id`; public endpoints structurally cannot leak it (masters GET is public per #247).
- **D4 — specialties (user amendment):** reuse the existing `specialty` column as comma-separated values; no migration; checkbox group in the UI; vocabulary from the masters domain rule.
- **D5 — avatar-only files (user amendment):** multipart upload + local dir + public StaticFiles serving. No object storage, no private file pipeline (passport photo is a placeholder).
- **D6 — change-password session semantics:** keep current, delete all others; does NOT feed the #247 lockout ladder (authenticated context; the ladder guards anonymous login brute-force).
- **D7 — user without a master profile:** «Аноним» block fallback; master fields hidden in the modal and ignored on write; private fields fully usable.
- **D8 — avatar single field:** the portrait upload writes `Master.avatar_url`; legacy external URLs and the admin URL field keep working; upload deletes the previous served file.
- **D9 — «Аноним» fallback (user):** no phone on the block — everyone is expected to have a name; anonymous is the placeholder until a master profile is linked.
- **D10 — panel simplifications adopted:** checkbox group (no MultiSelect component); no `profile` invalidation family/SSE entity (local `me` + `masters` invalidation); StaticFiles instead of a hand-rolled public file route; no immutable-cache tuning; split-migration and JSON-column machinery dropped entirely (D4 makes them unnecessary).
- **D11 — /me vs /my:** auth snapshot vs editable profile — separate endpoints, separate purposes, documented to prevent drift.
- **D12 — i18n:** all new UI strings hardcoded RU (repo convention), recorded here deliberately.

## 9. Domain rules (committed with this spec)

- `docs/domain-rules/auth.md` — change-password rules (endpoint, current check, policy reuse, session semantics, no ladder).
- `docs/domain-rules/masters.md` — `specialty` becomes comma-separated multi-value; `avatar_url` served-path semantics; self-edit via `/my` (two writers).
- `docs/domain-rules/profile.md` (new) — `user_profiles` entity, the public/private boundary (D2/D3), avatar file rules (D5), passport-photo placeholder status.

## 10. Sequencing

- Strictly after #247 IMPL **and after #266** (staff restructuring; its plan task T12 rewrites this spec's vocabulary per §0 above; incl. the three seam amendments to #247).
- #263 stays strictly after #262.
