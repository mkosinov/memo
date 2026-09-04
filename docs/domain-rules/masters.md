# Masters — Domain Rules

## Naming Convention (CRITICAL)

**В коде используем ТОЛЬКО слово "Master" (Мастер).**

- ❌ Artist — НЕ ИСПОЛЬЗОВАТЬ
- ❌ artistId, artistName — НЕ ИСПОЛЬЗОВАТЬ
- ✅ Master, masterId, masterName

Это правило распространяется на:
- Backend: модели, схемы, API эндпоинты
- Frontend: компоненты, хуки, типы, переменные
- Domain package: типы и схемы

## Description
Мастера — сотрудники студии, которые проводят мастер-классы. Каждый мастер имеет специализацию и цвет для отображения в расписании.

## Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (UUID) | ✅ | Unique identifier |
| first_name | string(100) | ✅ | Имя |
| last_name | string(100) | ✅ | Фамилия |
| color | string(7) | ✅ | HEX color for schedule (e.g. #FF5733) |
| position | enum | ✅ | "мастер" or "администратор" |
| specialty | enum | ✅ | "живопись" or "керамика" |
| avatar_url | string | ❌ | URL to avatar image |

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/masters | List records — `?status=active` (default) \| `archived` \| `all` |
| GET | /api/v1/masters/{id} | Get master by ID |
| POST | /api/v1/masters | Create master |
| PUT | /api/v1/masters/{id} | Update master |
| PATCH | /api/v1/masters/{id} | Partial update |
| DELETE | /api/v1/masters/{id} | Hard delete with resolutions (no body + 0 deps → 204; no body + deps → 409 dry-run; body `{"resolutions": {...}}` → 204 on success / 422 on invalid) — spec GH #207 |
| POST | /api/v1/masters/{id}/archive | Archive (sets `archived: true`, HTTP 200 with body; **cascades to linked user `is_active=False`**) — GH #207 §4.2 |
| POST | /api/v1/masters/{id}/restore | Restore (sets `archived: false`, HTTP 200 with body; **cascades to linked user `is_active=True`**) — GH #207 §4.2 |

## List contract (GH #205)

- **Paginated `GET /api/v1/masters`**: `page` (≥1), `per_page` (1-100, default 20), `status` (active|archived|all, default active), `sort_by` (Literal whitelist: `name, specialty, position, color, avatar, status`; 422 on unknown), `sort_order` (asc|desc, default asc). Default order: `sort_order ASC, first_name ASC, id ASC` (spec §4.4).
- **Bare `GET /api/v1/masters/all`**: bare JSON array (no envelope), `status` parity with paginated, deterministic order = same default. Protective `BARE_LIST_MAX_ROWS = 1000` → 422 English error naming entity + paginated endpoint (spec §4.3).
- **Consumers**: Masters table = server-paginated via `MastersContext`; dropdowns/lookup maps (Records/Schedule/useMasters/useRecordData/Menubar) = `/all` (spec §5.5).
- **Search matrix (spec §6)**: **list `?q=` (GH #212) is the delivered contract** — substring on `Master.first_name` + `Master.last_name` (each field ilike'd separately, no cross-field concatenation), plus exact `Master.id` equality when `q` parses as a full 36-char UUID. `q: str | None` declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. The per-entity search-fields matrix lives in `MasterService.search_fields` (`src/services/master.py`). Dictionary form dropdowns still consume `/all` directly via `getAllMasters` (#214 combobox; client filter over the bare array); form/filter dropdowns (GH #214 Combobox) display masters as `displayMasterName` — «Фамилия Имя» — with client-side instant filter over the bare `/all` array (substring, case-insensitive, either word matches).

## Relationships
- Master → has many Activities
- Master → has many Tags (M2M via master_tags)
- Master → has one **User** (login account; `users.master_id` is nullable — column `/users/master_id` references `masters.id`)

## Response field: `archived` (inverted)
The Response schema exposes `archived: bool` instead of `is_active` (inversion: `archived = true` = in archive = `is_active = false`). The DB column stays `is_active`; `MasterService` applies the inversion. See `_overview.md` → "Archive terminology boundary".

## Archive & delete semantics (GH #207)

Master is one of the 5 archive-aware entities. PUT/PATCH no longer accept `is_active` (auto-closes #178); archive/restore only via `POST /archive` + `POST /restore`. See `_overview.md` → "Archive terminology boundary" for the general rule and "Hard-delete FK dependency matrix" for the full matrix.

### Master FK dependencies (DELETE `/{id}`)

| Relation | Nullable? | Action | User choice? |
|---|---|---|---|
| **activities** (master_id) | NOT NULL | **block** | N/A — `allowed_actions: []`. Activity has no `is_active`, cannot be archived; user must remove activities manually OR archive the master. |
| **users** (master_id) | nullable | **cascade** (auto) | auto — no choice (§4.1, Change 2). The linked user row is **hard-deleted** automatically in the same resolution transaction. Rationale: User is the login account, Master is the profile; deleting the profile but keeping the account = orphan. |
| **master_tags** (join) | NOT NULL PK | **cascade** (auto) | auto — join table rows deleted automatically. |

- **DELETE `/{id}` (no body):** zero deps → 204 hard delete (row gone). Any dep → 409 + dependency tree (counters + sums only, no rows modified). `activities` present → 409 with `allowed_actions: []` (blocks DELETE; only archive is offered).
- **DELETE `/{id}` (with body `{"resolutions": {...}}`):** validates against the matrix; required resolution for non-auto deps (Master has none — both `users` and `master_tags` are auto); executes **nullify → cascade → hard delete** in ONE transaction → 204. Blocked (`activities` present) → 422 always ("entity has blocking dependencies — archive instead").

### Master → users cascade (special case, Master-only)

**Delete cascade (§4.1, Change 2):** deleting a Master with a linked `users` row hard-deletes the user row automatically (auto-cascade, like `master_tags`). No user choice. The row is physically removed from `users`. The ONLY non-join auto-cascade besides Service→tariffs. The frontend delete dialog shows "→ Пользователь: N (удалён)" so the user sees the account going.

**Archive/restore cascade (§4.2, Change 3):** `MasterService.archive(id)` patches `master.is_active=False` AND `user.is_active=False` (where `users.master_id == master.id`) in ONE transaction — the user can no longer log in. `MasterService.restore(id)` patches both back to `True` — the user can log in again. Master-only — Location/Service/Material/Client archive/restore is a single-row `is_active` flip with NO cross-entity write. This is an archive-cascade (sets `is_active`), NOT a delete cascade (DELETE Master→users is the §4.1 hard-delete variant). Scope: a deliberate Master-specific override on `MasterService`, NOT generic `ArchiveService` behavior.
