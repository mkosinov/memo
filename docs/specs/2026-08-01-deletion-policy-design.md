# Design Spec — GH #194: Deletion Domain Policy (soft → hard-delete refactor)

**Date:** 2026-08-01
**Issue:** GH #194. **Refs:** #189 (closed by this), #184 (CRUD contract — out of scope), #178 (Update-schema is_active — out of scope, scope narrows to soft-delete entities)
**Source of truth:** issue #194 body (approved verbatim at G1a 2026-08-01) + brainstorming decisions from scratchpad.

---

## 1. New Deletion Policy (domain decision, frozen)

| Delete semantics | Entities |
|---|---|
| **Soft-delete** (`is_active` flag) | Master, Location, Service, Material, Client |
| **Hard-delete** (row physically removed) | Tag, Photo, Visitor, Activity, Record, UserSettings |
| Already hard-delete (untouched) | Payment, Visit |
| Stays as-is (implicit soft-delete, out of scope) | User, Tariff (carry `is_active`, used e.g. in `admin/setup.py:35`) |

**Cascade rules:**
- **Activity → Record:** deleting an Activity hard-deletes its Records. Enforced at **both** levels: (a) ORM `relationship(..., cascade="all, delete-orphan")` on `Activity.records` and/or `ondelete="CASCADE"` on the `records.activity_id` FK, so any deletion path (not just the service) keeps integrity; (b) `ActivityService.delete` explicitly deletes records via `RecordService.delete` logic so their visits/payments cascade runs too.
- **Record → Visit/Payment:** already cascades; switches from soft to hard along with the rest.
- **Visitor → Visit:** hard-delete (visits are meaningless without a visitor). Service-level deletion in `VisitorService.delete` + FK `ondelete="CASCADE"` backstop.
- **Visitor → Photo: SET NULL (user decision 2026-08-01).** Photo is a general resource, not a child of Visitor. On Visitor delete, `photos.visitor_id` is nulled, photos are NOT deleted. FK config: `photos.visitor_id` must be nullable (verify; if currently NOT NULL → include in the migration) with `ondelete="SET NULL"`. Service-level nulling in `VisitorService.delete` is still required because prod SQLite runs without `PRAGMA foreign_keys` (DB-level `ondelete` won't fire). ORM: relationship with `passive_deletes=False` (default) so SQLAlchemy nulls the FK on flush when going through ORM paths.
- **Activity → Photo:** spec assumes the **same treatment** — Photo is a general resource; Activity delete nulls `photos.activity_id` (nullable FK + `ondelete="SET NULL"` + service-level nulling), does NOT delete photos. **Flagged for G1b confirmation** — if Photo is considered a child of Activity instead, this becomes hard-delete like Records.

**Rationale:** `is_active` on nearly every entity bloats API schemas, leaves dead UI status filters, and complicates contracts. Soft-delete is kept only where archive/restore is real domain value (clients, staff, catalog).

## 2. Scope

### 2.1 Models + Alembic migration

- Drop `is_active` column from tables: `tags`, `photos`, `visitors`, `activities`, `records`, `user_settings`.
- Models `Tag`, `Photo`, `Visitor`, `Activity`, `Record`, `UserSettings`: switch base class `AbstractModelSoftDelete` → `AbstractModel`.
- One alembic migration, head = `a1b2c3d4e5f6` (`hard_delete_visit_payment` is the precedent — same pattern, incl. SQLite batch mode for column drops). Downgrade re-adds the column with `server_default=sa.text('1')` (matches precedent; original per-row values are unrecoverable after a column drop — accepted).
- Same migration also adjusts FK constraints per §1 cascade rules: `records.activity_id` → `ondelete="CASCADE"`; `photos.visitor_id` and `photos.activity_id` → nullable + `ondelete="SET NULL"` (if not already nullable); `visits.visitor_id` → `ondelete="CASCADE"`. FK changes on SQLite require batch table recreation — same migration, batch mode.
- Untouched: Master/Location/Service/Material/Client models keep `AbstractModelSoftDelete`; Payment/Visit already migrated.

### 2.2 Backend services & repositories

- Switch services from `get_soft_delete_repository()` / `SoftDeleteRepository` → `get_base_repository()` / `BaseRepository` (hard-delete): `services/tag.py`, `photo.py`, `visitor.py`, `activity.py`, `record.py`, `user_settings.py`. Precedent: `services/payment.py`.
- `GenericService.delete` already delegates to the repo — semantics follow automatically per entity. Update now-inaccurate docstrings: `services/generic.py:51` ("active records"), `:128` ("Soft-delete a record"), and "Soft-delete" wording in `api/v1/{tags,photos,visitors,activities,records}.py`.
- **`GenericService.list` filter** (`services/generic.py:61`): replace the unconditional `self._model.is_active` filter with a class-level capability flag — e.g. `soft_delete = True` on `AbstractModelSoftDelete`, absent/`False` on `AbstractModel` — and apply the filter only when the flag is set. (Panel-rejected alternative: `hasattr` runtime introspection — fragile. The flag doubles as the authoritative declaration of delete semantics.)
- **Remove `is_active` filters / guards** in:
  - `api/v1/search.py` — Visitor (`:30`) and Activity (`:70`) filters removed; Service (`:48`) filter stays (Service remains soft-delete).
  - `services/visitor.py` — `list_by_client` (`:31`).
  - `services/photo.py` — `PhotoService.list` (`:29`) and web endpoint filter `api/v1/photos.py:33-36`.
  - `services/record.py` — `RecordService.list` (`:44-48`); **guard in `RecordService.delete` (`:78`, `if not record or not record.is_active: return False`)** — drop the `is_active` clause; the cascade logic (`:75-94`) must physically delete visits/payments (they have no `is_active` since migration `a1b2c3d4e5f6`).
  - `services/activity.py` — `_list_by_date` (`:57`), bulk seats (`:104`).
  - `services/user_settings.py` — both queries (`:49, :81`).
  - **`domain/record_visits.py:85`** — `active_record_filter()` returns `Record.is_active.is_(True)` — remove the `is_active` condition (affects `check_activity_capacity`, `sum_active_seats`, and activity bulk seats at `activity.py:104`); **`domain/record_visits.py:100`** — `check_activity_capacity` uses `Activity.is_active` — remove.
  - `services/client.py:46,56,65,75` — queries reading `Record.is_active`: remove the filter (rows are now physically gone).
- **Response mappers:** `api/v1/records.py:67` — `_map_record` passes `is_active=record.is_active` into `RecordResponse` — remove the arg (would raise `AttributeError` after the column drop). Check for the same pattern in the other 5 entities' API modules during implementation.
- **ActivityService.delete:** cascade per §1 — explicit deletion of the activity's Records (each record delete cascades to visits/payments) and **nulling of `photos.activity_id`** (photos are NOT deleted, per §1 SET NULL policy — pending G1b confirmation for the Activity→Photo case), inside one transaction; ORM-level `cascade="all, delete-orphan"` / FK `ondelete="CASCADE"` on `Activity.records` as the integrity backstop. **Atomicity requirement:** the entire cascade must be atomic — do NOT call per-record `@transactional` methods in a loop (each commits mid-loop, `services/decorators.py:85`); perform deletions within the outer service transaction.
- **VisitorService.delete:** cascade per §1 — physically delete dependent Visits (`visits.visitor_id`) and **null `photos.visitor_id`** (photos survive the visitor). Service-level handling is mandatory: prod SQLite runs without `PRAGMA foreign_keys`, so DB-level `ondelete` never fires there; tests run with FK ON, so omitting it raises IntegrityError.
- No archive/restore endpoints exist for these entities; PATCH `is_active` restore is only tested for Master/Location/Material/Service (`test_patch_is_active.py`, `test_put_is_active.py`) — not the 6 target entities. Nothing else to remove.

### 2.3 Schemas

Backend `backend/src/schemas/` — remove `is_active` from Response schemas:
- `photo.py` (`PhotoResponse:68`), `visitor.py` (`VisitorResponse:48`), `activity.py` (`ActivityResponse:56`), `record.py` (`RecordResponse:108`).
- `tag.py` and `user_settings.py` have no `is_active` in schemas — nothing to do.
- Patch schemas for these entities already lack `is_active` — nothing to do (issue text says "Response/Patch" but reality: only Response affected).
- **Untouched:** Master/Location/Service/Material/Client schemas keep `is_active`; `list_clients_with_stats` and `ClientListParams.is_active` stay.

`packages/api-client/src/schemas.ts` — remove `is_active` from:
- `PhotoResponseSchema:70`, `ActivityResponseSchema:176`, `VisitorResponseSchema:191`, `RecordResponseSchema:250`.
- `TagResponseSchema` / `UserSettingsResponseSchema` already clean.
- Keepers untouched (Master:13, Location:51, Service:136, Material:433, Client:266).

### 2.4 Frontend (admin)

- **TagsTable** (`frontend/admin/app/(main)/tags/components/TagsTable.tsx`): remove «Статус» column (def `:25`, hardcoded «Активен» badge `:289-296`) and dead `status` filter state (`:56`, no-op `:87-88`).
- **PhotosTable** (`frontend/admin/app/(main)/photos/components/PhotosTable.tsx`): remove status filter `<select>` (`:260-273`), `is_active` filtering (`:91-92`), «Статус» column def (`:30`) and badge (`:389-402`).
- Update affected component test `__tests__/tags/TagsTable.test.tsx` (e2e and vitest mock updates are enumerated in §2.5).
- Untouched: Clients/Masters/Locations/Services/Materials tables (their `include_inactive` filters are a separate follow-up issue).

### 2.5 Tests (backend + api-client + e2e)

Update delete semantics: get-after-delete → 404 (or service-level `None`), deleted rows absent from lists by absence, not by filter.

Backend:
- `test_api_tags.py` — `test_get_deleted_tag_returns_200` → expects 404; `test_delete_tag`, `test_deleted_tag_excluded_from_list` updated to hard-delete semantics.
- `test_api_photos.py`, `test_api_visitors.py`, `test_api_activities.py`, `test_api_records.py` — same class of updates (is_active references at known lines).
- `test_api_user_settings.py:248-257` — `test_delete_sets_is_active_false` → assert row gone from DB.
- `test_generic_service_list.py:111-124` — inactive-tag exclusion case removed/reworked (tags no longer have is_active).
- `conftest.py:764-765` — DB-level `is_active` check for records removed.
- `test_models.py:154,265,727` — model assertions updated (no `is_active` attr on the 6 models).
- `test_schemas_photo.py:27-58` — PhotoResponse `is_active` construct/asserts removed.
- `test_edge_cases.py:528-549` — record "still accessible by ID after delete" + `is_active is False` → inverts to 404.
- `test_record_visits.py:16` — asserts `active_record_filter` SQL has is_active condition → updated (condition removed).
- `test_generic_service_patch.py:453` — `GENERIC_COLUMNS_EXCLUDED` includes `is_active` → becomes per-entity (only soft-delete entities exclude it).
- `test_patch_is_active.py`, `test_put_is_active.py` — untouched (cover only Master/Location/Material/Service).
- New tests: Activity delete cascades to Records (and transitively visits/payments) and nulls `photos.activity_id` (photos survive); Visitor delete cascades to Visits and nulls `photos.visitor_id` (photos survive); atomicity (failure mid-cascade rolls back).

api-client:
- `packages/api-client/src/schemas.test.ts:291,323` — explicit `expect(result.is_active).toBe(true)` for Activity/Photo responses → removed.

E2E (admin) — raw SQL referencing dropped columns must be rewritten:
- `e2e/activity-details-modal.spec.ts:71,80,102,114-141,372-374` (record is_active DB queries).
- `e2e/fixtures/helpers.ts:72,76` (`r.is_active = 1 AND a.is_active = 1`).
- `e2e/unify-caches.spec.ts:48`.
- `e2e/tags-crud.spec.ts:26-28,118-122`, `e2e/photos-crud.spec.ts:26-27` (status column/filter assertions).

Admin vitest mocks carrying `is_active` on the 6 entities (must drop the field to match updated api-client schemas):
- `__tests__/useRecordData.test.tsx:40-94`, `RecordHeader.test.tsx`, `RecordsContext.test.tsx:88`, `ClientsIntegration.test.tsx:156,160`, `clientRecordTabSetup.ts:50-51`, `__tests__/tags/TagsTable.test.tsx`.

### 2.6 Generic test config (brainstorming decisions — IN SCOPE, descoped per panel)

Approved at G1a; panel simplicity review flagged parts as #184 scope. Final decision (surface at G1b):

- **KEPT in this issue:** `EntityConfig` gains `delete_semantics: Literal["soft", "hard"]` — declares expected delete behavior per entity (Tag/Photo/Visitor/Activity/Record/UserSettings → `hard`; Master/Location/Service/Material/Client → `soft`; Payment/Visit → `hard`); generic delete test asserts accordingly. Rationale: the delete-semantics flip is exactly this issue's subject; the config field is the test-side record of the policy.
- **DEFERRED to #184:** merging `test_generic_service_patch.py` into `test_generic_service_crud.py`, and the `update_data` field — pure reorg/patch-contract scope, yields nothing for the deletion refactor itself.

### 2.7 Domain-rules documentation

Update `docs/domain-rules/`:
- `_overview.md` — add the **global deletion policy** (the table in §1) as a cross-entity rule; **also update existing contradicting invariants** `:70` ("Cascade soft-delete: Record → Visits + Payments" → hard-delete) and `:71` ("No cascade: Activity delete does NOT cascade to Records" → cascade hard-delete).
- Per-entity files: `tags.md:15`, `photos.md:20`, `visitors.md` (`:23,:40`), `activities.md:31,36,37,54,67`, `records.md:113,125,144`, `user_settings.md:20` — rewrite soft-delete/archive language to hard-delete ("Cascade soft-delete" → "Cascade hard-delete", "never hard-deleted" → "hard-deleted"); document cascades per §1 in `activities.md` (→Record hard, →Photo SET NULL), `records.md` (→Visit/Payment hard), `visitors.md` (→Visit hard, →Photo SET NULL), `photos.md` (photo is a general resource, survives parent deletion with nulled link).
- Soft-delete keepers' files (`masters`, `locations`, `services`, `materials`, `clients`) — no changes needed (still soft-delete).

## 3. Out of Scope

- #184 CRUD contract itself, incl. merging `test_generic_service_patch.py` into `test_generic_service_crud.py` and the `EntityConfig.update_data` field (deferred per panel simplicity review — was in G1a brainstorming decisions, descoped).
- #178 (`is_active` in Update schemas) — scope narrows to the 5 soft-delete entities, handled separately.
- `include_inactive` list support + front filters for the 5 soft-delete entities (follow-up "Issue B" from #194 body).
- Any changes to Payment/Visit (already hard-delete) and User/Tariff (stay soft-delete).

## 4. Acceptance Criteria

- [ ] Alembic migration drops `is_active` from the 6 tables and updates FK constraints (`records.activity_id` → CASCADE; `visits.visitor_id` → CASCADE; `photos.visitor_id`/`photos.activity_id` → nullable + SET NULL); `alembic upgrade head` + `downgrade` both work (SQLite batch mode).
- [ ] The 6 models subclass `AbstractModel`; the 5 keepers still subclass `AbstractModelSoftDelete`; `Activity.records` has ORM cascade + FK `ondelete="CASCADE"`.
- [ ] DELETE on Tag/Photo/Visitor/Activity/Record/UserSettings physically removes the row; GET after DELETE → 404.
- [ ] DELETE Activity removes its Records (and transitively their visits/payments) — atomically — and nulls `photos.activity_id`; DELETE Visitor removes its Visits and nulls `photos.visitor_id`; photos are never deleted by these cascades.
- [ ] No `is_active` filters/guards remain in code paths of the 6 entities (incl. `domain/record_visits.py`, `_map_record` mappers, `RecordService.delete` guard); Service search filter retained.
- [ ] `GenericService.list` filters via class-level `soft_delete` flag, not `hasattr`.
- [ ] Response schemas (backend + api-client) for Photo/Visitor/Activity/Record expose no `is_active`.
- [ ] TagsTable has no «Статус» column; PhotosTable has no status filter/column.
- [ ] Backend suite green; api-client tests green (no new failures beyond known #188, incl. updated `schemas.test.ts`); admin vitest mocks + touched e2e specs updated/green.
- [ ] `EntityConfig.delete_semantics` added with per-entity values incl. UserSettings; generic delete test asserts per entity.
- [ ] Domain rules: `_overview.md` documents the policy (incl. fixed `:70-71` invariants); 6 entity files updated.

## 5. Visual Compliance Checks

Minor UI surface (column/filter removal only):
- [ ] Tags admin page: table renders without «Статус» column, no layout breakage.
- [ ] Photos admin page: no status `<select>` filter, table renders without «Статус» column.

## 6. Risks & Notes

- **Data:** no production exists — dev instance is re-provisioned («перезалит»); dev data is disposable, no data-migration strategy needed.
- **FK integrity:** prod SQLite runs without `PRAGMA foreign_keys` while tests enable it — the service-level cascades/nulling (§1, §2.2) are the primary mechanism; ORM/FK config is the backstop. Never rely on DB-level FK alone.
- `GenericService.list` class-level flag keeps one code path for both delete semantics and gives #184 an authoritative semantics declaration.
- `search.py` Service filter retained deliberately (Service stays soft-delete).
- Downgrade re-adds `is_active` with `server_default=1` — original per-row values unrecoverable by nature of a column drop (accepted, matches precedent; moot given disposable dev data).
