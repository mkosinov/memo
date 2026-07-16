# Design Spec — #131: refactor(client-stats) в единицах записей

**Date:** 2026-07-16
**Issue:** [#131](https://github.com/mkosinov/memo/issues/131) — refactor(client-stats): переосмыслить статистику клиента в единицах записей (records_count / missed_records / last_record)
**Status:** Approved concept (G1a) — pending written spec review (G1b)
**Depends on:** #98 ✅ (Record.status derivation + shared `active_record_filter` — merged in PR #135), #105 ✅ (scalar-subquery structural fix — merged in PR #132)
**Type:** Refactor across public API contract (~75 touchpoints)
**Approach:** A — single PR, two sequential phases (backend T1 → frontend T2-T4 → docs T5)

---

## §1 Целевая семантика трёх полей (backend)

Три поля статистики клиента переводятся с «визитов» на «записи» как единую смысловую единицу.

| Старое поле | Новое поле | Что считает | SQL реализация |
|---|---|---|---|
| `visits_count` | `records_count` | Количество записей клиента | Без изменения логики: rename `records_count_sq` label only. Условие `Record.is_active = True` сохраняется. |
| `missed_visits` | `missed_records` | Количество записей с производным статусом `missed` | **NEW:** `COUNT(Record.id) WHERE Record.status='missed' AND Record.is_active = True`. Проще старого: не джойнит Visit, использует персистируемый `Record.status` (миграция #135 уже backfilled все строки). |
| `last_visit` | `last_record` | Дата последнего мероприятия, на которое клиент был записан (по `Activity.start`) | **NEW:** `MAX(Activity.start) JOIN Record→Activity WHERE Record.client_id=X AND Record.is_active=True`. **Без фильтра по статусу** — учитываются все записи (включая отменённые/пропущенные/ожидание). Главная дата — «на какое самое последнее по дате мероприятие клиент был записан». Проще старого: без джойна Visit, без `Visit.status='visited'` фильтра. |

### Ключевое упрощение
- Удалён джойн `Visit` из двух subqueries (`missed_records`, `last_record`). Visit is leaf table, чтение из неё теперь не требуется для stats.
- `Record.status` уже корректен (backfilled миграцией `4d5e6f7a8b9c` + `recompute_record_status()` вызывается на каждом CRUD Record/Visit, model default отсутствует — status явно задаётся при создании).
- `last_record` — **семантический сдвиг** (намеренный, user-approved 2026-07-16): было «дата фактического последнего посещения» (`Visit.status='visited'`) → станет «дата последнего мероприятия, на которое клиент был записан» (без фильтра статуса). Эта семантика шире и стабильнее — не зависит от того, проставил ли админ статусы визитам.

### `is_active` фильтр
Все три subqueries сохраняют `Record.is_active = True` (мягко-удалённые записи не считаем — единообразно со всеми остальными stats под `list_clients_with_stats`). Кандидат на общий помощник `active_records()` (issue #105 pomette) — **OUT-scope** для #131 (решается отдельно).

---

## §2 Полный expand rename — параметры API

В `ClientListParams` (`backend/src/schemas/client.py:69-87`):

| Старое | Новое | Примечание |
|---|---|---|
| `min_visits: int \| None` | `min_records: int \| None` | Фильтр по `records_count` |
| `max_visits: int \| None` | `max_records: int \| None` | Фильтр по `records_count` |
| `missed_from: int \| None` | `missed_from: int \| None` | **As-is** — нейтральное «пропущенные», семантика не меняется (теперь считает `missed_records` через `Record.status='missed'`) |
| `missed_to: int \| None` | `missed_to: int \| None` | **As-is** |
| `sort_by` enum values: `visits_count`, `last_visit`, `missed_visits` | `records_count`, `last_record`, `missed_records` | В `sort_column_map` (`services/client.py:175-178`) |

**No backward-compat aliases.** Pre-prod, atomic rename. Старые ключи API → 422.

Backend `services/client.py` `stats_filter_map` (lines 144-150): ключи `min_visits`/`max_visits` → `min_records`/`max_records`. `min_paid`/`max_paid`/`missed_from`/`missed_to` не меняются.

---

## §3 Frontend слой — порядок обновления

| Слой | Файл | Что меняется |
|---|---|---|
| **Zod schema** (public API contract) | `packages/api-client/src/schemas.ts:285-288` | 3 поля переименованы: `visits_count`→`records_count`, `last_visit`→`last_record`, `missed_visits`→`missed_records`. Type `ClientWithStats` обновляется автоматически через `z.infer`. |
| **Column defs** | `ClientsTable.tsx` (`COLUMNS`, `getStoredColumns`, `storageKey`) | Ключи `visits_count`→`records_count`, `last_visit`→`last_record`. Labels: `"Кол-во визитов"`→`"Всего записей"`, `"Последний визит"`→`"Последняя запись"`. localStorage `clients-columns` — без миграции (pre-prod, старые ключи молча проигнорируются при несовпадении с новыми `COLUMNS`, сброс через ColumnPicker). |
| **Cell rendering** | `ClientsTable.tsx:137-145` | `client.visits_count` → `client.records_count`, `client.last_visit` → `client.last_record`. `visibleKeys.includes('visits_count')` → `'records_count'`, то же для `last_visit`. |
| **Stats маппинг** (raw → camelCase prop) | `ClientInfoTab.tsx:169-171`, `ClientRecordTab.tsx:201-203`, `ClientTab.tsx` (ActivityDetailsModal):164-168 | `visitsCount: client.visits_count` → `recordsCount: client.records_count` (3 поля × 3 файла). Type-guard в `ClientTab.tsx:164`: `'visits_count' in client` → `'records_count' in client`. |
| **Компонент-prop interface** | `ClientStatistics.tsx:4-6` | `visitsCount`→`recordsCount`, `missedVisits`→`missedRecords`, `lastVisit`→`lastRecord` (в interface + использовании внутри компонента). |
| **Filters (context)** | `ClientsContext.tsx` (`ClientFilters` interface, defaults, `sort_by` param passthrough lines 25-26, 40-41, 84) | `min_visits`→`min_records`, `max_visits`→`max_records` в интерфейсе, defaults и query-параметре. |
| **Filters (UI)** | `ClientsFilters.tsx` ( bindings lines 57-60, label line 55) | `min_visits`/`max_visits` → `min_records`/`max_records`. Group label: `"Визиты"` → `"Записи"`. `missed_from`/`missed_to` bindings не меняются. |

### localStorage — без миграции

Продукт не в проде, реальных пользователей нет (user decision 2026-07-16). Старые ключи в `localStorage['clients-columns']` молча проигнорируются при несовпадении с новыми `COLUMNS` ключами — колонки просто не отобразятся, сброс через ColumnPicker "Сбросить колонки". Никакого runtime-mapper, никакого backward-compat кода.

---

## §4 Тесты — обновление, не добавление

### Backend (~25 refs в 2 файлах)
- **`backend/tests/test_client_stats.py`** (44 строки с field-asserts) — переименовать:
  - `visits_count` → `records_count`
  - `last_visit` → `last_record`
  - `missed_visits` → `missed_records`
  - `sort_by='visits_count'` → `sort_by='records_count'` (аналогично остальным)
  - `min_visits=X` query param → `min_records=X`
  - `max_visits=X` → `max_records=X`
  - `missed_from`/`missed_to` — без изменений
  - Семантика тестов `test_last_visit_*` меняется: прежний акцент на "visited-only" → новый "all records по Activity.start". Существующие fixtures с 1 visited-record прокруют зелёным (visited record имеет Activity.start). Новые assertions для edge cases (отмена-запись раньше visited-записи — `last_record` = более поздняя Activity.start, даже если отменена).
- **`backend/tests/test_schemas_client.py:163-189`** — переименовать поля в schema validation asserts.

### Frontend unit (~29 refs в 5 файлах + 2 helper файла)
- `frontend/admin/__tests__/ClientsTable.test.tsx` (16 refs) — column headers, mock data, sort keys, `localStorage.getItem('clients-columns')` seeded data → переименовать ключи на новые.
- `frontend/admin/__tests__/ClientsPage.test.tsx` (3 refs)
- `frontend/admin/__tests__/ClientsIntegration.test.tsx` (5 refs)
- `frontend/admin/__tests__/ClientInfoTab.test.tsx` (2 refs — `lastVisit` → `lastRecord` в mockStats)
- `frontend/admin/__tests__/ClientCardModal.test.tsx` (3 refs)
- `frontend/admin/__tests__/helpers/mockData.ts` (3 поля) — `visits_count`/`last_visit`/`missed_visits` → новые
- `frontend/admin/__tests__/helpers/mockContexts.ts` (4 поля) — `min_visits`/`max_visits`/`missed_from`/`missed_to` defaults → `min_records`/`max_records` as-is rest
- `frontend/admin/__tests__/ClientsFilters.test.tsx` (8 refs в lines 97,106,191,202,205,213,216,223) — bindings к `min_visits`/`max_visits` → новые; label asserts `"Визиты"` → `"Записи"`.

### E2E
- `frontend/admin/e2e/clients.spec.ts:74-75` — ассерты на `'Кол-во визитов'`/`'Последний визит'` → `'Всего записей'`/`'Последняя запись'`.

### TDD подход (issue-специфичный)
T1 (backend) — пишет сначала новые RED-тесты `test_records_count_renamed`, `test_missed_records_uses_record_status` (проверка: missed_records основан на `Record.status='missed'`, НЕ на `Visit.status='missed'`), `test_last_record_uses_activity_start` (проверка: last_record основан на `MAX(Activity.start)`, без фильтра статуса) → green → остальные backend-тесты переименовываются в рамках того же task.

T2-T4 — фронтовый rename-рефактор, TDD через обновление существующих unit-тестов (RED на старых ключах → GREEN на новых). Новых Vue/юзер-сценариев нет — старые покрывают те же свойства с новыми именами.

---

## §5 Migration — БД НЕ нужна

- `Record.status` уже персистится и backfilled миграцией `4d5e6f7a8b9c` (PR #135) — 4-step UPDATE: visited → missed → cancelled → waiting. Все CRUD-пути вызывают `recompute_record_status()`.
- **No alembic migration** в #131.
- localStorage — **без миграции** (pre-prod, старые ключи молча проигнорируются, сброс через ColumnPicker).

### Defense-in-depth Checks
- `Record.status` model (line 23): `String(20)`, NOT nullable, без default. Каждый CRUD-путь явно задаёт `status` через `recompute_record_status()`. Проверка в T1 тест-кейсом: create record без visits → `status = 'waiting'`, `missed_records` не увеличивается.
- Edge case: client со всеми отменёнными записями (все `Record.status='cancelled'`) → `missed_records = 0`, `last_record` = MAX(Activity.start) самой поздней отменённой. Это корректно по новой семантике.

---

## §6 Domain rules doc — обновить

`docs/domain-rules/clients.md`:
- Line 20: `visits_count, total_paid, etc. → records_count, total_paid, etc.`
- Line 26: `visits_count, last_visit, total_paid, missed_visits` → `records_count, last_record, total_paid, missed_records`
- Line 27: `last_visit = MAX(Activity.start) over Visit rows where Visit.status='visited'` → `last_record = MAX(Activity.start) over all active Records of this client (no status filter)`
- Line 30: `Sort columns: name, visits_count, last_visit, total_paid, missed_visits, created_at, updated_at` → `name, records_count, last_record, total_paid, missed_records, created_at, updated_at`
- Добавить pomette: `missed_records = COUNT(Record.id) WHERE Record.status='missed' AND Record.is_active=True` (полагается на `Record.status` — см. record-derivation в `docs/domain-rules/records.md`).

---

## §7 Scope — IN / OUT

### IN
- 3 backend-поля (schema `ClientWithStats` + 3 SQL subqueries + sort_column_map keys + response mapping)
- 2 параметра API: `min_visits`/`max_visits` → `min_records`/`max_records` (semantics + name)
- Zod-схема + type
- ClientsTable (columns, rendering)
- ClientInfoTab, ClientRecordTab, ClientTab (ActivityDetailsModal), ClientStatistics (prop interface + mapping)
- ClientsContext, ClientsFilters (param names + UI labels)
- UI-тексты: `"Всего записей"`, `"Последняя запись"`, `"Записи"` (filter group)
- Все тесты (backend unit + frontend unit + E2E) обновлены
- `docs/domain-rules/clients.md` обновлён

### OUT
- #133 (last_record_activity — upcoming booking — отдельный issue, добавит новое поле)
- Новые E2E scenarios (существующие просто меняют текстовые ассерты)
- Backend `active_records()` helper (общий `is_active` фильтр — #105 pomette, OUT)
- Any refactor of `compute_record_status` Python-логики (domain untouched — #98 finalized)
- `missed_from`/`missed_to` rename (оставлены as-is — нейтральное «пропущенные»)
- Schema migrations (Record.status backfill уже в #135)
- Schedule grid / `['activities']` cache domain

---

## §8 User Scenarios → E2E tests

Каждый scenario — существующий E2E с обновлёнными ассертами (переименование в `clients.spec.ts`), либо расширение существующего маркера.

| # | Сценарий | Покрытие |
|---|----------|----------|
| US-1 | Администратор открывает страницу клиентов и видит колонку «Всего записей» с числом записей каждого клиента (вместо «Кол-во визитов»). | `e2e/clients.spec.ts:74` — ассерт на `'Всего записей'` |
| US-2 | Администратор видит колонку «Последняя запись» с датой последнего (по `Activity.start`) мероприятия, на которое клиент был записан — даже если клиент отменил или пропустил эту запись. | `e2e/clients.spec.ts:75` — ассерт на `'Последняя запись'` |
| US-3 | Администратор сортирует клиентов по «Всего записей» (desc) — порядок соответствует количеству записей. | `ClientsTable.test.tsx` sort test → `sort_by='records_count'` |
| US-4 | Администратор фильтрует клиентов с «Записей: от 5» → ожидает клиентов с `records_count >= 5` (вместо старого `min_visits`). | `ClientsFilters.test.tsx` — bindings + label `"Записи"` |
| US-5 | Администратор видит в карточке клиента статистику «Всего записей», «Пропущено», «Последняя запись» (camelCase props в `ClientStatistics`). | `ClientInfoTab.test.tsx` + `ClientCardModal.test.tsx` — mockStats с новыми ключами |
| US-6 | Client с 1 visited-записью и 1 missed-записью (Activity.start позже) → `records_count=2`, `missed_records=1`, `last_record = MAX(Activity.start)` (та, что позднее по дате, даже если missed). | `test_client_stats.py` — `test_last_record_uses_activity_start` (TDD anchor) |
| US-7 | Client со всеми отменёнными записями → `missed_records=0`, `last_record = MAX(Activity.start)` самой поздней отмены. | `test_client_stats.py` — edge case test |

---

## §9 Visual Compliance Checks

Специфичные UI-маркеры для автоматизированной проверки (Step 4.5 в workflow).

- [ ] На странице `/clients` заголовок таблицы содержит «Всего записей» (не «Кол-во визитов»)
- [ ] На странице `/clients` заголовок таблицы содержит «Последняя запись» (не «Последний визит»)
- [ ] В фильтрах клиентов группа «Визиты» переименована в «Записи»
- [ ] В карточке клиента (ClientCardModal) секция статистики отображает новые подписи (если подписи менялись в `ClientStatistics.tsx`)
- [ ] Сортировка по «Всего записей» работает (`sort_by=records_count` в query param)

---

## §10 Open Risks

| Риск | Mitigation |
|---|---|
| Backend-frontend рассинхрон в окне между T1 (backend merge) и T4 (frontend E2E) | Approach A: один PR, T1→T2-T4 sequential. Промежуточные коммиты в worktree-ветке — E2E временно красные между T1 и T4, финально зелёные. |
| `Record.status` stale rows (pre-#98) | Устранено миграцией #135 backfill + каждый CRUD вызывает `recompute_record_status`. Подтверждено в recon (ses_094d4c936ffe). T1 тест `test_missed_records_uses_record_status` валидирует логику. |
| Существующий E2E clients.spec.ts:74-75 падает на старых текстах | T4 обновляет ассерты одновременно с UI label changes — atomic. |
| `last_record` семантический сдвиг ломает существующий UI-dates test (old: visited-only → new: all records) | T1 обновляет backend-тест `test_last_record_*` с новой семантикой. Frontend `ClientsTable.test.tsx` mock-data имеет `last_visit: '2026-05-15T14:00:00'` — после переименования `last_record` просто меняет ключ в mock-фабрике. Дата hasn't changed in mock (1 visited record), остаётся зелёным. |