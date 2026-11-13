# Specialty — Domain Rules (Направление)

## Description
Направление студии («живопись», «керамика») — запись справочника. Услуга ссылается ровно на одно направление (обязательно), сотрудник (master-секция) — на несколько (M2M, при живой секции обязателен ≥1 — D5). Появлен в GH #599 вместо свободного текста `services.specialty` / `masters.specialty`. Спека: `docs/specs/2026-11-13-specialty-dictionary-599-design.md`.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| title | string | ✅ | 1 | 100 | — | Название направления; при записи нормализуется (trim, схлопывание внутренних пробелов, NFC), пустое/пробельное → 422 |

## Invariants
- **Уникальность без учёта регистра**: функциональный уникальный индекс по `lower(title)` (в миграции пишется вручную — автогенерат выражение-индекс не выносит) — «Живопись» и «живопись» не могут существовать одновременно (мотивация #599). Коллизия при create/rename → 409 `SPECIALTY_TITLE_TAKEN`, определяется поимкой `IntegrityError` индекса (SELECT-предпроверка — только UX-быстрый путь); переименование в собственный регистровый вариант — успех.
- Hard-delete семейство (`AbstractModel`, как Теги/Должности); archive/restore нет.
- **Публичного чтения нет** — сущность внутренняя; публичная выдача и гарды словарей — волна GH #606 (после v1).

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/specialties | Paginated list (кирпич GH #205), **без `sort_by`** — фиксированный порядок `title ASC, id ASC`; своих фильтров и `?q=` нет (как у позиций) |
| GET | /api/v1/specialties/all | Bare array; `BARE_LIST_MAX_ROWS = 1000` → 422; источник дропдаунов |
| POST | /api/v1/specialties | Create |
| PATCH | /api/v1/specialties/{id} | Rename |
| DELETE | /api/v1/specialties/{id} | Семейный контракт удалений (#324-семья) — см. Delete semantics |

## List contract (GH #205)
- Paginated `GET /api/v1/specialties`: `page` (≥1), `per_page` (1-100, default 20); entry form — одна модель `SpecialtyListParams(PaginationParams)` как `Annotated[..., Query()]`; своих фильтров нет.
- Bare `GET /api/v1/specialties/all`: без конверта, guard `BARE_LIST_MAX_ROWS`.
- Consumers: вкладка «Направления» на странице услуг (третий вид по образцу «Материалов»: свой URL-state с префиксом, свой провайдер, монтируется только видимый вид; видна при `specialties:read`) = server-paginated; дропдауны услуг и чекбоксов сотрудников = `/all`.

## Delete semantics (GH #599)
- Маршрут — зеркало позиционного (#324-семья: порядок форма → probe (404) → dry_run/commit; голый DELETE/тело при dry_run → 422). Семантика зависимостей — **не** позиционная:
- **services** — видимая **блокирующая** (`allowed_actions: []`): занято услугами → 409 `has_dependencies`, узел «Услуги: N»; **в счётчик входят все услуги, включая архивные** (превью совпадает с RESTRICT по всем строкам; услуга без направления недопустима — FK `ondelete=RESTRICT`).
- **staff_specialties** — **auto-cascade** (образец — материалы GH #207): commit `{"resolutions": {}}`, карточки сотрудников переживают.
- Свободная запись — лист: dry_run 204, commit `{expected: {}}`.
- Гарды — зеркало позиционного роута поимённо: `_READ_GUARD = require_permission("specialties:read")`; `_WRITE_GUARD` = permission `specialties:write` + `verify_fetch_metadata` (CSRF).

## Relationships
- Service → `specialty_id` (FK, NOT NULL, ondelete=RESTRICT, **явный индекс** на колонке — FK не индексируется автоматически; нужен сортировочному JOIN и проверке RESTRICT).
- Staff (master-секция) ↔ Specialty — M2M `staff_specialties`: **составной PK `(staff_id, specialty_id)`**, оба FK CASCADE, `passive_deletes=True`, **дополнительный индекс по `specialty_id`**.
- **Формат отображения**: вход по id; в ответах строковые поля отображения сохраняются — `ServiceView.specialty: str` (название), master-секция `specialty: str` (названия через «, », по алфавиту) + `specialty_ids`. Списки догружают без N+1: услуги — `joinedload` (many-to-one), сотрудники — `selectinload` (M2M).
- **Входные наборы**: `specialty_ids` — hard-replace; дубликаты дедуплицируются, после дедупа >50 → 422; неизвестный id → 422. D5: живая мастер-секция обязана нести ≥1 направление (422 `SPECIALTY_REQUIRED` — без ослабления, GH #266).
- **`/my`**: `MyProfileUpdate.specialties` — «принимается-но-игнорируется» (D5, как сегодня); набор пишут только админские staff-маршруты.
- **Сортировка**: services `sort_by=specialty` → JOIN по `Specialty.title`; staff `sort_by=specialty` → **отображаемая строка направлений** — корреляционный скалярный подзапрос `string_agg(title ORDER BY title, ', ')` (то же выражение, что формирует ответ; не GROUP BY — совместимо с `apply_sort`/пагинацией), `always_nulls_last` (нет master-секции — в конце). Ключи whitelist не переименовывались — URL-state совместим; выражение живёт в `domain/sorting.py` (локальные резолверы запрещены).
- **Копирование недели** (activities.md): ремап архивного мастера — пересечение направлений по id связей (не по тексту). Следствие auto-cascade: удаление направления отвязывает и архивных мастеров — будущие ремапы видят только живые связи (раньше текст CSV переживал всё).
- **Аудит**: снапшоты несут название вместе с `specialty_id` — переименование не перезаписывает смысл исторических записей.
- **Сид/предзагрузка**: `seed-data/specialties.yaml` (список названий), upsert по `lower(title)`; `services.yaml`/`staff.yaml` ссылаются по названию, резолв без учёта регистра (неизвестное название → ошибка с именем значения; старый CSV-ключ `specialty` в staff.yaml → ошибка). `_apply_specialties` принимает список названий независимо от формата файла — переход загрузчика на CSV (GH #612) меняет только парсер.
