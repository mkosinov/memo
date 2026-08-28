# Photos: Server Pagination + Filters + Model Expansion — Design

- **Issue:** GH #211 (absorbs GH #222 — photos model expansion; #222 closes as absorbed after G1b)
- **Date:** 2026-08-22
- **Status:** DESIGN — pending G1b (round 2, revised per G1b feedback 2026-08-22)
- **Depends on (IMPL gates):** #139 (generic DataTable) merged AND #212 (list search `?q=`) merged — **#212 is merged (PR #228, commit `959cf82`); only #139 remains**. Design docs land on main now; IMPL starts later in a fresh worktree off post-merge main.
- **G1b revisions (binding):** location is a full 4th owner; tag filter flipped to AND semantics; location display via client-side `/locations/all` join (no endpoint denormalization); group-photo follow-up issue closed as not planned.
- **Canonical activity label ruling (binding, 2026-08-27):** project-wide label format `«{dd.mm.yyyy HH:mm} — {location title} — {service_title}»`, date-first, via ONE shared formatter — §7.7.

## G1a + Step-0 + G1b-revision user decisions (binding, 2026-08-22)

1. **Scope merger:** #222 absorbed into #211 — one spec, one plan, one PR on the final model.
2. **No data backfill.** Project is not in production. Schema change ships as an **alembic migration** (schema-only, SQLite batch mode — alembic owns the schema, enforced by `tests/test_redundant_create_all.py:20-29`); dev data is covered by seed.py rewrite + DB recreate. Zero data migration effort.
3. **Ownership invariant (Step-0 ruling, EXTENDED at G1b revision):** "Photo belongs to **at most one** of (Client | Service | Activity | **Location**); 422 on ≥2 of the 4 owner FKs at write time; may become owner-less when a parent is deleted (SET NULL)". Consistent with #194/#207 deletion policy (photo is a general resource, survives parent deletion). Location-owned photos = standalone location gallery (interiors/venues) with no client/service/activity.
4. **Group photos: model + display only (revised at G1b).** A group photo is simply N Photo rows with distinct `client_id` (same `filename`), created individually via the normal single-owner modal; copies are independent rows. No batch endpoint, no multi-select creation flow, no follow-up issue (the deferred-flow issue was closed as not planned).
5. **Tag filter: multi-select, AND semantics (revised at G1b — flipped from OR).** `?tag_id=` repeatable query param; a photo matches only if it has ALL of the selected tags.
5a. **Location filter: DIRECT-only (G1b ruling).** Equality on `photos.location_id`; OR-via-activity explicitly rejected. Consequence: activity-owned photos never carry `location_id` (owner slot taken) and never match the location filter. Service keeps variant A (direct OR via activity) — the asymmetry is intentional (§6.7).
5b. **Location display: client-side join (G1b ruling).** The endpoint returns `location_id` only; the frontend resolves the title via a `/locations/all` map (same pattern as «Услуга»). `client_name` remains the ONLY denormalized response field (clients have no `/all`).
6. **per_page:** server default stays 20 (`PaginationParams`, `backend/src/schemas/pagination.py:15-16` — no endpoint overrides it today); the photos UI explicitly requests `per_page=10`.
7. **`PhotoService.list` is REWRITTEN** (paginated, service-owned dual-query `session.execute()` + manual Row mapping — the actual `ClientWithStats` pattern; NOT `list_custom`, which would drop `client_name`), NOT deleted — `BaseRepository.list` equality filters (`repositories/generic.py:50-52`) cannot express q-ilike / tag-EXISTS / service-OR / client_name.
8. **Filter bar is NEW UX** — BookingFilters has no typeaheads and no tags filter (verified `BookingFilters.tsx:59-145`: date inputs, plain selects, StatusFiltersPicker). Designed from scratch in §7.3.
9. **Sort:** Literal whitelist `filename | is_public | created_at` (422 on unknown — `RecordSortBy` pattern, `schemas/record.py:115-118`), default `created_at desc` + id tiebreak (`services/record.py:135` pattern). FK columns and preview are not sortable; `photoColumns.tsx` aligned.
10. **Unknown filter ids → silent empty page** (records equality-filter precedent), NOT 422.
11. **q:** min 2 / max 100 (#212 parity), AND-combined with filters, **filename-only** (accepted limitation, documented in §6.6).
12. **FK_MATRIX** (`backend/src/domain/deletion.py`): Client→photos and Location→photos gain nullify entries + counters + handlers + tests; Visitor→photos nullify step is removed (column dropped).
13. **Sequencing:** docs to main now; NO worktree at DESIGN time; IMPL gated on #139 AND #212 merges.

## 1. Background & Problem

- `GET /api/v1/photos` is the only list endpoint with **no pagination at all** — `PhotoService.list` (`services/photo.py:23-33`) is an ad-hoc unpaginated override returning `list[PhotoResponse]`; the admin table paginates by client-side slice (#139 T7 interim adapter).
- The photos model still references **visitors** (`photos.visitor_id`), while the domain has moved to client-centric ownership; #222 asks for `client_id` + `location_id` on photos.
- Filters (client/service/activity/location/tags) exist only as raw-UUID form fields; the table shows raw UUIDs in owner columns (`photoColumns.tsx` renders `p.visitor_id || '—'`).
- #212 deliberately excluded photos from server search ("photos list gets no `q`" — `docs/specs/2026-08-19-list-search-q-design.md:31`, superseded by this spec, §9).
- **This spec:** paginate + filter + search the photos list on the server, expand the model (client_id, location_id), denormalize `client_name`, and align the admin UI with the post-#139/#212 patterns.

## 2. User Scenarios

Each scenario maps to an E2E test (§10.4).

1. **Browse paginated photos.** Admin opens /photos → table shows 10 rows + total label; navigates to page 2 → different rows, honest server total. → e2e: pagination (creates ≥11 photos via API, asserts pager/totals/page-2).
2. **Search by filename.** Admin types ≥2 chars in «Поиск фото...» → server-filtered results; ✕ clear restores the unfiltered page. → e2e: honest server search (replaces the assertion-free fill-only check at `photos-crud.spec.ts:37-44`).
3. **Filter by client.** Admin picks a client in the filter-bar typeahead → only that client's photos; «Клиент» column shows names (not UUIDs); filter change resets to page 1. → e2e: client filter.
4. **Filter by service (variant A).** Admin picks a service → results include photos with direct `service_id` AND photos whose activity belongs to that service. → e2e: service OR-semantics (both branches visible).
5. **Browse the location gallery.** Admin picks a location in the filter bar → only location-OWNED photos (standalone interior/venue shots) appear. Activity-owned photos taking place at that location do NOT appear — owner slots are mutually exclusive (documented consequence of the direct-only location filter, §6.7). → e2e: location filter (location-owned photo matches; activity-owned photo at that location does not).
6. **Filter by tags (multi, AND).** Admin selects two tag chips → only photos having BOTH tags remain; removing chips restores. → e2e: multi-tag AND.
7. **Create/edit with new pickers + owner validation.** Admin opens PhotoModal: «Клиент» picker (no «Посетитель»), «Локация» picker; submitting with ≥2 of the 4 owner FKs set → 422 error surfaced in the modal. → e2e: modal create/edit + 422 case (unit-covered, e2e smoke).

Hard-delete survival (Client/Location → photos auto-nullify, photo becomes owner-less) is covered in §10.1/§10.4 without a numbered user scenario (kept off the list to stay within the 3-7 scenario limit).

## 3. Goals

- `GET /api/v1/photos` returns `PaginatedResponse[PhotoResponse]` with validated params (page/per_page/q/filters/sort), riding the post-#206/#212 mechanics.
- Model expansion: `photos.client_id` + `photos.location_id` (nullable FKs, SET NULL), `photos.visitor_id` dropped, via one alembic migration with zero backfill. Location is a full 4th owner (standalone location gallery).
- Write-time ownership validation: 422 when ≥2 of (client_id, service_id, activity_id, location_id) are set.
- `PhotoResponse` gains denormalized `client_name` (nullable; resolved for archived clients too) — the ONLY denormalized field; service/location titles resolve client-side via `/all` maps.
- Deletion-policy integration: Client→photos and Location→photos nullify entries in the #207 dependency matrix.
- Admin UI: server-driven PhotosContext (RecordsContext pattern), new PhotosFilters bar, aligned photoColumns, PhotoModal client+location pickers.
- seed.py rewrite covering all owner types, locations, and shared tags; test_seed pin updated.
- Domain-rules docs synced (photos.md, visitors.md, clients.md, locations.md) + #212-spec supersession note.

## 4. Non-Goals (explicit follow-ups — NOT in scope)

- **Group-photo mechanisms** — a group photo is N independent single-owner rows created via the normal modal (binding decision 4); no batch endpoint, no multi-select picker, no sync affordance, no follow-up issue.
- **Activity column proper display** (resolved activity label) → #213 (display-lookup composite). This PR hides the column by default (§7.4).
- **`/photos/web` changes** — endpoint behavior untouched (§6.9).
- Visitor entity retirement — visitors remain needed (visits FK, records find-or-create, `models/visit.py:21`, `services/record.py:263-286`).
- Search-endpoint deletion, SearchableSelect clamp, `/clients?q=` rename — #212 scope (preconditions, §12).
- Router-inline query style in `/photos/web` (`photos.py:34-43`) — known follow-up, untouched.
- DB indexes on new FK columns — seed-scale data, not worth migration noise.

## 5. Key codebase facts (verified 2026-08-22, main @ 58b628d)

- `backend/src/models/photo.py:17-34` — `filename` (Text, no unique constraint anywhere), `visitor_id`/`activity_id` FKs `ondelete="SET NULL"`, `service_id` FK no ondelete, `is_public`, tags M2M via `photo_tags`. No S3/file-storage code exists in the backend — delete is DB-row-only, so duplicate filenames across rows are storage-safe.
- `backend/src/api/v1/photos.py` — 6 endpoints; `GET /web` (`:28-43`) is a bare `list[PhotoResponse]`, `is_public=true` + optional `activity_id`, inline query, no visitor join; `GET ""` (`:46-52`) → `service.list`, sole consumer of the override.
- No ownership-exclusivity validation exists today (`schemas/photo.py` has no validators; domain-rules photos.md:17 "Cross-field Rules: None").
- `PaginationParams` (`schemas/pagination.py:15-16`): `page≥1` default 1, `per_page` 1..100 default 20. `PaginatedResponse` = `{items,total,page,per_page}` (`schemas/common.py:15-21`).
- Records precedent: `RecordListParams` (`schemas/record.py:123-144`) via `Annotated[..., Query()]`; `RecordSortBy` Literal → 422; service/location/master filters via activity join (`services/record.py:50-66`); name sorts via correlated scalar subqueries (`:89-113`); deterministic tiebreak `Record.id.asc()` (`:135`).
- Denormalized-list precedent: `ClientWithStats` — service-owned custom list with correlated scalar subqueries, flagged "accepted exception to repo-owned list (GH #206)" (`services/client.py:76-119`). No main list response carries a joined name today (RecordResponse returns ids; RecordsTable joins client-side via `/all` maps, `RecordsTable.tsx:174-176`).
- `BaseRepository.list_custom` (`repositories/generic.py:65-91`) wraps a caller-built stmt with count + slice.
- #207 delete matrix: `FK_MATRIX` `backend/src/domain/deletion.py:113-171`; Service→photos nullify-auto entry at `:147-150`, counter `:269-273`, handler `:465-471`, registration `:584-587`; Client→visitors cascade currently nulls `photos.visitor_id` (`:555-556,568-574`; `services/visitor.py:62`); Activity delete nulls `photos.activity_id` (`services/activity.py:153-155`). Client archive (soft delete) has no FK side effects (`clients.py:208-230`).
- `/all` endpoints exist for services/locations/tags/masters/materials (#205). Clients and activities have NO `/all`.
- #139 worktree (T7 DONE, reviewed): `PhotosContext.tsx` client-adapter with swap-point comment (L7-13), client-side sort/slice, `searchPredicate` on filename; `photoColumns.tsx` — 6 columns, ALL marked sortable (pre-#139 drift), owner columns render raw UUIDs; PhotosTable `<DataTable withSearch searchPlaceholder="Поиск фото...">`; `PhotosContext.test.tsx` 6 tests pin client-side slicing; `photos-crud.spec.ts` 11 tests (search test asserts nothing, pagination test asserts `/\d+ всего/`).
- #212 (design complete, IMPL after #139): `/clients` search→q atomic rename; `/activities?q=` + `service_id` narrowing + `service_title` on list; SearchableSelect ≥2-char clamp; factory `serverSearch` flag (search in query key, page reset); `/api/v1/search/*` router deleted; Cyrillic-safe `lower()` search helper (M5).
- SearchableSelect (`app/components/shared/SearchableSelect.tsx:7-17`): props-driven (`onSearch(query)→Promise<items[]>`, no api-client coupling), single-select only; multi-select emulated via chips in PhotoModal (`PhotoModal.tsx:49-94`).
- api-client: `PhotoResponseSchema` (`schemas.ts:62-74`) has `visitor_id`, no `client_name`; `getPhotos(): Promise<PhotoResponse[]>` unpaginated, no params (`endpoints.ts:187-189`); `paginatedSchema` helper (`schemas.ts:538-545`); photo contract tests at `schemas.test.ts:305-340`, `endpoints.test.ts:131-142`.
- Seed: 7 photos, human-readable filenames (`seed.py:451-464`); count pinned at `test_seed.py:132-141`.
- Alembic: 12 migrations, active workflow (`scripts/recreate_dev_db.sh:21-27`); #194's photos FK change shipped migration `b7c8d9e0f1a2` (SQLite batch mode precedent).
- Web frontend: `WebPhotoResponse` reads only id/filename/activity_id/is_public (`frontend/web/app/lib/model/dto/photo.ts:1-6`) — no visitor dependency; no live caller today (mock gallery).

## 6. Backend Design

### 6.1 Model & alembic migration (schema-only, zero backfill)

One migration (SQLite batch mode, `b7c8d9e0f1a2` precedent):

- DROP `photos.visitor_id`.
- ADD `photos.client_id` — nullable, FK → `clients.id`, `ondelete="SET NULL"`.
- ADD `photos.location_id` — nullable, FK → `locations.id`, `ondelete="SET NULL"`.
- ADD table-level `CheckConstraint` (G1b-round-2 user approval): `(client_id IS NOT NULL) + (service_id IS NOT NULL) + (activity_id IS NOT NULL) + (location_id IS NOT NULL) <= 1` — defense-in-depth for writes bypassing the API (seed/scripts get `IntegrityError`). API-level validation (§6.2) remains the user-facing path (clean 422). Also declared on the SQLAlchemy model so schema and DDL stay in sync.
- NO data backfill (user ruling: project not in production). `alembic upgrade head` + `downgrade` both work; dev flow = `recreate_dev_db.sh` + seed.
- `backend/src/models/photo.py`: replace `visitor_id` with `client_id`/`location_id` FK columns; `client`/`location` relationships as needed by §6.5. DB-level ondelete never fires on prod SQLite (no `PRAGMA foreign_keys`, per #194) — service-level nulling is mandatory and lives in the deletion matrix (§6.3).
- The batch table-recreation copies existing rows; new columns are NULL for all of them — this IS the zero-backfill intent, no follow-up needed.
- **Atomicity:** the migration, the §6.3 deletion-matrix changes, and the visitor-cascade cleanup ship in ONE commit — intermediate states break (matrix code would `UPDATE photos SET visitor_id=NULL` on a dropped column, or the schema would retain a column the code no longer knows).
- IMPL verifies the alembic migration connection runs with `PRAGMA foreign_keys=OFF` (SQLite will not toggle it mid-transaction); check `alembic/env.py` against this before running the migration.

### 6.2 Ownership invariant + write-time validation

- **Rule (binding, G1b-extended to 4 owners):** at most one of `client_id | service_id | activity_id | location_id` non-null — all four FKs participate in the invariant identically. Location-owned photos are a standalone location gallery (interiors/venues).
- **Create (POST):** pydantic `model_validator` on `PhotoCreate` — ≥2 of the 4 owner FKs in the payload → ValidationError → automatic 422 (English detail).
- **Update (PUT) / Patch (PATCH) — merged-set check (panel-round-2 hole):** `PhotoService.update` applies `exclude_unset=True` (`services/photo.py:100`) and owner FKs in `PhotoUpdate`/`PhotoPatch` are optional — a payload carrying a single owner can still collide with owners already on the row (PUT `{location_id: Y}` against a client-owned photo would leave 2 owners at rest). BOTH `PhotoService.update` and `PhotoService.patch` (existing override, `services/photo.py:118-160`) therefore validate the MERGED owner set (existing row + applied payload, across all 4 FKs) and raise `HTTPException(422)` with English detail on conflict. The payload-level `model_validator` on `PhotoCreate`/`PhotoUpdate` stays as the fast first line for ≥2-in-payload cases.
- Zero owners allowed at rest (parent deletion nulls FKs; direct creation with no owner is permitted, as today).

### 6.3 Deletion-policy integration (`backend/src/domain/deletion.py`)

- **Client → photos:** new `FKDependency(entity="photos", nullable=True, action="nullify", auto=True)` on the Client entry + `_count_c_photos` counter + `_h_nullify_client_photos` handler (sets `Photo.client_id=NULL`) + `NULLIFY_HANDLERS` registration. Template: Service→photos at `deletion.py:147-150,269-273,465-471,584-587`.
- **Location → photos:** same shape on the Location entry (sets `Photo.location_id=NULL`). Consequence: location-OWNED photos become owner-less on location deletion — consistent with the survive-the-parent policy (#194/#207).
- **Visitor cascade:** remove the `UPDATE photos SET visitor_id=NULL` step (`deletion.py:555-556,568-574`, `services/visitor.py:62`) — the column no longer exists.
- **Soft delete (archive)** of a client/location: no FK effect (row persists); `client_name` still resolves for archived clients. Unchanged behavior, stated for clarity.
- Photo itself remains hard-delete (row removal only, no storage side effects).
- This section ships in the same commit as the §6.1 migration (atomicity requirement, see §6.1).

### 6.4 `PhotoListParams` — validated params model

New in `backend/src/schemas/photo.py`, modeled on `RecordListParams` (`schemas/record.py:123-144`), injected as `Annotated[PhotoListParams, Query()]` in the router:

| Param | Type | Default | Validation / semantics |
|-------|------|---------|------------------------|
| `page` | int | 1 | `ge=1` (422) |
| `per_page` | int | 20 | `ge=1, le=100` (422) — server default stays 20 (binding decision 6) |
| `q` | str \| None | None | `min_length=2, max_length=100` (422); filename ilike, §6.6 |
| `client_id` | str \| None | None | equality on `photos.client_id` |
| `location_id` | str \| None | None | equality on `photos.location_id` (direct only — §6.7) |
| `activity_id` | str \| None | None | equality on `photos.activity_id` |
| `service_id` | str \| None | None | **variant A OR:** direct `service_id` OR via `activity.service_id` — §6.7 |
| `tag_id` | list[str] \| None | None | **repeatable** param (`?tag_id=a&tag_id=b`), AND semantics via M2M (photo must have ALL selected tags) — §6.7 |
| `sort_by` | `PhotoSortBy` | `"created_at"` | `Literal["filename","is_public","created_at"]` → 422 on unknown |
| `sort_order` | SortOrder | `"desc"` | `Literal["asc","desc"]` (`schemas/common.py:12`) |

- 422 cases: `page<1`, `per_page` outside 1..100, `q` of length 1 or >100, unknown `sort_by`/`sort_order`. (FastAPI/pydantic automatic.)
- Unknown/nonexistent filter ids → silent empty page (records equality precedent), NOT 422.
- Injection constraint (FastAPI #12481, documented at `schemas/pagination.py:9-12`): ALL list params live exclusively in `PhotoListParams`; the handler adds no separate scalar query params (records handler precedent, `records.py:72-85`). `Depends` remains only for session/service.
- `tag_id` param notes: its Field description states "repeatable; AND semantics — photo must have ALL selected tags" (OpenAPI clarity); duplicate tag_ids are harmless (deduped by the conjunction); an empty-string/unknown tag id falls under the unknown-id → silent-empty rule.

### 6.5 `PhotoService.list` — paginated rewrite (accepted exception)

Rewritten as a service-owned custom list following the ACTUAL `ClientWithStats` execution pattern (`services/client.py:212-260`): the service runs its own count + main queries via `session.execute()` and maps `Row` tuples → `PhotoResponse` manually. **NOT via `BaseRepository.list_custom`** — it returns `result.scalars().all()` (first column only, `repositories/generic.py:81-91`), which would silently drop `client_name` (panel-verified).

- Base stmt: `select(Photo, client_name_subq.label("client_name"))` where `client_name_subq = select(Client.name).where(Client.id == Photo.client_id).scalar_subquery()` (correlated scalar subquery — records' name-sort idiom, `services/record.py:89-103`). Resolves for archived clients (no `is_active` filter on the subquery). `client_name` is NULL when `client_id` is NULL.
- Count: `select(func.count()).select_from(filtered_stmt.subquery())` — honest total under any filter combination (incl. the §6.7 service join; 1:0..1, no double-count).
- Eager-load tags: `selectinload(Photo.tags)` (preserved from current override).
- Filters applied per §6.4/§6.7; q per §6.6; sort per §6.8; deterministic tiebreak `Photo.id`.
- Response mapping: `PhotoResponse` built per row from `(Photo, client_name)` (field `client_name: str | None = None`); exact row-mapping mechanics pinned at plan time against the merged code.
- Docstring carries the "accepted exception to repo-owned list (GH #206)" flag, mirroring `ClientWithStats`.
- Location display is deliberately NOT denormalized — it resolves client-side via `/locations/all` (§7.4); `client_name` is the only denormalized field.

### 6.6 Search semantics (`?q=`)

- Case-insensitive substring on `Photo.filename` ONLY. Reuses #212's Cyrillic-safe search helper (M5 `lower()` fix); exact reuse point pinned at plan time against merged #212 code.
- `min_length=2, max_length=100` (422 otherwise) — #212 parity.
- AND-combined with all filters.
- **Accepted limitation (documented):** q does NOT match client names — typing a client name in the table search box yields nothing (filename-only). Rationale: approved at G1a; extending q to the joined name is a cheap future enhancement if missed.

### 6.7 Filter semantics

- All filters AND-combine with each other and with q.
- `service_id` (variant A, binding): `WHERE (photos.service_id = :sid) OR (activities.service_id = :sid)` via **LEFT OUTER JOIN** `activities ON activities.id = photos.activity_id` — an INNER JOIN would wrongly drop direct-service photos with no activity. The join is 1:0..1 (a photo has at most one activity) — no row multiplication, count stays honest. Acknowledged cost: the join is evaluated inside the count subquery whenever the filter is active; acceptable at seed scale.
- `location_id` is **direct-only** (equality on `photos.location_id`) — G1b ruling, OR-via-activity explicitly rejected. Consequence (documented): because owner slots are mutually exclusive (§6.2), activity-owned photos never carry `location_id` and therefore never match the location filter; the location filter surfaces exactly the standalone location gallery. The service/location asymmetry is intentional: variant A was user-approved at G1a, location direct-only at G1b.
- `tag_id` (repeatable, **AND** — binding decision 5, revised at G1b): a photo matches only if it has ALL selected tags. Pinned implementation: one `Photo.tags.any(Tag.id == t)` predicate per requested tag, AND-chained (per-tag EXISTS conjunction) — no GROUP BY/HAVING, no row multiplication, count stays honest. (Rejected alternative: join + `GROUP BY`/`HAVING COUNT(DISTINCT tag_id)=n` — needlessly complicates the count query.)
- `client_id` / `activity_id`: direct equality.
- Inactive (archived) entities as filter VALUES behave identically (equality match; photos of archived clients remain listed).
- Combining two DIFFERENT owner filters (e.g. `client_id` + `service_id`) yields an empty page by construction (a photo has at most one owner) — legal, documented, no special-casing.

### 6.8 Sorting design

- Whitelist `PhotoSortBy = Literal["filename","is_public","created_at"]` in `schemas/photo.py`; 422 on unknown (records Literal pattern — NOT clients' silent-fallback, which is known debt).
- Sort map in `PhotoService.list`: filename → `Photo.filename`, is_public → `Photo.is_public` (false-first asc), created_at → `Photo.created_at`. **Known limitation (documented, not fixed):** SQLite BINARY collation sorts Cyrillic by UTF-8 codepoint, not Russian alphabetical order — same debt as records (`services/record.py:88`); acceptable for v1.
- Default: `created_at desc`. Deterministic tiebreak: `Photo.id` (asc) appended to every ordering (records pattern).
- FK columns, `client_name`, and preview are NOT sortable (no join-sort in scope).

### 6.9 `/photos/web` — untouched

- Behavior unchanged: bare `list[PhotoResponse]`, `is_public=true`, optional `activity_id` (`photos.py:28-43`). Unpaginated by design (public gallery, small).
- The response SCHEMA changes propagate (visitor_id gone; client_id/location_id/client_name present) — verified safe: the web DTO reads only id/filename/activity_id/is_public (`frontend/web/.../dto/photo.ts:1-6`) and no live caller exists today (mock gallery). api-client `getWebPhotos` keeps its bare-array contract.
- The endpoint keeps its own inline query — it does NOT call `PhotoService.list` (`photos.py:34-43`), so the §6.5 rewrite cannot break it.

### 6.10 `PhotoResponse` schema change

Final field set: `id, filename, client_id (nullable), service_id (nullable), activity_id (nullable), location_id (nullable), is_public, tags[], created_at, updated_at, client_name (nullable, default None)`.

- Removed: `visitor_id`.
- NO `location_name`/`service_title` in the response — location and service titles resolve client-side via `/locations/all` and `/services/all` maps (§7.2/§7.4). `client_name` is the only denormalized field (clients have no `/all`).
- `PhotoCreate`/`PhotoUpdate`/`PhotoPatch`: replace `visitor_id` with `client_id` + `location_id`; tag_ids hard-replace semantics unchanged (`photos.md:25-26`).
- api-client `PhotoResponseSchema` mirrors exactly (§7.6).

## 7. Frontend Design

### 7.1 Preconditions (post-#139/#212 contract points this design builds on)

From #139 (merged): `<DataTable>` with `withSearch` + `searchPlaceholder`; `PagedListState<T>` contract; `createPagedListContext` factory; per-entity `<entity>Columns.tsx` files; ColumnPicker with `defaultVisible`; LS key `photos-columns`. From #212 (merged): `/clients?q=` (atomic rename from `search`), `/activities?q=` + `service_id` narrowing + `service_title` on list responses, `/services?q=`, SearchableSelect ≥2-char clamp, factory `serverSearch` mechanics (search in query key + page reset), `/api/v1/search/*` deleted, Cyrillic-safe search helper. Full re-verify checklist: §12.

### 7.2 PhotosContext — swap client-adapter → server context

- The #139 T7 adapter (`contexts/PhotosContext.tsx`, swap-point comment L7-13) is replaced by a **hand-rolled server context aligned to `PagedListState<PhotoResponse>` — RecordsContext template** (`RecordsContext.tsx`), because the factory's query key does not carry arbitrary filter params (records/clients are hand-rolled for the same reason).
- State: `page`, `perPage` (**default 10** — UI requests `per_page=10`, binding decision 6), `sortBy/sortOrder` (default `created_at`/`desc`), `search` (server-backed; ≥2-char clamp per #212 `serverSearch` mechanics; search change resets page), `filters: {client_id?, activity_id?, service_id?, location_id?, tag_id[]}`.
- Naming: context fields stay `search`/`setSearch` (the `PagedListState` contract name post-#139/#212); the fetcher maps `search` → the `q` query param.
- `setFilters`/`setSearch` reset page to 1 (`RecordsContext.tsx:100-103` precedent). Page-clamp effect (last row deleted on last page → page-1) per #139 contract.
- Query key: `['photos', {page, per_page, sort_by, sort_order, q, ...filters}]`; `placeholderData: keepPreviousData`.
- Also loads `/services/all` and `/locations/all` once for the «Услуга»/«Локация» column display maps (RecordsContext dictionary pattern, `RecordsContext.tsx:177-205`).

### 7.3 PhotosFilters bar (NEW component — new UX, no BookingFilters typeahead precedent)

`frontend/admin/app/(main)/photos/components/PhotosFilters.tsx`, layout modeled on BookingFilters:

| Control | Type | Data source | Notes |
|---------|------|-------------|-------|
| Клиент | SearchableSelect (single) | `getClients({q, per_page:10})` — `/clients?q=` post-#212 | ≥2-char clamp; active clients by default (`ClientListParams.status=ACTIVE`) |
| Активность | SearchableSelect (single) | `getActivities({q, per_page:10})` | options rendered via the canonical activity label (§7.7) — `formatActivityLabel(a, locationsMap)` |
| Услуга | plain `<select>` | `/services/all` | BookingFilters precedent |
| Локация | plain `<select>` | `/locations/all` | BookingFilters precedent |
| Теги | multi-select chips + add-typeahead | `/tags/all` | PhotoModal multi-emulation pattern (`PhotoModal.tsx:49-94`); AND semantics server-side (photo must have ALL selected tags) |
| Сбросить | button | — | clears filters + search, resets page (RecordsContext `resetFilters` precedent) |

- Every control change → context `setFilters` → page 1. Photos becomes the first table with BOTH an in-table search box (withSearch) AND a filter bar — intentional.

### 7.4 photoColumns.tsx alignment

8 columns (LS key `photos-columns`; corrupted/empty LS → defaults per #139 contract):

| Column | Key | Render | Sortable | defaultVisible |
|--------|-----|--------|----------|----------------|
| Превью | preview | image thumb (unchanged) | no | yes |
| Файл | filename | `p.filename` | yes (`filename`) | yes |
| Клиент | client | `p.client_name ?? '—'` (replaces raw-UUID «Посетитель») | no | yes |
| Услуга | service | servicesMap.get(`p.service_id`)?.title ?? '—' (client-side `/services/all` join — records pattern) | no | yes |
| Локация | location | locationsMap.get(`p.location_id`)?.title ?? '—' (client-side `/locations/all` join — records pattern) | no | yes |
| Активность | activity | `p.activity_id ?? '—'` (raw id — proper display deferred to #213) | no | **no** (hidden until #213) |
| Публичное | is_public | badge (unchanged) | yes (`is_public`) | yes |
| Дата | created_at | formatted `created_at` | yes (`created_at`) | yes |

- **Architect decisions:** (a) «Услуга»/«Локация» resolved client-side via `/services/all` + `/locations/all` rather than left as UUIDs — zero backend cost, records precedent (location display is client-side per G1b ruling: no endpoint denormalization); (b) «Локация» is **default-visible** — it is a full owner with a properly resolved title and a headline feature of this PR (unlike «Активность», hidden only because its display would be a raw UUID pending #213); (c) «Активность» hidden by default pending #213; (d) NEW «Дата» column so the default sort (`created_at desc`) is visible in the UI (sort indicator lives on column headers).
- Sortable flags reduced from "all 6" (pre-#139 drift) to exactly the 3 server-whitelisted fields.
- **Cross-pinning for #213:** when the «Активность» column display lands, it MUST use the canonical activity label (§7.7) — no third format gets invented there.

### 7.5 PhotoModal changes

- «Посетитель» field removed; **«Клиент»** SearchableSelect added — `onSearch` → `getClients({q, per_page:10})` (#212 mechanics; replaces the visitor typeahead that #212 migrates to `/visitors?q=` — that wiring is superseded before it ships).
- **«Локация»** picker added — plain dropdown over `/locations/all` (bounded dictionary, no typeahead). `photoFields.tsx` field-type union has no plain-select member today (text/searchable/tags only) — extend at plan time.
- Owner fields remain independent controls (now 4: client/service/activity/location); **enforcement is server-side 422 on ≥2 of the four** (§6.2) surfaced via the existing PhotoModal error catch. No client-side lockout (accepted UX roughness, noted).
- Service/activity fields remain post-#212 typeaheads over list `?q=`, but the **auto-fill of `service_id` on activity pick is REMOVED** (panel-round-2: `PhotoModal.tsx:118-121` auto-fill would now manufacture a guaranteed 2-owner 422). Under the 4-owner invariant service and activity are mutually exclusive: picking one CLEARS the other (replace semantics for that pair); activity-search narrowing by a selected service stays as a search aid only. Client/location fields keep plain independence (server 422 on conflicts, next bullet).
- **Activity options use the canonical label (§7.7)** for BOTH dropdown rows and the selected-value rendering — replacing the current `service_title — HH:mm dd.mm.yyyy` composition (`photoFields.tsx:48-55` `displayField/subtitleField` + the SearchableSelect `main — sub` join). The "datetime-only when service already selected" displayField special case (`PhotoModal.tsx:121-125`) is REMOVED — canonical label everywhere. The same `/locations/all` map that feeds the «Локация» picker feeds the label (no extra fetch).

### 7.7 Canonical activity label (binding, 2026-08-27 — project-wide)

THE canonical string representation of an activity in the admin frontend, everywhere an activity is rendered as an option/label:

- **Format:** `«{dd.mm.yyyy HH:mm} — {location title} — {service_title}»` — DATE FIRST (e.g. «21.08.2026 14:00 — Студия Север — День рождения»).
- **Segment omission:** a segment is omitted when its data is absent — no dangling separators («21.08.2026 14:00 — День рождения» for a location-less activity; date-only «21.08.2026 14:00» if service is absent too).
- **Separator:** « — » (project convention, SearchableSelect `getDisplayText`).
- **Time semantics:** #212 local-time formatting preserved (formatActivityStart idiom), only the ORDER changes to date-first «dd.mm.yyyy HH:mm» — new/adjusted helper.
- **ONE shared formatter, single source of truth:** `formatActivityLabel(activity, locationsMap)` colocated with the date helpers (`frontend/admin/lib/utils.ts`, next to `formatActivityStart:117-121`). All consumers call it; nobody composes the string inline.
- **Location title resolved client-side** via the `/locations/all` map — zero backend changes. Edge: `/locations/all` is active-only (`locations.py:113`) — an activity at an ARCHIVED location omits the location segment (id not in map → segment skipped, no dangling separator). Accepted and consistent with the «Локация» column ('—' for unresolvable ids).
- **Enumerated consumers** (grep-verified 2026-08-27): photoFields.tsx activity config + PhotoModal activity branch (§7.5); planned PhotosFilters activity typeahead (§7.3); future: #213 «Активность» column (§7.4 cross-pin). SearchableSelect's only current consumer is PhotoModal — no other admin activity typeahead exists today.

### 7.6 api-client

- `PhotoResponseSchema`: drop `visitor_id`; add `client_id` (nullable), `location_id` (nullable), `client_name` (nullable, default null).
- New `PhotoListResponseSchema = paginatedSchema(PhotoResponseSchema)` (`schemas.ts:538-545` pattern).
- `getPhotos(params?: {page?, per_page?, q?, client_id?, location_id?, activity_id?, service_id?, tag_id?: string[], sort_by?, sort_order?}): Promise<PaginatedResponse<PhotoResponse>>` — repeated `tag_id` params; `getRecords` (`endpoints.ts:274-303`) is the template.
- `getWebPhotos` unchanged (bare array).
- Sole consumer of `getPhotos` post-#139 is PhotosContext — re-verified at IMPL start (§12).

## 8. Seed & test data

- `backend/src/seed/seed.py:448-469` rewrite (7 photos, count unchanged → `test_seed.py:132-141` pin re-pointed at new owner fields). Owner slots are mutually exclusive (§6.2) — every seeded photo has AT MOST one of client_id/service_id/activity_id/location_id:
  - ≥1 service-owned (card images), ≥1 activity-owned (guest photos, `guest` tag preserved), ≥2 client-owned (one client with 2 photos — supports scenario 3), **≥1 location-OWNED** (standalone interior/venue shot, location in the owner slot — supports scenario 5). Co-location pin for scenario 5's negative branch (panel-round-2): the activity-owned photo's `activities.location_id` equals the location-owned photo's location — without it the "does NOT appear" assertion is vacuous.
  - Tags for the AND filter (scenario 6): one photo carrying BOTH of two shared tags, another carrying only ONE of them — selecting both tags must leave only the first photo.
  - Not allowed under the new invariant: a photo with both another owner AND `location_id` set — the round-1 "≥1 with both location and owner" requirement is removed.
- E2E pagination scenario creates ≥11 photos via API (full-cycle pattern) — seed does not need >10 photos.

## 9. Domain-rules & docs updates

- `docs/domain-rules/photos.md`: fields table (visitor_id → client_id/location_id; +client_name response field); **Cross-field rule:** at most one of the 4 owner FKs (422 on ≥2); **Invariants:** hard-delete; survives parent deletion via SET NULL (owner-less allowed); copies of group photos are independent rows (created individually via the single-owner modal; no sync mechanism); endpoints table (paginated params); relationships updated (4 owners).
- `docs/domain-rules/visitors.md`: remove the Photo relationship line (photos no longer reference visitors).
- `docs/domain-rules/clients.md`, `locations.md`: delete-cascade sections gain "photos → nullify (auto)" entries.
- **Canonical activity label pin:** domain docs gain a line recording `«{dd.mm.yyyy HH:mm} — {location title} — {service_title}»` as the PROJECT-WIDE display convention for activities (§7.7) — in `docs/domain-rules/activities.md` (create the file if absent) with back-refs from photos.md.
- **Supersession note (docs hygiene):** this spec supersedes `docs/specs/2026-08-19-list-search-q-design.md:31` ("photos list gets no q; PhotosTable search stays client-side") — #211 adds server `q` to photos. The #212 spec file itself gets a one-line amendment note at IMPL finishing (docser task).

## 10. Test Strategy

### 10.1 Backend (pytest)

- Params validation matrix: 422 on page/per_page bounds, q length 1 / >100, unknown sort_by/sort_order; unknown filter ids → 200 empty page.
- Filter contract matrix: each filter alone; all-combined AND; service variant A — direct-only photo matches, activity-derived photo matches, unrelated service does not; **location direct-only — location-owned photo matches, activity-owned photo at that location does NOT**; tag_id single + repeated AND (photo with ALL selected tags matches; photo with only ONE of two selected does NOT); q AND filter combo; envelope `total` honest under the service join (no double-count).
- Sort: each whitelist field asc/desc; default `created_at desc`; id tiebreak determinism.
- Response: `client_name` present for client photos, NULL otherwise; resolves for archived client; PaginatedResponse envelope honesty (total/page/per_page).
- Owner validation: POST/PUT with ≥2 of the 4 owner FKs in the payload → 422 (incl. location+any other); **PUT carrying one owner against a row holding a different owner → 422 (merged-set check — exclude_unset hole)**; PATCH adding a second owner → 422 (merged-set check); PATCH/PUT nulling → OK; zero-owner create → OK; location-only owner → OK.
- Deletion matrix: Client hard-delete dry-run lists photos dep (auto-nullify) + execution nulls `client_id`; Location likewise; Visitor delete no longer touches photos; client archive leaves photo link intact.
- Migration: `alembic upgrade head` + `downgrade` pass (SQLite batch); DB CHECK enforced — direct insert with ≥2 owner FKs (bypassing API validators) → IntegrityError.
- Seed: `test_seed.py` pin re-pointed (count 7, new owner/location assertions).

### 10.2 api-client contract

- `schemas.test.ts` photo section (`:305-340`) rewritten: new fields, nullable client_name, `PhotoListResponseSchema` parse.
- `endpoints.test.ts`: `getPhotos` URL/params building (incl. repeated tag_id, q, filters, sort); `getWebPhotos` unchanged.

### 10.3 Frontend unit (vitest)

- `formatActivityLabel` (lib/utils) new suite: date-first order «dd.mm.yyyy HH:mm»; full 3-segment label; segment omission (no location → no dangling separator; no service; date-only); archived-location edge (id not in active-only map → location segment omitted); local-time semantics preserved.
- `PhotosContext.test.tsx` — **full rewrite** (currently 6 tests pinning client-side slice): server fetch params in query key, page reset on setFilters/setSearch, ≥2 clamp, page-clamp, per_page=10 default, sort mapping, servicesMap load.
- `PhotosFilters` new suite: controls render, change → setFilters, tags chips add/remove, reset; activity options carry the canonical label.
- `photoColumns`: client_name render w/ '—' fallback, service/location title resolution via maps, sortable flags exactly {filename, is_public, created_at}, activity defaultVisible=false, location defaultVisible=true.
- `PhotoModal`: client picker present / visitor absent, location picker, activity pick clears service and vice versa (auto-fill removed), activity options + selected value use the canonical label (special case gone), 422 surfacing on ≥2 of the 4 owner FKs (mock).

### 10.4 E2E (playwright, real backend — no page.route)

Mapped to §2 scenarios 1-7. Updates to existing `photos-crud.spec.ts`: search test gains honest assertions; pagination test asserts server-driven totals; new filter specs (client/service/location/tags); PhotoModal picker smoke. Deletion-matrix coverage (folded out of §2 to keep scenarios at 7): `clients-delete-cascade.spec.ts` extended with photos nullify assertion; location hard-delete nullify covered at backend level (§10.1).

## 11. Resolved Decisions (from Step-0 adversarial review, user-ruled 2026-08-22)

| # | Question | Ruling |
|---|----------|--------|
| 1 | Migration approach | Alembic schema-only migration, zero backfill (alembic owns schema — concept wording corrected) |
| 2 | Ownership invariant | "At most one" of the **4** owner FKs (client/service/activity/location) + 422 on ≥2 at write; owner-less after parent delete (SET NULL) — consistent with #194/#207. Location-owned = standalone location gallery (G1b extension) |
| 3 | Group photos | Model + display only — N independent rows via the normal single-owner modal; NO creation mechanism, NO follow-up (deferred-flow issue closed as not planned at G1b) |
| 4 | Tag filter | Repeatable `tag_id`, **AND** semantics (G1b flip from OR); per-tag EXISTS conjunction |
| 5 | per_page default | Server 20 (no override); UI requests 10 |
| 6 | `PhotoService.list` | Rewritten paginated via service-owned `session.execute()` + Row mapping (NOT `list_custom` — it drops `client_name`; `ClientWithStats` accepted-exception pattern), not deleted |
| 7 | Filter bar | New UX (BookingFilters has no typeaheads/tags) — designed in §7.3 |
| 8 | Sort | Literal whitelist (422), default `created_at desc` + id tiebreak; photoColumns aligned |
| 9 | Unknown filter ids | Silent empty page (records precedent) |
| 10 | q | min2/max100, AND with filters, filename-only (documented limitation) |
| 11 | service_id vs location filter | Service keeps variant A (direct OR via activity, G1a); location is DIRECT-only (G1b, OR explicitly rejected) — intentional asymmetry; consequence: activity-owned photos never match the location filter |
| 12 | Denormalization | `client_name` ONLY (scalar subquery in service layer; resolves archived clients; not sortable). Service/location titles resolve client-side via `/all` maps (G1b ruling) |
| 13 | Activity label | Canonical project-wide `«{dd.mm.yyyy HH:mm} — {location} — {service_title}»`, date-first, ONE shared `formatActivityLabel(activity, locationsMap)` (§7.7, user-ruled 2026-08-27); PhotoModal datetime-only special case removed; #213 column cross-pinned |

## 12. Preconditions / re-verify at IMPL start

Gate: IMPL starts only after BOTH #139 and #212 are merged to main (#212 already merged — PR #228, commit `959cf82`; #139 pending). At IMPL kickoff, re-verify (cheap grep-level checks):

1. `PhotosContext.tsx` on main = the #139 T7 client-adapter (swap-point comment intact) — else re-baseline §7.2.
2. `photoColumns.tsx` and `<DataTable withSearch>` contract unchanged (sortField/defaultVisible/`photos-columns` LS key).
3. `/clients?q=` (search renamed), `/activities?q=` + `service_id` + `service_title`, `/services?q=` live; `/api/v1/search/*` deleted; SearchableSelect clamps ≥2; factory `serverSearch` merged.
4. `getPhotos()` sole consumer = PhotosContext (grep) — response-shape change is safe.
5. `BookingFilters.tsx` still the layout template; `/services/all`, `/locations/all`, `/tags/all` signatures unchanged.
6. `deletion.py` templates (Service→photos entries) at cited lines or findable by name.
7. Backend baseline green on the fresh worktree (note: `uv sync --extra dev` needed in fresh worktrees).

If any check fails → STOP. Cosmetic drift (renamed/moved code, same contract) → reconcile the spec and proceed; structural drift (changed `PagedListState` / q mechanics / DataTable contract) → escalate to the manager before dispatching implementers.

## 13. Acceptance Criteria

- [ ] Alembic migration drops `photos.visitor_id`, adds `client_id`/`location_id` (nullable FKs, SET NULL) + the 4-owner exclusive-arc CHECK constraint; upgrade+downgrade pass; zero backfill; ships in ONE commit with the §6.3 deletion-matrix/visitor-cascade changes.
- [ ] `GET /api/v1/photos` returns `PaginatedResponse[PhotoResponse]`; 422 on invalid page/per_page/q/sort; unknown filter ids → empty page.
- [ ] Filters: client/activity direct; location direct-only (activity-owned photos never match); service variant A (direct OR via activity); repeatable tag_id AND; all filters AND-combined; q filename ilike min2/max100.
- [ ] Sort whitelist filename/is_public/created_at; default `created_at desc` + id tiebreak.
- [ ] `PhotoResponse` carries `client_name` (nullable; archived clients resolve); no `visitor_id`; no location_name/service_title (client-side maps).
- [ ] POST/PUT/PATCH with ≥2 of the 4 owner FKs → 422; zero-owner and location-only-owner allowed.
- [ ] FK_MATRIX: Client→photos and Location→photos auto-nullify (dry-run + execution tested); Visitor cascade no longer touches photos.
- [ ] `/photos/web` behavior unchanged (bare list, is_public, activity_id param).
- [ ] PhotosContext server-driven (per_page=10, page reset on filter/search, page-clamp, services+locations maps); PhotosFilters bar with 5 controls + reset; photoColumns per §7.4 (8 columns, «Локация» default-visible).
- [ ] PhotoModal: client picker (no visitor), location picker; 422 on owner conflict surfaces.
- [ ] seed.py rewritten (mutually-exclusive owners incl. ≥1 location-owned; shared-tag pair demonstrating AND); test_seed pin updated.
- [ ] Domain rules synced (photos/visitors/clients/locations); #212 supersession noted.
- [ ] E2E: scenarios 1-7 green; backend/api-client/unit suites green.

## 14. Visual Compliance Checks

- [ ] /photos shows the DataTable paginated at 10 rows with honest total label and working pager.
- [ ] Filter bar renders above the table: Клиент typeahead, Активность typeahead, Услуга select, Локация select, Теги chips, Сбросить button.
- [ ] «Клиент» column displays client names (no raw UUIDs anywhere in default-visible columns).
- [ ] «Локация» column displays resolved location titles (default-visible); «Услуга» likewise.
- [ ] Sort indicators appear only on Файл / Публичное / Дата headers; initial state shows ↓ on Дата.
- [ ] Search box «Поиск фото...» present with ✕ clear; typing 1 char fires no request.
- [ ] Активность column hidden by default; enablable via column picker.
- [ ] PhotoModal shows «Клиент» picker and «Локация» picker; no «Посетитель» field.
- [ ] Empty state renders when filters/search match nothing (error row + retry on failure per #139 standard).

## 15. Risks / rot watch

| Risk | Mitigation |
|------|-----------|
| #212 IMPL changes shape of q mechanics / SearchableSelect clamp before #211 starts | §12 re-verify gate; spec references only merged contracts |
| #139 final-gate tweaks DataTable/PagedListState contract | §12 checks 1-2; #139 contract frozen at G2 + addenda |
| PhotoListParams/q helper reuse point unclear until #212 code exists | §6.6 defers exact wiring to plan time (plan written post-merge) |
| Seed reshape breaks unrelated e2e relying on current photos | §8 keeps count at 7; e2e suite run at IMPL; pagination scenario self-creates data |
| Owner-validation 422 surprises existing modal tests | §10.3 explicit modal test updates |
