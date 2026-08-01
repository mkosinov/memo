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

**Cascade rule:** deleting an Activity hard-deletes its Records. (Record delete already cascades to visits/payments — that cascade switches from soft to hard along with the rest.) No other cascade changes.

**Rationale:** `is_active` on nearly every entity bloats API schemas, leaves dead UI status filters, and complicates contracts. Soft-delete is kept only where archive/restore is real domain value (clients, staff, catalog).

## 2. Scope

### 2.1 Models + Alembic migration

- Drop `is_active` column from tables: `tags`, `photos`, `visitors`, `activities`, `records`, `user_settings`.
- Models `Tag`, `Photo`, `Visitor`, `Activity`, `Record`, `UserSettings`: switch base class `AbstractModelSoftDelete` → `AbstractModel`.
- One alembic migration, head = `a1b2c3d4e5f6` (`hard_delete_visit_payment` is the precedent — same pattern). Downgrade re-adds the column (default `true` for existing rows).
- Untouched: Master/Location/Service/Material/Client models keep `AbstractModelSoftDelete`; Payment/Visit already migrated.

### 2.2 Backend services & repositories

- Switch services from `get_soft_delete_repository()` / `SoftDeleteRepository` → `get_base_repository()` / `BaseRepository` (hard-delete): `services/tag.py`, `photo.py`, `visitor.py`, `activity.py`, `record.py`, `user_settings.py`. Precedent: `services/payment.py`.
- `GenericService.delete` already delegates to the repo — semantics follow automatically per entity.
- **Remove `is_active` filters** in:
  - `services/generic.py` — `GenericService.list` (`:61`): the filter must apply only to models that still have `is_active` (soft-delete set). Implementation: apply the filter conditionally (e.g. `hasattr(self._model, "is_active")`) so one generic path serves both sets.
  - `api/v1/search.py` — Visitor (`:30`) and Activity (`:70`) filters removed; Service (`:48`) filter stays (Service remains soft-delete).
  - `services/visitor.py` — `list_by_client` (`:31`).
  - `services/photo.py` — `PhotoService.list` (`:29`) and web endpoint filter `api/v1/photos.py:33-36`.
  - `services/record.py` — `RecordService.list` (`:44-48`).
  - `services/activity.py` — `_list_by_date` (`:57`).
  - `services/user_settings.py` — both queries (`:49, :81`).
- **ActivityService.delete**: add cascade — hard-delete all Records of the activity (each record delete cascades to visits/payments via existing `RecordService.delete` logic, which must be converted from soft to hard semantics).
- **Client-side queries reading `Record.is_active`** (`services/client.py:46,56,65,75`) and **activity bulk seats** (`activity.py:104`): since records are now physically gone, these filters are removed (rows simply won't exist).
- No archive/restore endpoints exist; "restore" today is only possible via PATCH `is_active` — irrelevant for these entities after the column is dropped. Nothing else to remove.

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
- Update affected component tests (`__tests__/tags/TagsTable.test.tsx`) and e2e (`e2e/tags-crud.spec.ts:26-28,118-122`, `photos-crud.spec.ts:26-27`).
- Untouched: Clients/Masters/Locations/Services/Materials tables (their `include_inactive` filters are a separate follow-up issue).

### 2.5 Tests (backend)

Update delete semantics: get-after-delete → 404 (or service-level `None`), deleted rows absent from lists by absence, not by filter.

- `test_api_tags.py` — `test_get_deleted_tag_returns_200` → expects 404; `test_delete_tag`, `test_deleted_tag_excluded_from_list` updated to hard-delete semantics.
- `test_api_photos.py`, `test_api_visitors.py`, `test_api_activities.py`, `test_api_records.py` — same class of updates (is_active references at known lines).
- `test_api_user_settings.py:248-257` — `test_delete_sets_is_active_false` → assert row gone from DB.
- `test_generic_service_list.py:111-124` — inactive-tag exclusion case removed/reworked (tags no longer have is_active).
- `conftest.py:764-765` — DB-level `is_active` check for records removed.
- `test_models.py:154,265,727` — model assertions updated (no `is_active` attr on the 6 models).
- `test_patch_is_active.py`, `test_put_is_active.py` — untouched (cover only Master/Location/Material/Service).
- New test: Activity delete cascades to Records (and their visits/payments).

### 2.6 Generic test config (brainstorming decisions — IN SCOPE)

Approved at G1a as preparatory refactoring inside this issue:

- Merge the patch-contract file `backend/tests/services/test_generic_service_patch.py` into a new `test_generic_service_crud.py` (the merged file is written against the new policy; #184 will extend it).
- `EntityConfig` gains two explicit fields:
  - `update_data: dict` — explicit per-entity patch payload (replaces implicit derivation).
  - `delete_semantics: Literal["soft", "hard"]` — declares expected delete behavior per entity; generic delete test asserts accordingly (soft → `is_active=False` + still fetchable; hard → row gone / 404).
- Entity coverage in config updated: Tag/Photo/Visitor/Activity/Record → `hard`; Master/Location/Service/Material/Client → `soft`; Payment/Visit → `hard`.

### 2.7 Domain-rules documentation

Update `docs/domain-rules/`:
- `_overview.md` — add the **global deletion policy** (the table in §1) as a cross-entity rule.
- Per-entity files: `tags.md:15`, `photos.md:20`, `visitors.md` (`:23,:40`), `activities.md:31,37`, `records.md:113,125,144`, `user_settings.md:20` — rewrite soft-delete/archive language to hard-delete; document Activity→Record cascade in `activities.md`/`records.md`.
- Soft-delete keepers' files (`masters`, `locations`, `services`, `materials`, `clients`) — no changes needed (still soft-delete).

## 3. Out of Scope

- #184 CRUD contract itself (the merged `test_generic_service_crud.py` is groundwork; full contract per new policy lands in #184).
- #178 (`is_active` in Update schemas) — scope narrows to the 5 soft-delete entities, handled separately.
- `include_inactive` list support + front filters for the 5 soft-delete entities (follow-up "Issue B" from #194 body).
- Any changes to Payment/Visit.

## 4. Acceptance Criteria

- [ ] Alembic migration drops `is_active` from the 6 tables; `alembic upgrade head` + `downgrade` both work.
- [ ] The 6 models subclass `AbstractModel`; the 5 keepers still subclass `AbstractModelSoftDelete`.
- [ ] DELETE on Tag/Photo/Visitor/Activity/Record physically removes the row; GET after DELETE → 404.
- [ ] DELETE Activity removes its Records (and transitively their visits/payments).
- [ ] No `is_active` filters remain in code paths of the 6 entities; Service search filter retained.
- [ ] Response schemas (backend + api-client) for Photo/Visitor/Activity/Record expose no `is_active`.
- [ ] TagsTable has no «Статус» column; PhotosTable has no status filter/column.
- [ ] Backend test suite green; api-client tests green (no new failures beyond known #188); admin vitest/e2e touched specs green.
- [ ] `test_generic_service_crud.py` exists with `update_data` + `delete_semantics` in EntityConfig; old patch-contract file removed.
- [ ] Domain rules: `_overview.md` documents the policy; 6 entity files updated.

## 5. Visual Compliance Checks

Minor UI surface (column/filter removal only):
- [ ] Tags admin page: table renders without «Статус» column, no layout breakage.
- [ ] Photos admin page: no status `<select>` filter, table renders without «Статус» column.

## 6. Risks & Notes

- **Data:** migration drops columns — existing archived (`is_active=false`) rows of the 6 entities will be kept as live rows after the column drop. Decision: keep them (they become ordinary rows); flag to user at gate if undesired.
- `GenericService.list` conditional filter keeps one code path for both delete semantics — avoids forking the generic service ahead of #184.
- `search.py` Service filter retained deliberately (Service stays soft-delete).
