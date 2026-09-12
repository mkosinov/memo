# Staff — Domain Rules (#266)

Реструктуризация #266: таблица `masters` переименована в `staff` (карточка каждого сотрудника), мастера — новая таблица `master` (расписание), должности — словарь `positions` (зарплата). Спека: `docs/specs/2026-09-10-staff-restructuring-design.md`.

## Naming Convention (CRITICAL)

- **`Staff`** — сотрудники (все) в коде: модель/таблица, схемы, сервисы, роуты `/api/v1/staff`, фронт (StaffTable, useStaff, StaffContext).
- **`Master`** — только мастер-расписание: таблица `master` (staff_id, specialty, color, is_active), FK-колонки `master_id` (activities, master_tags), `/api/v1/masters` (только чтение), ключи записей `master_name`/`master_color`, строки UI «Мастер». Слово «ведущий» в UI не появляется — «Мастер» остаётся как есть.
- **`Position`** — должности: таблица `positions`, M2M `staff_positions`, `/api/v1/positions`. Смысл — расчёт зарплаты (будущий модуль); к расписанию и доступам не привязаны.
- ❌ Artist, Employee, Worker, Teacher — НЕ ИСПОЛЬЗОВАТЬ.

## Description
Staff — карточка каждого сотрудника студии (мастера, администраторы, СММ, …). Master — расписание ведущих: специальность + цвет + участие в расписании; ровно одна строка на мастера (1:0..1 от staff), управляется секцией «Мастер» в карточке сотрудника, независимо от должностей.

## Три независимых флага (решение #266, D3)

| Флаг | Смысл | Что отключает |
|---|---|---|
| `staff.is_active` | архив человека (уволен) | активный справочник сотрудников |
| `master.is_active` | распределение (расписание) | фильтр мастеров, `/api/v1/masters`, выбор мастера в новом занятии |
| `users.is_active` | разрешён ли вход | вход учётки |

Скрытых каскадов между флагами нет — только явные чекбоксы (ниже). Действующий мастер = `master.is_active = true`. Состояние «человек в архиве, но мастер активен» — штатное (кейс «уволен, досиживает оставшиеся занятия»): администратор осознанно оставил галку. История не рвётся: архивная master-строка хранит специальность и цвет для старых записей и статистики.

## Fields

**staff** (бывш. `masters`; id и строки сохранены при миграции, включая m1…m7):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (UUID) | ✅ | Unique identifier (значения прежних masters) |
| first_name | string(100) | ✅ | Имя |
| last_name | string(100) | ✅ | Фамилия |
| avatar_url | string | ❌ | Портрет: `/api/v1/files/avatar/<uuid>.<ext>` (#262) или legacy внешний URL |
| sort_order | int | ✅ | Порядок в списках сотрудников и мастеров |
| is_active | bool | ✅ | Архив человека (см. флаги) |

**masters** (новая; конвенция проекта — множественные имена таблиц, Python-класс `Master`, `__tablename__ = "masters"` — SSE-имя сущности не меняется): `staff_id` — PK + FK staff.id **ON DELETE CASCADE**, unique (ровно одна строка на мастера; значение = прежний id мастера); `specialty` — CSV («живопись, керамика»), **Text**, обязателен; `color` — HEX string(7), обязателен; `is_active` — распределение.

**positions** (новая): `id` — фиксированные строки `master`/`admin` для встроенных (uuid для пользовательских); `title` — отображаемый текст, редактируется свободно; `is_system` — встроенная, удаление запрещено. Seed: «Мастер», «Администратор» (встроенные), «СММ» (пользовательская).

**staff_positions** (новая M2M): staff_id + position_id — у сотрудника несколько должностей (чекбоксы в карточке).

## Сценарные операции (решение #266, D6 — без скрытых эффектов)

- **Увольнение** (`POST /staff/{id}/archive`): чекбоксы в теле, предвыбранные: `archive_master` (показывается только при живой активной master-строке), `archive_user` (при наличии учётки). Снял галку — связь осталась, см. флаги.
- **Создание карточки** (`POST /api/v1/staff`): флаги «создать учётку (телефон + пароль)» и «сделать мастером (специальность + цвет)».

## API Endpoints

**`/api/v1/staff`** — полный справочник:
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/staff | Paginated list — `?status=active` (default) \| `archived` \| `all` |
| GET | /api/v1/staff/all | Bare array (no envelope), parity с пагинированным |
| GET | /api/v1/staff/{id} | Get by ID (включая архивных) |
| POST | /api/v1/staff | Создание карточки (+ флаги учётки/мастера, D6) |
| PUT | /api/v1/staff/{id} | Update (карточка, должности, мастер-секция) |
| PATCH | /api/v1/staff/{id} | Partial update |
| DELETE | /api/v1/staff/{id} | Hard delete with resolutions (GH #207 контракт сохраняется) |
| POST | /api/v1/staff/{id}/archive | Архив с чекбоксами `{archive_master, archive_user}` (default true) |
| POST | /api/v1/staff/{id}/restore | Возврат из архива |

`PUT /reorder` не переносится с мастеров (reorderMasters никем не вызывается; `sort_order` остаётся колонкой дефолтного порядка). Сортировка списка: `sort_by` = name, specialty, color, avatar, status — **position исключена** (M2M, неоднозначно); specialty/color через LEFT JOIN на masters, пустые — в конце.

**`/api/v1/masters`** — только чтение (действующие мастера, `masters.is_active = true`; для расписания и клиентского сайта #48): GET (пагинированный), GET /all. Мутации и GET /{id} удалены (потребителей нет) — работу забирает карточка сотрудника.

**`/api/v1/positions`** — CRUD словаря должностей: встроенные (`is_system`) не удаляются, title редактируем.

## List contract (GH #205 — переезжает с /masters на /staff)

- Paginated `GET /api/v1/staff`: `page` (≥1), `per_page` (1-100, default 20), `status` (active|archived|all, default active), `sort_by` (Literal whitelist: `name, specialty, color, avatar, status`; position исключена — M2M), `sort_order` (asc|desc). Default order: `sort_order ASC, first_name ASC, id ASC`.
- Bare `GET /api/v1/staff/all`: без конверта, `BARE_LIST_MAX_ROWS` guard сохраняется.
- Consumers: таблица сотрудников = server-paginated; выпадающие списки = `/all`.
- Search `?q=` (GH #212): substring по `first_name` + `last_name` (каждое отдельно) + exact `id` при полном UUID — прежний контракт мастеров, теперь на staff.

## Relationships
- Staff → 0..1 Master (расписание; master.staff_id unique)
- Staff → 0..1 User (учётка; `users.staff_id` — бывш. `master_id`)
- Staff ↔ Positions (M2M staff_positions)
- Master → has many Activities (`activities.master_id` → master.staff_id), has many Tags (M2M `master_tags`)

## Response field: `archived` (inverted)
Response-схемы staff и master exposing `archived: bool` вместо `is_active` (инверсия в сервисе) — прежний паттерн всех archive-aware сущностей. См. `_overview.md` → «Archive terminology boundary».

## Мастер-секция: `archived` в payload (T8)
`MasterSection` в POST/PUT/PATCH принимает опциональное `archived: bool | None`:
- `null`/отсутствует — флаг `masters.is_active` не трогается (upsert существующей строки сохраняет её текущее состояние; новая строка создаётся активной);
- `true` — секция архивируется: `masters.is_active = false`, строка НЕ удаляется (D7 — история хранит имя/цвет), из `/api/v1/masters` пропадает;
- `false` — возврат в действующие (восстанавливает прежние специальность/цвет из payload).

Удаление секции остаётся только явным `master: null` (заблокировано занятиями, D7).

## Response field: `has_user` (T8)
`StaffResponse.has_user: bool` — наличие учётки: существует ЛЮБАЯ строка `users` со `staff_id` (без учёта `is_active`). Заархивированная учётка тоже считается наличием — чекбокс D6 «Архивировать учётку» показывается «при наличии учётки», а применяется только к активной связи (логика карточки фронта).

## Archive & delete semantics (GH #207 + #266)

Staff — archive-aware сущность (одна из 5). PUT/PATCH не принимают `is_active`; архив только через POST /archive + POST /restore.

### Staff FK dependencies (DELETE `/{id}`)

| Relation | Nullable? | Action | User choice? |
|---|---|---|---|
| **activities** (через masters-строку) | NOT NULL | **block** | N/A — `allowed_actions: []`; занятие нельзя оставить без мастера |
| **masters** (1:0..1) | — | **cascade** (auto, ON DELETE CASCADE на FK) | auto — при отсутствии занятий masters-строка удаляется вместе с карточкой |
| **users** (staff_id) | nullable | **cascade** (auto) | auto — учётка hard-deleted в той же транзакции (профиль без учётки = сирота; прежнее правило мастеров) |
| **master_tags** (join) | NOT NULL PK | **cascade** (auto) | auto |
| **staff_positions** (join) | NOT NULL PK | **cascade** (auto) | auto — связи должностей сносятся с карточкой |

### Архив: чекбоксы вместо авто-каскада (замена GH #207 §4.2)
Прежний авто-каскад «архив мастера гасит учётку» заменён явными чекбоксами увольнения (D6): `archive` на staff применяет `archive_master`/`archive_user` (default true) одной транзакцией. Архив master-строки из секции «Мастер» (без увольнения человека) НЕ каскадит ничего — только распределение (D3). Restore staff возвращает человека; учётка/мастер возвращаются своими флагами явно.

## Self-edit via /my (#262)
Связанный пользователь редактирует свою карточку (имя, фото, специальность мастера) через `PUT /api/v1/my` — спека #262 перепишется под staff-словарь после #266 (задача плана #266, после мержа #247).
