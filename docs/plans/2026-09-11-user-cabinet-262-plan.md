# Employee cabinet (#262) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development, задача за задачей. Шаги — чекбоксы (`- [ ]`).

**Goal:** Кабинет сотрудника: popup-меню на плашке пользователя (слайдер темы с персистом, «Мои данные», «Сменить пароль», «Выйти»), self-сервис «Мои данные» (GET/PUT `/api/v1/my`: имя карточки — редактируемое, специализация — read-only, приватные поля и паспортные тексты — в новой таблице `user_profiles`), загрузка портрета (единственная файловая инфраструктура: multipart + локальный каталог + публичная StaticFiles-раздача) и смена пароля (текущая сессия живёт, остальные удаляются).

**Architecture:** Аддитивно к живым #247/#266: новая таблица `user_profiles` (1:1 users, ленивое создание) + композитный сервис (одна транзакция: поля карточки staff + приватные поля; эмитит существующую SSE-сущность `staff`); роутер `/api/v1/my` под `require_session` (без пермишен-токена — own-data, как `/auth/me`); файловая инфраструктура — `FILES_DIR/avatars`, снифф магических байтов stdlib, раздача Starlette `StaticFiles` на `/api/v1/files/avatar`; `change-password` в существующем auth-роутере (не в PUBLIC_ROUTES). Фронт: `UserMenu` popup заменяет блок+кнопку «Выйти» из #247 T13 и слайдер темы; модалки по паттерну PhotoModal; тема — localStorage + inline-скрипт до гидрации. Отдельная задача приводит блок пользователя и `/auth/me`-снапшот к спеке ревизии 3 (avatar_url в снапшоте; плашка без ярлыка роли и телефона, fallback «Аноним» — поправки 015a060 не попали в IMPL #247).

**Tech Stack:** FastAPI (UploadFile, StaticFiles, python-multipart — единственная новая зависимость), SQLAlchemy 2 + alembic, pwdlib (существующий), Next.js 14 App Router, TanStack Query, vitest/pytest, Playwright.

**Spec (binding):** `docs/specs/2026-09-09-user-cabinet-design.md` — **ревизия 3** (staff-словарь, переписана T12 плана #266). Решения D1–D12, «Data model» §3, «API» §4, «Frontend» §5, «Testing» §6, сценарии S1–S6 §7.

**Precondition (гейт T0):** #247 (`81d9006`, PR #268) и #266 (`bf6877f`, PR #269) смержены, CI main зелёный.

**Worktree:** `./.opencode/scripts/create-worktree.sh feat/cabinet-262`.

**Test commands:** backend `cd backend && uv run --extra dev pytest -q`; фронт `cd frontend/admin && pnpm test && pnpm type-check`; api-client `cd packages/api-client && pnpm test`; e2e `cd frontend/admin && pnpm test:e2e -- e2e/cabinet.spec.ts` (стек `scripts/e2e-shard-start.sh`, см. `scripts/test-all.sh`).

**Commits:** per-task, `feat(#262): …`.

**Красные окна:** план аддитивный — заявленных красных окон НЕТ; существующие тесты правятся только в зоне той же задачи (юнит-тесты Menubar в T6, visual-базлайны в T8). Полный прогон каждого слоя — зелёный после каждой задачи.

---

## Behavioral Delta (по сценариям спеки §7)

- **S1:** клик по плашке (и по круглому аватару свёрнутого сайдбара) открывает popup ровно с 4 пунктами (слайдер темы, «Мои данные», «Сменить пароль», «Выйти»); тема переключается мгновенно, живёт после перезагрузки без вспышки светлой; старый ряд-слайдер из панели исчезает.
- **S2:** смена пароля: неверный старый — ошибка у поля; верный — тост, сессия живёт; после выхода старый пароль не работает, новый — работает.
- **S3:** публичная часть «Моих данных»: имя/фамилия правятся (плашка и таблица «Сотрудники» обновляются), портрет загружается/меняется/удаляется (аватар на плашке сразу); специализация — read-only строка, значение админа не меняется.
- **S4:** приватная часть: отчество/даты/адреса/паспортные тексты сохраняются и переживают переоткрытие; без сессии `/my` — 401; в публичном ответе `/masters` нет ни одного приватного поля.
- **S5:** «Выйти» из popup → `/login`; возврат на `/schedule` перенаправляет на логин.
- **S6:** учётка без карточки: плашка «Аноним» + инициал; форма — только роль и приватные поля; приватные поля работают.
- **Плашка (приведение к спеке):** аватар + имя и фамилия (показываются и у архивированной карточки), без ярлыка роли и телефона; «Аноним» — только если в карточке нет имени-фамилии (на практике карточки нет).

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `backend/src/models/user_profile.py` | CREATE (T1) | `UserProfile` 1:1 users (все колонки optional, §3.1 спеки) |
| `backend/alembic/versions/*_user_profiles*.py` | CREATE (T1) | новая таблица |
| `backend/src/schemas/my.py` | CREATE (T1) | MyProfile response/update (omitted=keep, null=clear; `specialties` read-only) |
| `backend/src/services/profile.py` | CREATE (T1) | композит: staff-поля + ленивый profile в ОДНОЙ транзакции; эмит `staff` |
| `backend/src/api/v1/my.py` | CREATE (T1, T2) | GET/PUT `/my` (require_session; PUT + verify_fetch_metadata); `POST /my/portrait` (T2) |
| `backend/src/main.py` | MODIFY (T1, T2) | регистрация роутера; StaticFiles-mount `/api/v1/files/avatar` |
| `backend/src/core/config.py` | MODIFY (T2) | `FILES_DIR` |
| `backend/src/util/file_type.py` | CREATE (T2) | магические байты JPEG/PNG/WebP, stdlib |
| `backend/src/services/files.py` | CREATE (T2) | сохранение/замена/удаление аватара (uuid-имя, лимит, ошибка → чистка temp) |
| `backend/pyproject.toml` | MODIFY (T2) | `python-multipart` |
| `backend/src/auth/router.py` | MODIFY (T3) | `POST /auth/change-password` (require_session + verify_fetch_metadata; НЕ в PUBLIC_ROUTES) |
| `backend/src/auth/service.py` | MODIFY (T3) | `change_password`: verify текущего (timing parity `DUMMY_HASH`), политика, `sa_delete(Session).where(user_id==…, token != текущая)` |
| `backend/src/schemas/auth.py` | MODIFY (T3) | `ChangePasswordRequest`; `MasterSnapshot` += `avatar_url` (nullable) |
| `backend/src/auth/router.py` `_build_me_response` | MODIFY (T3) | снапшот собирается из карточки staff (имена + avatar_url) — `router.py:52-88` |
| `packages/api-client/src/endpoints.ts` | MODIFY (T4) | `getMyProfile`/`updateMyProfile`/`uploadPortrait`/`changePassword`; региcтрация schemas |
| `packages/api-client/src/schemas.ts` | MODIFY (T4) | `MyProfileSchema`, `ChangePasswordSchema`; `MasterSnapshotSchema` += avatar_url (`:673`) |
| `frontend/admin/contexts/UIContext.tsx` | MODIFY (T5) | тема: чтение `localStorage["memo-theme"]` на маунте, запись в `toggleTheme` (`:24,35,90-94`) |
| `frontend/admin/app/layout.tsx` | MODIFY (T5) | inline-скрипт до гидрации ставит `data-theme` |
| `frontend/admin/app/components/layout/UserMenu.tsx` | CREATE (T6) | popup (4 пункта, a11y Menu Button, открытие вверх, триггер в свёрнутом режиме) |
| `frontend/admin/app/components/layout/Menubar.tsx` | MODIFY (T6) | блок → триггер popup: убрать кнопку «Выйти» (`:701-705`) и ряд-слайдер (`:727-740`, переезжает в popup), ярлык роли — константа (`:486`) И JSX-рендер (`:699`), fallback телефона в displayName (`:479-484` → «Аноним»), рендер `<img>` при avatar_url |
| `frontend/admin/hooks/useMyProfile.ts` | CREATE (T7) | query `['me','profile']` (дитя префикса `['me']`) + мутации + инвалидация `me`+`staff`(+`masters`) |
| `frontend/admin/app/components/modal/MyDataModal.tsx` | CREATE (T7) | форма «Мои данные» (field-config паттерн PhotoModal) |
| `frontend/admin/app/components/modal/PasswordModal.tsx` | CREATE (T7) | смена пароля |
| `frontend/admin/e2e/cabinet.spec.ts` | CREATE (T8) | S1–S6 |
| `frontend/admin/e2e/globalSetup.ts` (+ `seed-reset.ts`) | MODIFY (T8) | test-scoped `FILES_DIR` + очистка вместе с БД |
| `frontend/admin/e2e/visual-regression.spec.ts` | MODIFY (T8) | pin `memo-theme=light` в beforeEach |
| `CHANGELOG.md` | MODIFY (T8) | строка #262 |

---

## Task 0: Гейт и baseline

### Classification: trivial
### Required Docs
- Спека §10 (sequencing), шапка плана (Precondition).

- [ ] Убедиться: #247 и #266 в main, CI main зелёный (`gh run list --branch main`).
- [ ] `git checkout main && git pull --ff-only`; baseline: `uv run --extra dev pytest -q`, `pnpm test`, `pnpm type-check` — зелёные; выводы в отчёт задачи.

**DoD:** гейт пройден, baseline зафиксирован.

## Task 1: Backend — `user_profiles` + `GET/PUT /api/v1/my`

### Classification: standard
### Required Docs
- Спека §3.1, §4 (форма ответа, PUT-семантика), D3/D7; `docs/domain-rules/profile.md` (граница, ленивое создание).

- [ ] RED (pytest): GET — flat-профиль точь-в-точь §4 (role, has_staff, has_master, имена/avatar_url/specialties из карточки и master-секции, приватные поля); `has_staff=false` при отсутствии карточки **или её архиве** (имена null, запись имён игнорируется); `has_master=false` при отсутствии/архиве master-секции (specialties null); PUT: omitted=keep, null=clear; `first/last_name` обязательны когда есть и пишутся в карточку staff; `specialties` в теле игнорируется (read-only); ленивое создание `user_profiles`; одна транзакция (staff-поля + профиль); эмит существующей SSE-сущности `staff`; публичный GET `/api/v1/masters` (и `/staff`) — в key set нет ни одного приватного поля.
- [ ] GREEN: модель/миграция/schemas/сервис/роутер по File Structure; `require_session` на обоих, `verify_fetch_metadata` на PUT.
- [ ] `uv run --extra dev pytest -q` — зелёный. Commit `feat(#262): user_profiles + GET/PUT /my`.

## Task 2: Backend — аватар: загрузка + публичная статика

### Classification: standard
### Required Docs
- Спека §3.4, D5/D8; `docs/domain-rules/profile.md` (Avatar files).

- [ ] RED (pytest): `Content-Length` > 5MB → 413 `FILE_TOO_LARGE` ДО чтения тела; кап при стриминге; магические байты принимают JPEG/PNG/WebP, отклоняют переименованные/чужие → 415 `FILE_INVALID_TYPE`, temp-файл удалён на каждой ошибке; имя = UUIDv4 + расширение из белого списка; успех → `Staff.avatar_url` карточки сессионного юзера = `/api/v1/files/avatar/<uuid>.<ext>`, предыдущий СОБСТВЕННЫЙ (served) файл удалён, внешний URL не тронут; без сессии → 401; `GET /api/v1/files/avatar/<uuid>.jpg` — публично 200 (`X-Content-Type-Options: nosniff`, Content-Type по расширению); имя с разделителями путей не выходит из каталога (StaticFiles-конфайнмент → 404).
- [ ] GREEN: FILES_DIR, file_type, services/files, POST /my/portrait, StaticFiles-mount, `python-multipart` в pyproject. Новых зависимостей кроме него нет.
- [ ] pytest зелёный. Commit `feat(#262): avatar upload + static serving`.

## Task 3: Backend — `change-password` + avatar в `/auth/me`-снапшоте

### Classification: small
### Required Docs
- Спека §4 (строка change-password), D6; `docs/domain-rules/auth.md:42-45` (Change password).

- [ ] RED (pytest): неверный текущий → 401 `AUTH_INVALID_CREDENTIALS` с timing-parity (DUMMY_HASH); нарушение политики → 422 `PASSWORD_POLICY`; успех → 204, **текущая сессия жива, остальные строки юзера удалены** (`token != текущей`); поля лестницы блокировок не тронуты; `/auth/me` — `master.avatar_url` присутствует (null, когда карточки нет); имя снапшота — из карточки **независимо от её архива** (Display rule спеки §4).
- [ ] GREEN: `AuthService.change_password` (паттерн удаления сессий `service.py:271-276`), роут `router.py` после `/me` (require_session + verify_fetch_metadata; в `PUBLIC_ROUTES` НЕ вносить), `MasterSnapshot` += avatar_url (`schemas/auth.py:32-35`) + `_build_me_response` (`router.py:52-88`): читает `staff.avatar_url`, outerjoin карточки **без** фильтра `Staff.is_active == True` (`router.py:56-63`) — имя/аватар показываются и у архивированной карточки.
- [ ] pytest зелёный. Commit `feat(#262): change-password + avatar in me snapshot`.

## Task 4: api-client

### Classification: small
### Required Docs
- Спека §4; конвенции `packages/api-client` (endpoints.ts `:915-929` — зона auth; schemas.ts `:664-679`).

- [ ] `endpoints.ts`: `getMyProfile`, `updateMyProfile(data)`, `uploadPortrait(file)` (multipart), `changePassword({current_password, new_password})`.
- [ ] `schemas.ts`: `MyProfileSchema`/`MyProfileUpdateSchema` (паритет Pydantic), `ChangePasswordSchema`, `MasterSnapshotSchema` += `avatar_url` (nullable).
- [ ] Regen fixtures: `packages/api-client/scripts/gen_backend_fixtures.py`.
- [ ] `pnpm test` (api-client) зелёный; фронт `pnpm type-check` — зелёный (поле nullable, аддитивно). Commit `feat(#262): api-client my/password endpoints`.

## Task 5: Фронт — персист темы + bootstrap до гидрации

### Classification: small
### Required Docs
- Спека §5.4; сценарий S1.

- [ ] RED (vitest): маунт UIContext читает `localStorage["memo-theme"]` (fallback light); `toggleTheme` пишет localStorage + `data-theme`; inline-скрипт в `app/layout.tsx` стоит в `<head>` и читает тот же ключ.
- [ ] GREEN: `UIContext.tsx` (`:24,35,90-94`), `app/layout.tsx`. Commit `feat(#262): theme persistence`.

## Task 6: Фронт — UserMenu popup + приведение плашки к спеке

### Classification: standard
### Required Docs
- Спека §5.1, §6 (гэп-поправка: снапшот/плашка), D1/D9; сценарии S1/S5; `docs/design-system.md`.

- [ ] RED (vitest): клик/Enter по плашке открывает popup **вверх** с ровно 4 пунктами; вне-клик/Escape закрывают; стрелки навигируют; **Tab уходит и закрывает**; фокус возвращается на триггер; `aria-haspopup="menu"`+`aria-expanded` на триггере; в свёрнутом сайдбаре — круглый аватар-триггер (сегодня блок скрыт целиком); «Выйти» зовёт AuthContext-logout (`AuthContext.tsx:74`, тот же хелпер — без дублирующего API-вызова) → `/login`; плашка: аватар + имя и фамилия (в т.ч. архивированной карточки), ярлыка роли НЕТ, «Аноним» — только когда в карточке нет имени-фамилии (на практике карточки нет), при `master.avatar_url` — `<img>`, иначе инициал.
- [ ] GREEN: `UserMenu.tsx` NEW (паттерн action-menu `frontend/admin/app/components/shared/DataTable.tsx`); `Menubar.tsx` MODIFY: убрать кнопку «Выйти» (`:701-705`) и ряд-слайдер (`:727-740` — переезжает в popup), ярлык роли — и константу (`:486`), и JSX-рендер (`:699`), телефон-fallback в displayName (`:479-484` → «Аноним»); обновить юнит-тесты Menubar в этой же задаче.
- [ ] `pnpm test && pnpm type-check` зелёные. Commit `feat(#262): user menu popup`.

## Task 7: Фронт — MyDataModal + PasswordModal

### Classification: large
### Required Docs
- Спека §5.2, §5.3, §5.5, D2/D4/D7/D12; `docs/domain-rules/profile.md`; паттерны `PhotoModal.tsx`, `PositionModal.tsx`, `CalendarPopover`, `DeleteDialog.tsx`.

- [ ] RED (vitest) MyDataModal: Роль read-only; Имя*/Фамилия* (скрыты целиком при `has_staff=false`); Специализация — read-only строка (массив через запятую; строка видна только при `has_master=true`; PUT её не отправляет); Отчество/Дата рождения (CalendarPopover)/Адрес проживания; секция «Паспорт»: место рождения, серия и номер, когда выдан, кем выдан, адрес регистрации + disabled-строка «Фото первой страницы паспорта — появится позже» (точная строка, без интерактива); портрет-блок: превью + «Загрузить фото» → `uploadPortrait` (аватар плашки обновляется сразу) + «Удалить» → `avatar_url: null`; dirty-guard на закрытии; submit → `updateMyProfile` → инвалидация `['me']` + семьи `staff` и `masters` (`lib/invalidate.ts`, БЕЗ новых EntityName/SSE-сущностей); режимы no-card (S6).
- [ ] RED (vitest) PasswordModal: 3 поля, хинт `PASSWORD_POLICY_HINT_RU`, неверный текущий → inline «Неверный пароль», успех → тост «Пароль изменён», без редиректа; открытие обеих модалок из UserMenu.
- [ ] GREEN: `useMyProfile.ts` (`['me','profile']` — дитя префикса `['me']`, одна инвалидация `invalidateQueries(['me'])` покрывает), модалки по File Structure. Commit `feat(#262): my-data + password modals`.

## Task 8: E2E, файловая гигиена тестов, базлайны, CHANGELOG

### Classification: standard
### Required Docs
- Спека §6 (Testing), §7 (S1–S6); e2e-инфра: `e2e/fixtures/factories.ts` (`seedUser :461`, `linkUserToStaff :432`), `globalSetup.ts:134-158` (storageState админа), `seed-reset.ts` (RESET_SQL), #247-паттерн логина мастера (API POST /auth/login).

- [ ] RED: `cabinet.spec.ts` — S1 (popup 4 пункта, тема живёт после reload, старый слайдер исчез), S2 (смена пароля: ошибка → тост → сессия жива → старый пароль отвергнут на `/login`, новый принят), S3 (имя+портрет → плашка и таблица «Сотрудники»; специализация read-only), S4 (приватные поля персистятся; `/my` без сессии 401; key set `/masters` без приватных полей), S5 («Выйти» → `/login`, `/schedule` редиректит), S6 (`seedUser` без карточки: «Аноним», форма без имени/специализации, приватные поля работают — расширить фабрику опцией «без staff_id»).
- [ ] Инфра: test-scoped `FILES_DIR` (env e2e-стека) + очистка каталога вместе с БД в globalSetup; visual-regression `beforeEach` ставит `localStorage["memo-theme"]="light"`; сид-юзеры без аватаров.
- [ ] Re-capture базлайнов: `menubar-*` (слайдер убран, плашка изменена) + любые полные страницы с нижним блоком.
- [ ] GREEN: полный стек (`scripts/test-all.sh`) зелёный. CHANGELOG.md строка #262. Commit `test(#262): cabinet e2e + baselines + changelog`.

---

## DoD
- Все задачи GREEN (pytest, vitest, type-check, api-client, полный e2e); E2E для сценариев S1–S6 проходит (RED-GREEN-REFACTOR); CHANGELOG обновлён; всё §2 BUILD спеки ревизии 3 доставлено, §2 NOT-build не тронуто; PR со ссылкой на спеку/план и `Closes #262`.
