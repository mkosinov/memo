# Audit Log — Domain Rules

## Description

AuditLog — append-only журнал действий пользователей (кто, что и когда менял в системе). Строки пишет исключительно аккумулятор внутри `@transactional` (спека GH #344 §4); через API журнал доступен только для чтения — write-эндпоинтов нет. Read-side контракт несут два admin-only маршрута (лист ниже). До этого канона контракт чтения жил только в спеках #344/#371 — файл закрывает разрыв (GH #488).

## Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string(36) UUID | ✅ | uuid4 | PK |
| created_at | datetime | ✅ | now() | Момент действия (indexed) |
| user_id | string(36) | ❌ | null | Автор; FK `users.id` **ON DELETE SET NULL** (indexed) |
| user_role | string(20) | ✅ | — | **Снимок роли на момент действия** (later promotions do not rewrite history) |
| action | string(24) | ✅ | — | Действие (indexed): create / update / patch / delete / archive / restore / reorder / password_link_issued |
| entity | string(32) | ✅ | — | Каноническое имя сущности (GH #239): records, clients, payments, … |
| entity_id | string(36) | ❌ | null | null для reorder |
| entity_label | string(255) | ✅ | — | Человекочитаемая подпись строки сущности |
| changes | JSON | ❌ | null | Снимок изменённых полей |

Модель нарочно построена напрямую на `Base` (НЕ `AbstractModel`): нет `updated_at`, нет soft-delete флага, не объявлено ни одной связи — никакие каскадные записи/удаления не могут тронуть журнал.

## Invariants

- **Append-only:** приложение никогда не обновляет и не удаляет строки журнала; API не имеет POST/PUT/PATCH/DELETE.
- **Снимок роли:** `user_role` — роль в момент события, не текущая `users.role`.
- **Удаление автора не блокируется:** `user_id` ON DELETE SET NULL — ссылка обнуляется (`{id: null, label: null}`), строка остаётся.
- **Нет N+1:** автор-подпись резолвится в том же запросе (users ⟕ staff), отдельные запросы на строку запрещены.

## Business Logic

### Backend

- **Корридор 3** (`service-layer.md` правило 8): у журнала нет сервис-класса и репозитория — свободные функции чтения в `backend/src/services/audit_log.py`; транзакций нет (поверхность никогда не пишет).
- **Фильтры списка** — конъюнктивные, каждый `None` → предиката нет: `user_id` / `action` / `entity` / `entity_id` (`str | None`, журнал хранит свободные строки), период `date_from` / `date_to` (`date | None`) целыми днями — общий `day_range` канон (`date_from` с 00:00:00 включительно, `date_to` до конца дня; та же семантика, что у списков payments/records).
- **Сортировка фиксированная:** `created_at DESC`, тайбрейк `id DESC` — равные метки времени стабильны между страницами. Переключение сортировки вне рамок v1 (спека #344 §7).
- **Пагинация:** кирпич `PaginationParams` — `page ≥ 1` (дефолт 1), `per_page 1–100` (дефолт 20).
- **`?id=` сужение (GH #232/#371 §4.3 gap 3):** повторные query-ключи, только UUID (мусор → 422), ≤100 после дедупа (общий `MAX_LIST_IDS`; сверх → 422 `too_long`), типизированное `id IN (…)` через `ids_in_predicate`. Конъюнктивно с фильтрами и применяется ДО count — `items`/`total` сужаются согласованно; сужение никогда не расширяет видимость (валидный id вне фильтров → 200 + пусто).
- **Форма входа #371 §4.1:** одна модель `AuditLogListParams(PaginationParams)` как `Annotated[..., Query()]` — скалярные query-соседи запрещены (fastapi PR #12481).
- **`total`** всегда отражает отфильтрованное множество (count по неупорядоченному подзапросу) — никогда глобальную мощность.
- **Подпись автора** (`label`): «Фамилия Имя» связанной карточки сотрудника; аккаунт без карточки → телефон (цепочка всегда разрешима); обнулённый `user_id` → `{id: null, label: null}`.
- **`GET /audit-logs/authors`:** только авторы, реально присутствующие в журнале (INNER join по журналу), `GROUP BY User.id`, сортировка по label — стабильный дропдаун; пустой журнал → `[]`.

### Frontend

- Раздел «Журнал» админки (`/audit`) — стандартная таблица + панель фильтров по образцу клиентов (спека #344 §7): Автор (дропдаун из `/authors`), Действие, Сущность, период `date_from`/`date_to`, сброс.
- **URL-состояние** через общий `useTableUrlState` (прецедент staff, GH #349 Task 9): `user_id`/`action`/`entity`/`date_from`/`date_to` + `page`/`per_page`. Сортировка серверно-фиксированная — sort-параметров в URL нет. Период по умолчанию «не задано» (оба null — журнал не несёт неявного диапазона, отличие от текущей недели records). `per_page` 10/20/50/100, дефолт 20.
- Пустой журнал → пустой дропдаун авторов (остаётся плейсхолдер «Все авторы»).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/audit-logs | Страница журнала: конъюнктивные фильтры `user_id`/`action`/`entity`/`entity_id`/`date_from`/`date_to` + пагинация + `?id=` сужение; фикс. `created_at DESC` — GH #344 §6, форма входа #371 §4.1 |
| GET | /api/v1/audit-logs/authors | Отличные авторы журнала `[{user_id, label}]` для дропдауна фильтра — GH #344 §6 |

**Доступ:** оба маршрута admin-only (`require_admin` на роутере): master → 403, аноним → 401 (спека #344 §6).

## Relationships

- AuditLog → User (`user_id`, nullable, ON DELETE SET NULL) — единственная связь; каскадов нет ни в одну сторону.

## Enums & Constants

| Константа | Значения |
|-----------|----------|
| action | create, update, patch, delete, archive, restore, reorder, password_link_issued (ширина 24 — #348 расширил 16 → 24 под password_link_issued) |
| entity | 16 канонических имён GH #239 (records, clients, payments, …) — словарь фронтенда `auditLabels.ts` зеркалит порядок |

## Acceptance Criteria

- [ ] Журнал через API только читается (write-эндпоинтов нет)
- [ ] Сортировка всегда `created_at DESC` (+ `id DESC` тайбрейк)
- [ ] `total` = мощность отфильтрованного множества
- [ ] master → 403, аноним → 401 на обоих маршрутах
- [ ] `?id=` мусор → 422, >100 → 422, вне фильтров → 200 + пусто

## Sources

Спеки: `docs/specs/2026-09-20-audit-log-344-design.md` (§4–§7), `docs/specs/2026-10-10-list-id-uniform-371-design.md` (§4.1, §4.3 gap 3). Реализация: `backend/src/api/v1/audit_logs.py`, `backend/src/schemas/audit_log.py`, `backend/src/services/audit_log.py`, `backend/src/models/audit_log.py`; фронт: `frontend/admin/app/(main)/audit/` (таблица, фильтры, URL-состояние).
