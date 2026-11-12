# Photo — Domain Rules

## Description
A Photo is an image file (filename only — file storage is external) owned by at most ONE of Client | Service | Activity | Location (GH #211 4-owner model). Owner-less photos are allowed. Photos may be public (shown in galleries) and tagged for filtering.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| filename | string | ✅ | — | — | — | File path / key in storage |
| client_id | string | ❌ | — | — | null | FK to Client (owner slot) |
| service_id | string | ❌ | — | — | null | FK to Service (owner slot) |
| activity_id | string | ❌ | — | — | null | FK to Activity (owner slot) |
| location_id | string | ❌ | — | — | null | FK to Location (owner slot; standalone location gallery) |
| is_public | boolean | ❌ | — | — | false | Visible in public gallery |
| tag_ids | array | ❌ | — | — | [] | IDs тегов (M2M) |

Response-only field: `client_name` (nullable, denormalized on GET /api/v1/photos list via scalar subquery; resolves for archived clients). `visitor_id` was dropped (GH #211).

## Cross-field Rules
- At most ONE of `client_id | service_id | activity_id | location_id` may be non-null:
  - POST/PUT: payload validator → 422 on ≥2 owner FKs in one payload (English detail).
  - PUT/PATCH: service-level MERGED-set check (stored row + applied payload) → 422 on ≥2 owners at rest (closes the `exclude_unset` hole).
  - DB-level CHECK constraint `ck_photos_single_owner` as defense-in-depth for writes bypassing the API.

## Invariants
- Photos are hard-deleted (row physically removed). Photo is a general resource — on owner deletion (Client/Service/Activity/Location), the photo's owner FK is set to NULL (photo survives, becomes owner-less); the photo is never deleted by cascade. Own deletion — единый флоу (спека #324): `photo_tags` — видимая зависимость (теги отвязываются, чистое фото ведёт себя как лист), `?dry_run=true` → 409-превью у тегированных, кольцо 5 с, коммит `{expected: {photo_tags}}`/`{expected:{}}`.
- Group photos = N independent rows with distinct `client_id` (same filename); copies are created individually via the single-owner modal; no grouping/sync mechanism exists (#224 closed as not-planned).
- Zero owners at rest is legal (parent deletion or direct creation with no owner).
- **PII in filename (#493):** публичные фото-файлы не должны нести PII в имени. `filename` — админский свободный текст: «Иванов.jpg» утечёт на `/api/v1/public/photos` даже после чистки id из ответа (минимальная схема не спасает от самого имени файла). Правило процесса загрузки (указание админам), осознанно БЕЗ валидации в коде в объёме #493.

## Business Logic

### Backend
- **tag_ids:** PUT and PATCH both hard-replace tag links (DELETE all → INSERT new)
  - If tag_ids omitted from PATCH payload → existing tags preserved
- **GET /api/v1/photos list:** server pagination + filters (GH #211):
  - `q` — case-insensitive substring on filename ONLY (min 2 / max 100 chars; does NOT match client names)
  - `client_id` / `activity_id` — direct equality
  - `location_id` — DIRECT equality only (activity-owned photos at that location do NOT match)
  - `service_id` — variant A: direct `service_id` OR via `activity.service_id` (LEFT OUTER JOIN)
  - `is_public` — direct equality, applied only when sent (`None` = no filter); staff-list filter only — the public showcase no longer rides this list: it is a separate anonymous route `GET /api/v1/public/photos` (ADR-015, #493)
  - `tag_id` — repeatable (`?tag_id=a&tag_id=b`), AND semantics (photo must have ALL selected tags); duplicates deduped
  - All filters AND-combine with each other and with q; unknown filter ids → silent empty page (NOT 404)
  - `sort_by` whitelist: `filename | is_public | created_at` (422 on unknown); default `created_at desc` + `id asc` tiebreak
  - Pagination mechanics: repo-owned — photos rides the shared row-core (`BaseRepository.list_custom`, `backend/src/repositories/generic.py`), the former service-owned count+slice exception is retired (GH #213). The module-level free function `list_photos_view` (photo service module, Corridor 3 — GH #217 Task 3 / ADR 007; formerly the `PhotoService.list` method) builds the stmt (multi-column select with the labeled `client_name` + `selectinload(Photo.tags)` + filter predicates + the #263 master-scope EXISTS) and maps Row→`PhotoResponse`; the core computes COUNT on the UNordered stmt and applies ORDER + LIMIT/OFFSET, with ordering passed via its `order_by=` parameter (the `RecordService.list` convention).
- File storage is external (S3-compatible); this entity stores metadata only

### Frontend
- **Галерея деталей занятия в web (#576):** миниатюры = обложка услуги `image_url` (первая миниатюра, главная картинка по умолчанию, при наличии), затем публичные прямые фото услуги, затем публичные фото её занятий (один запрос `GET /api/v1/public/photos?service_id=…`, ≤20); клик по миниатюре ставит её в главную; пусто после allowlist — ряда нет. Видимость владельца не проверяется (контур один — `is_public` фото).
- PhotoGallery public/private toggle
- Bulk upload with tag picker
- Owner slots are mutually exclusive in the UI: picking `activity_id` clears `service_id` and vice versa (no auto-fill)
- Service/location titles resolve client-side via `/all` maps; `client_name` is the only denormalized response field
- Activity display labels use the canonical `formatActivityLabel` convention — see `activities.md` → "Display label convention". #213 (display-lookup composite) will centralize activity display data further — the canonical label is cross-pinned there.

## Master role (#263)

Для роли `master` (спека `docs/specs/2026-09-10-master-role-design.md`): **«своё фото» = фото, привязанное к активности мастера** (`photo.activity_id → activity.master_id = master_key`). Фото клиентов/услуг/локаций и без владельца мастеру не видны (категория «фото своего клиента» отклонена — юзер 10.09). Полный CUD своих фото (filename строкой — загрузки файлов в v1 нет); список `/photos` — только свои; чужие get/мутации → 404. Публичная витрина — отдельный анонимный маршрут `GET /api/v1/public/photos` (ADR-015, #493): мастер видит на нём все публичные фото нескоупленно; скоуп #263 сужает только вход мастера на `/photos` и его point-операции. Витрина отдаёт вариантную публичную схему `PhotoPublicResponse` — теги названиями-строками, без владельческих полей.

Mechanics (T5): the list builder folds in a correlated EXISTS (`EXISTS(activities WHERE activities.id = photo.activity_id AND master_id = master_key)`) — an admin (`master_key=None`) adds no predicate, a master without a masters row matches an empty set. Point ops (get/PUT/PATCH/DELETE) gate via one scope-aware query (photo → activity); foreign/owner-less → the same 404 as missing (404-fast-path). POST/PUT/PATCH validate the TARGET `activity_id` the same way (create with a foreign activity → 404; PUT/PATCH re-target to a foreign activity → 404, photo unchanged); PATCH sending `activity_id: null` detaches the photo (legal for one's own photo). The `service_id` filter's LEFT JOIN path is untouched and AND-combines with the scope.

## API Endpoints
| Method | Path | Params | Description |
|--------|------|--------|-------------|
| GET | /api/v1/photos | `page`, `per_page`, `q` (filename substring, 2–100 chars), `client_id`, `location_id` (direct-only), `activity_id`, `service_id` (variant A: direct OR via activity), `is_public` (bool, only when sent), `tag_id` (repeatable, AND), `sort_by` (`filename` \| `is_public` \| `created_at`), `sort_order` | Paginated list (`PaginatedResponse[PhotoResponse]` envelope with honest total). Staff-only (#493): anon → 401, guard `photos:read` |
| GET | /api/v1/photos/{id} | — | Get. Staff-only (#493): anon → 401, guard `photos:read` |
| GET | /api/v1/public/photos | `page`, `per_page` (capped by the shared list limit), `service_id` (#576) | Анонимная витрина (ADR-015, #493): forced `is_public=true`, sort закреплён сервером (`created_at desc` + `id asc`), минимальная схема `PhotoPublicResponse` (теги — названия-строками, без владельческих полей); envelope `PaginatedResponse[PhotoPublicResponse]`. `service_id` (#576) — объединяющая семантика variant A (прямые фото услуги + фото её занятий), порядок двухгрупповой: сначала прямые фото услуги, затем фото занятий, внутри групп закреплённый; прочие фильтры владельцев не подключены, видимость владельца не проверяется (контур один — `is_public`) |
| POST | /api/v1/photos | — | Create |
| PUT | /api/v1/photos/{id} | — | Full update (filename + is_public required) |
| PATCH | /api/v1/photos/{id} | — | Partial update (tag_ids hard-replace when sent) |
| DELETE | /api/v1/photos/{id} | — | Единый флоу #324: `?dry_run=true` (теги → 409-превью); голый → 422; тело `{expected}` |

## Relationships
- Photo → belongs to (Client | Service | Activity | Location) — at most one of the four
- Photo → has many Tags (M2M)
