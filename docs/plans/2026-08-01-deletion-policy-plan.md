# GH #194 Deletion Policy Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Tag/Photo/Visitor/Activity/Record/UserSettings from soft-delete (`is_active`) to hard-delete per the approved policy; cascades: Activity→Record hard, Record→Visit/Payment hard, Visitor→Visit hard, photos' visitor/activity links → SET NULL.

**Architecture:** One alembic migration drops 6 columns + re-creates FK constraints (SQLite batch mode). Models switch base class; a class-level `soft_delete` flag on `AbstractModelSoftDelete` drives `GenericService.list`'s filter so one code path serves both delete semantics. Cascades are implemented service-level (primary; prod SQLite has no FK enforcement) with ORM/FK backstops. Schemas, admin tables, and tests are updated to match.

**Tech Stack:** FastAPI + SQLAlchemy 2.x (async) + Alembic (SQLite), Pydantic; packages/api-client (zod); Next.js admin; pytest / vitest / Playwright.

**Spec:** `docs/specs/2026-08-01-deletion-policy-design.md` (approved at G1b 2026-08-01, pushed to main).

---

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria (backend-heavy feature; only the last two bullets are user-visible):

- **DELETE on Tag/Photo/Visitor/Activity/Record/UserSettings physically removes the row; GET after DELETE → 404** → API consumers get a real 404 for deleted entities instead of a 200 with `is_active: false`; deleted entities disappear from all lists by absence.
- **DELETE Activity removes its Records (+ their visits/payments) atomically; DELETE Visitor removes its Visits; photos are never deleted — their visitor/activity links are nulled** → deleting a занятие wipes its записи; deleting a visitor wipes посещения but photos survive, just unlinked.
- **Response schemas expose no `is_active` for Photo/Visitor/Activity/Record** → API responses and the typed api-client lose the dead field; TypeScript consumers can no longer reference it.
- **TagsTable without «Статус» column; PhotosTable without status filter/column** → admin sees cleaner tags/photos tables: no fake «Активен» badge, no dead status dropdown.
- Everything else (migration, repos, tests, domain docs) is internal — no user-visible change.

---

## Task Overview

| # | Task | Classification |
|---|------|----------------|
| 1 | Alembic migration: drop 6 `is_active` columns + FK re-creation | standard |
| 2 | Models: base-class switch, `soft_delete` flag, FK/cascade config | standard |
| 3 | GenericService.list flag-driven filter + repos/services switch | standard |
| 4 | Remove is_active filters/guards across services + domain + mappers | standard |
| 5 | Delete cascades: Record/Activity/Visitor | large |
| 6 | Backend schemas: drop is_active from 4 Response schemas | small |
| 7 | api-client: schemas + schemas.test.ts | small |
| 8 | Backend test updates (delete semantics, 404s, schema/model asserts) | large |
| 9 | EntityConfig.delete_semantics + generic list/patch test adjustments | standard |
| 10 | Admin frontend: TagsTable + PhotosTable cleanup | standard |
| 11 | Admin test mocks + e2e raw-SQL rewrites | standard |
| 12 | Domain-rules documentation sync | small |

---

## Task 1: Alembic migration — drop 6 is_active columns + FK re-creation

### Classification: standard
### Required Docs
- `docs/specs/2026-08-01-deletion-policy-design.md` §2.1 — migration scope and FK changes
- Precedent migration `backend/alembic/versions/a1b2c3d4e5f6_hard_delete_visit_payment.py` — exact pattern to copy
- `backend/alembic/versions/448bdcc2a6a7_add_tariff_id_to_visits.py` — batch FK drop/create pattern

### Task Description

Create ONE new migration in `backend/alembic/versions/`, revision id `b7c8d9e0f1a2`, filename `b7c8d9e0f1a2_hard_delete_tag_photo_visitor_activity_record_usersettings.py`, `down_revision = 'a1b2c3d4e5f6'`.

**upgrade():**
1. For each table in `('tags', 'photos', 'visitors', 'activities', 'records', 'user_settings')`: `with op.batch_alter_table(<table>, schema=None) as batch_op: batch_op.drop_column('is_active')` — copy the exact style of the precedent migration.
2. FK changes (batch mode recreates the table on SQLite, so FK constraints must be re-declared). Use named constraints so downgrade can target them:
   - `records.activity_id` → recreate FK with `ondelete='CASCADE'`
   - `visits.visitor_id` → recreate FK with `ondelete='CASCADE'`
   - `photos.visitor_id` → recreate FK with `ondelete='SET NULL'`
   - `photos.activity_id` → recreate FK with `ondelete='SET NULL'`
   Pattern per FK (adapt from `448bdcc2a6a7`): inside the table's `batch_alter_table` block, `batch_op.drop_constraint(<existing_fk_name>, type_='foreignkey')` then `batch_op.create_foreign_key(<name>, <referent_table>, [<local_col>], [<remote_col>], ondelete=<...>)`. IMPORTANT: discover the actual existing FK constraint names first — run `sqlite3 <test-or-dev-db> ".schema records"` / `.schema visits` / `.schema photos` (or inspect `Base.metadata` via `cd backend && uv run python -c "from src.db.base import Base; import src.models; [print(t.name, [c.name for c in t.constraints]) for t in Base.metadata.tables.values() if t.name in ('records','visits','photos')]"`). If a constraint is unnamed, batch mode on SQLite still handles it via reflection — verify by running the migration on a scratch copy of the dev DB.
   NOTE: FK changes can be folded into the same `batch_alter_table` block as the column drop for `records` and `photos` (one table recreation per table). `visits` needs its own block (no column drop there).

**downgrade():** reverse order — re-add `is_active sa.Boolean() nullable=False server_default=sa.text('1')` to all 6 tables (exact precedent style), and recreate the 4 FKs without `ondelete`.

**Model parity note:** the migration is applied against models AFTER Task 2 lands (alembic autogenerate is not used; migration is handwritten, so order within the plan doesn't matter for correctness — but `alembic upgrade head` verification in this task runs against the CURRENT models, which is fine: alembic doesn't validate against models here).

**Steps:**
- [ ] Inspect existing FK constraint names (command above)
- [ ] Write the migration file
- [ ] Run `cd backend && uv run alembic upgrade head` — expect clean exit
- [ ] Verify: `sqlite3 <db> ".schema tags"` (and the other 5) — no `is_active`; `.schema photos` shows `FOREIGN KEY ... ON DELETE SET NULL` for visitor_id/activity_id; `.schema records` shows ON DELETE CASCADE on activity_id; `.schema visits` ON DELETE CASCADE on visitor_id
- [ ] Run `cd backend && uv run alembic downgrade -1` then `uv run alembic upgrade head` — both clean
- [ ] Commit: `feat: migration — hard-delete for tag/photo/visitor/activity/record/user_settings (#194)`

**DoD:** upgrade+downgrade+upgrade cycle clean; schemas verified by `.schema` output.

---

## Task 2: Models — base-class switch, soft_delete flag, FK/cascade config

### Classification: standard
### Required Docs
- Spec §1 (policy table), §2.1–2.2
- `docs/domain-rules/_overview.md` — entity relationships

### Task Description

1. **`backend/src/models/abstract.py`:** add class-level flag:
```python
class AbstractModel(Base):
    """Base model with UUID PK and timestamps. No soft-delete flag."""
    __abstract__ = True
    soft_delete: ClassVar[bool] = False
    # ... existing columns unchanged

class AbstractModelSoftDelete(AbstractModel):
    """Extends AbstractModel with a soft-delete flag (is_active)."""
    __abstract__ = True
    soft_delete: ClassVar[bool] = True
    # ... is_active column unchanged
```
(add `from typing import ClassVar` import)

2. **Switch base class** in these 6 files — replace `AbstractModelSoftDelete` with `AbstractModel` in the class def and the import:
   - `backend/src/models/tag.py` (`class Tag(AbstractModelSoftDelete)` :65)
   - `backend/src/models/photo.py` (:17)
   - `backend/src/models/visitor.py` (:16)
   - `backend/src/models/activity.py` (:17)
   - `backend/src/models/record.py` (:16)
   - `backend/src/models/user_settings.py` (:9)

3. **FK `ondelete` config on models** (backstop; service-level cascades in Task 5 remain primary):
   - `record.py:19` — `ForeignKey("activities.id", ondelete="CASCADE")`
   - `visit.py:21` — `ForeignKey("visitors.id", ondelete="CASCADE")` (visitor_id)
   - `photo.py` — `ForeignKey("visitors.id", ondelete="SET NULL")` (visitor_id) and `ForeignKey("activities.id", ondelete="SET NULL")` (activity_id). Both columns already `nullable=True` — no nullability change needed.
   - Do NOT add `ondelete` to `visits.record_id` / `payments.record_id` (record cascade is handled service-level in Task 5 and rows are deleted explicitly; adding it is harmless but unnecessary — skip to keep diff minimal).
   - Do NOT add ORM `relationship()` for Visitor.photos / Visitor.visits / Activity.photos / Activity.records — none exist today and Task 5 does explicit SQL `delete()`/`update()`; avoid new lazy-loading surfaces.

4. **RED test first (TDD):** before editing models, write/adjust a model test asserting `Tag.soft_delete is False`, `Master.soft_delete is True`, and `not hasattr(Tag, "is_active")` — e.g. extend `backend/tests/models/test_models.py` (it currently asserts `is_active` at :154, :265, :727 for some of the 6 models — those assertions flip). Run RED, then implement, then GREEN.

**Steps:**
- [ ] RED: failing assertions in `test_models.py` for the 6 models (no `is_active` attr, `soft_delete is False`)
- [ ] Edit `abstract.py`, the 6 model files, FK ondelete args
- [ ] GREEN: `cd backend && uv run pytest tests/models/test_models.py -q`
- [ ] Also run `cd backend && uv run pytest -m unit --no-cov -q` — expect failures ONLY in files already known to reference `is_active` on the 6 entities (they're fixed in Tasks 4/8/9); if new unexpected failures appear, STOP and report
- [ ] Commit: `feat: switch 6 models to hard-delete base + soft_delete flag (#194)`

**DoD:** model tests green; unit group shows only expected downstream failures.

---

## Task 3: GenericService.list flag-driven filter + repo/service switch

### Classification: standard
### Required Docs
- Spec §2.2
- `backend/src/repositories/generic.py` — BaseRepository vs SoftDeleteRepository
- `backend/src/services/payment.py` — the hard-delete service precedent

### Task Description

1. **`backend/src/services/generic.py`:**
   - `list` (:51-74): replace unconditional `stmt = stmt.where(self._model.is_active)` with:
     ```python
     if self._model.soft_delete:
         stmt = stmt.where(self._model.is_active)
     ```
     Update the NOTE comment (:50) to mention the `soft_delete` class flag, and the docstring (:61 "active records") → "Return a paginated page of records (active only for soft-delete entities), optionally filtered/ordered."
   - `delete` docstring (:128) → "Delete a record (soft or hard depending on the model's repository). Returns True if deleted, False if not found."

2. **Switch repository factory** — in each of these files replace `get_soft_delete_repository` with `get_base_repository` (import + usage in the `@lru_cache` factory), and replace the `SoftDeleteRepository` constructor annotation with `BaseRepository` where present:
   - `services/tag.py` (:5 import, :19 factory)
   - `services/photo.py` (:12, :166)
   - `services/visitor.py` (:8, :40; annotation :20)
   - `services/activity.py` (:12, :126; annotation :30)
   - `services/record.py` (:10, :360; annotation :31)
   - `services/user_settings.py` (:14, :121; annotation :40)

3. **API docstrings** — replace "Soft-delete" wording in DELETE endpoint docstrings of `api/v1/tags.py:112`, `photos.py:130`, `visitors.py:112`, `activities.py:149`, `records.py:166` (e.g. "Delete a tag (hard delete)."). Do not touch locations/clients/services/materials/masters endpoints.

4. TDD anchor: adjust `backend/tests/services/test_generic_service_list.py:111-124` (inactive-tag exclusion case) FIRST — after this task, an inactive-flagged tag can't exist (column dropped), so replace that case with: list returns all rows for a hard-delete entity; and a soft-delete entity (e.g. Master) still excludes `is_active=False` rows. Run RED → implement → GREEN.

**Steps:**
- [ ] RED: updated `test_generic_service_list.py` cases fail
- [ ] Edits per above
- [ ] GREEN: `cd backend && uv run pytest tests/services/test_generic_service_list.py -q`
- [ ] Commit: `feat: flag-driven list filter + BaseRepository for 6 services (#194)`

**DoD:** generic list tests green for both semantics.

---

## Task 4: Remove is_active filters/guards across services, domain, mappers

### Classification: standard
### Required Docs
- Spec §2.2 (the authoritative enumeration)
- `docs/domain-rules/records.md`, `activities.md` — capacity/booking invariants

### Task Description

Remove `is_active` conditions referencing the 6 hard-delete entities at exactly these sites (line numbers from repo exploration 2026-08-01 — re-locate by content, don't trust numbers blindly):

1. `backend/src/api/v1/search.py` — Visitor filter (:30) and Activity filter (:70). **Keep Service (:48).**
2. `backend/src/services/visitor.py` — `list_by_client` (:31): drop `Visitor.is_active` condition.
3. `backend/src/services/photo.py` — `PhotoService.list` (:29); and `backend/src/api/v1/photos.py:33-36` web endpoint filter.
4. `backend/src/services/record.py` — `RecordService.list` (:44-48).
5. `backend/src/services/activity.py` — `_list_by_date` (:57) and bulk seats (:104; this one flows from `active_record_filter` — see item 7).
6. `backend/src/services/user_settings.py` — both queries (:49, :81).
7. `backend/src/domain/record_visits.py`:
   - `active_record_filter()` (:76-86): remove `Record.is_active.is_(True),` line and update docstring ("Active = status IN (waiting, visited)").
   - `check_activity_capacity` (:89-93): change `select(Activity).where(Activity.id == activity_id, Activity.is_active)` → `select(Activity).where(Activity.id == activity_id)`.
8. `backend/src/services/client.py:46,56,65,75` — remove `Record.is_active` conditions (keep any `Client.is_active`/`Visit`-unrelated logic untouched; read each site carefully — only Record conditions on the 6 entities go).
9. `backend/src/api/v1/records.py:67` — `_map_record`: remove the `is_active=record.is_active` kwarg. **Then grep the other 5 entities' API modules for `is_active=` constructor args**: `rg "is_active=" backend/src/api/v1/` — remove every hit belonging to Tag/Photo/Visitor/Activity/Record/UserSettings response construction; keep hits for Master/Location/Service/Material/Client.
10. Final sweep: `rg "is_active" backend/src/` — for every remaining hit, classify: references Tag/Photo/Visitor/Activity/Record/UserSettings → remove; references Master/Location/Service/Material/Client/User/Tariff → keep. Report the kept list in the task report.

TDD: this task is verified by the existing API test suite flipping in Task 8; here run `cd backend && uv run pytest -m api --no-cov -q` and expect failures ONLY from tests asserting old soft-delete semantics (Task 8 fixes them). No new code paths are added — RED/GREEN is expressed via the updated tests in Task 8; if a failure is NOT an old-semantics assertion, fix the code here.

**Steps:**
- [ ] Edits 1–9
- [ ] Sweep 10 + `rg "is_active" backend/src/` classification report
- [ ] `cd backend && uv run pytest -m api --no-cov -q` — only old-semantics failures remain
- [ ] Commit: `feat: drop is_active filters for hard-delete entities (#194)`

**DoD:** no `is_active` references remain for the 6 entities in `backend/src/`; sweep report lists kept references (all soft-delete keepers).

---

## Task 5: Delete cascades — Record, Activity, Visitor

### Classification: large
### Required Docs
- Spec §1 (cascade rules), §2.2 (atomicity requirement)
- `backend/src/services/decorators.py` — `@transactional` semantics (mid-loop commit trap)
- `docs/domain-rules/activities.md`, `records.md`, `visitors.md`

### Task Description

All three cascades execute explicit SQL inside the OUTER service transaction. **Never call per-record `@transactional` methods in a loop** (each commits mid-loop, `decorators.py:85`).

1. **`backend/src/services/record.py` — `RecordService.delete` (:74-94)** rewrite to:
```python
    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete a record and its visits and payments."""
        record = await self._repository.get(db_session, Record, id)
        if not record:
            return False

        await db_session.execute(delete(Visit).where(Visit.record_id == id))
        await db_session.execute(delete(Payment).where(Payment.record_id == id))
        await db_session.execute(delete(Record).where(Record.id == id))
        return True
```

2. **`backend/src/services/activity.py` — add `ActivityService.delete`** (no delete exists today — API endpoint `api/v1/activities.py:149` currently goes through the generic repo path; check and rewire it to the service method):
```python
    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete an activity, its records (with their visits/payments),
        and unlink photos (SET NULL)."""
        activity = await self._repository.get(db_session, Activity, id)
        if not activity:
            return False

        record_ids = (
            await db_session.execute(
                select(Record.id).where(Record.activity_id == id)
            )
        ).scalars().all()
        if record_ids:
            await db_session.execute(delete(Visit).where(Visit.record_id.in_(record_ids)))
            await db_session.execute(delete(Payment).where(Payment.record_id.in_(record_ids)))
            await db_session.execute(delete(Record).where(Record.id.in_(record_ids)))
        await db_session.execute(
            update(Photo).where(Photo.activity_id == id).values(activity_id=None)
        )
        await db_session.execute(delete(Activity).where(Activity.id == id))
        return True
```
(add `update` to the sqlalchemy import; import `Photo`.) Rewire `api/v1/activities.py` DELETE endpoint to call `ActivityService.delete` instead of the repository/generic delete.

3. **`backend/src/services/visitor.py` — add `VisitorService.delete`** (no delete exists today; rewire `api/v1/visitors.py:112` endpoint):
```python
    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete a visitor and its visits; unlink photos (SET NULL)."""
        visitor = await self._repository.get(db_session, Visitor, id)
        if not visitor:
            return False

        await db_session.execute(delete(Visit).where(Visit.visitor_id == id))
        await db_session.execute(update(Photo).where(Photo.visitor_id == id).values(visitor_id=None))
        await db_session.execute(delete(Visitor).where(Visitor.id == id))
        return True
```

4. **Tests FIRST (RED-GREEN)** — write these failing tests before the implementations (new file `backend/tests/services/test_delete_cascades.py`, follow pytest-patterns skill, use existing fixtures from `tests/conftest.py` — check fixture names for create_activity/create_record/create_visit/create_payment/create_visitor/create_photo):
   - record delete removes record + visits + payments; GET record → 404 at API level covered in Task 8, here service-level: repo.get returns None
   - activity delete removes activity + its records + their visits/payments; photos keep existing with `activity_id IS NULL`
   - visitor delete removes visitor + its visits; photos keep existing with `visitor_id IS NULL`
   - activity with no records/photos deletes cleanly
   - atomicity: monkeypatch one of the cascade statements to raise (e.g. the payments delete) → assert activity AND all its records still exist afterwards

**Steps:**
- [ ] RED: write `test_delete_cascades.py`, run — fails (no methods / old semantics)
- [ ] Implement 1–3 + endpoint rewiring
- [ ] GREEN: `cd backend && uv run pytest tests/services/test_delete_cascades.py -q`
- [ ] Regression: `cd backend && uv run pytest -m api --no-cov -q` — only old-semantics failures (Task 8)
- [ ] Commit: `feat: hard-delete cascades for record/activity/visitor (#194)`

**DoD:** cascade tests green incl. atomicity; endpoints call service methods.

---

## Task 6: Backend schemas — drop is_active from 4 Response schemas

### Classification: small
### Required Docs
- Spec §2.3
- Skill `pytest-patterns` (test update)

### Task Description

Remove the `is_active` field line from:
- `backend/src/schemas/photo.py:68` — `PhotoResponse`
- `backend/src/schemas/visitor.py:48` — `VisitorResponse`
- `backend/src/schemas/activity.py:56` — `ActivityResponse`
- `backend/src/schemas/record.py:108` — `RecordResponse`

(Confirmed: `tag.py`, `user_settings.py` schemas have no `is_active`; Patch schemas of the 4 have none — nothing else to change. Master/Location/Service/Material/Client schemas untouched.)

Update `backend/tests/schemas/test_schemas_photo.py:27-58` — remove `is_active` construct-args/asserts.

**Steps:**
- [ ] Remove 4 field lines + fix `test_schemas_photo.py`
- [ ] `cd backend && uv run pytest tests/schemas/ -q`
- [ ] `rg "is_active" backend/src/schemas/` — only keeper schemas remain (master, location, service, material, client)
- [ ] Commit: `feat: drop is_active from Photo/Visitor/Activity/Record response schemas (#194)`

**DoD:** schema tests green; grep clean except keepers.

---

## Task 7: api-client — schemas + schemas.test.ts

### Classification: small
### Required Docs
- Spec §2.3
- `packages/api-client/src/schemas.ts`

### Task Description

1. Remove `is_active: z.boolean(),` from `PhotoResponseSchema` (:70), `ActivityResponseSchema` (:176), `VisitorResponseSchema` (:191), `RecordResponseSchema` (:250) in `packages/api-client/src/schemas.ts`. Keepers (Master:13, Location:51, Service:136, Material:433, Client:266) untouched.
2. `packages/api-client/src/schemas.test.ts:291,323` — remove `expect(result.is_active).toBe(true)` assertions (Activity/Photo cases) and any `is_active` in the input fixtures for the 4 schemas.

**Steps:**
- [ ] Edits
- [ ] `cd packages/api-client && pnpm test` — expect green except the 4 known #188 failures (datetime in schemas.test.ts — unrelated, pre-existing)
- [ ] `rg "is_active" packages/api-client/src/schemas.ts` — keepers only
- [ ] Commit: `feat: drop is_active from 4 api-client response schemas (#194)`

**DoD:** api-client tests at baseline (136p/4f known-#188); grep clean except keepers.

---

## Task 8: Backend test updates — delete semantics flips

### Classification: large
### Required Docs
- Spec §2.5 (authoritative enumeration)
- Skill `pytest-patterns`
- `docs/domain-rules/_overview.md` §deletion policy

### Task Description

Flip old soft-delete assertions to hard-delete semantics. For API tests: `DELETE` → subsequent `GET` returns **404** (not 200 with is_active:false); list endpoints no longer contain the deleted id. Exact sites:

1. `backend/tests/api/test_api_tags.py` — `test_get_deleted_tag_returns_200` (:54) → rename `test_get_deleted_tag_returns_404`, assert 404; `test_delete_tag` (:78) → assert row gone at DB level (query session, is None); `test_deleted_tag_excluded_from_list` (:85) → keep name/intent, create+delete then assert absence (no is_active fixture setup — remove any `is_active=False` fixtures).
2. `backend/tests/api/test_api_photos.py` — web endpoint is_active asserts (:14-45) removed; `test_deleted_photo_not_in_list` (:177) → absence semantics.
3. `backend/tests/api/test_api_visitors.py` (:43, :109), `test_api_activities.py` (:87, :159), `test_api_records.py` (:52, :194) — same treatment.
4. `backend/tests/api/test_api_user_settings.py:248-257` — `test_delete_sets_is_active_false` → `test_delete_removes_row`: DB query returns None.
5. `backend/tests/conftest.py:764-765` — remove DB-level `is_active` check for records.
6. `backend/tests/models/test_models.py:154,265,727` — Task 2 already flipped model assertions; verify consistency (no double-change conflict — if Task 2 handled them, skip).
7. `backend/tests/api/test_edge_cases.py:528-549` — record "still accessible by ID after delete" + `is_active is False` → assert 404 after delete.
8. `backend/tests/unit/test_record_visits.py:16` — asserts `active_record_filter` SQL yields "3 WHERE conditions: activity_id, is_active, status IN" → now 2 conditions (activity_id, status IN).
9. Untouched: `test_patch_is_active.py`, `test_put_is_active.py` (keepers only) — confirm they still pass unchanged.
10. Sweep: `rg "is_active" backend/tests/` — every hit on the 6 entities gets flipped/removed; keeper hits stay. Report the kept list.

**Steps:**
- [ ] Apply edits 1–8
- [ ] `cd backend && uv run pytest` — FULL backend suite green (this is the task where the suite returns to green; target: ≥787p/3s baseline, no new failures)
- [ ] Sweep 10 report
- [ ] Commit: `test: flip backend tests to hard-delete semantics (#194)`

**DoD:** full backend suite green; grep report shows only keeper references.

---

## Task 9: EntityConfig.delete_semantics + generic test adjustments

### Classification: standard
### Required Docs
- Spec §2.6
- Skill `pytest-patterns`
- `backend/tests/services/test_generic_service_patch.py` — EntityConfig (:79-90), CONTRACT_CONFIG (:94-207), GENERIC_COLUMNS_EXCLUDED (:453)

### Task Description

1. In `backend/tests/services/test_generic_service_patch.py`:
   - `EntityConfig` gains field: `delete_semantics: Literal["soft", "hard"]` (import Literal; NamedTuple field without default — update ALL existing entries).
   - Per-entity values: ActivityService→`hard`, ClientService→`soft`, LocationService→`soft`, MasterService→`soft`, MaterialService→`soft`, PaymentService→`hard`, TagService→`hard`, VisitorService→`hard` (match the actual CONTRACT_CONFIG keys :94-207; add UserSettingsService→`hard` only if a config entry for it already exists — do NOT create new entity configs, that's #184 scope).
   - `GENERIC_COLUMNS_EXCLUDED` (:453): drop `"is_active"` from the set → `{"id", "created_at", "updated_at"}`. Rationale: `is_active` is now a real column only on soft-delete entities and should be column-checked there like any other. If this breaks the column-parity check for hard-delete entities (column no longer exists → nothing to check) vs soft-delete entities (column exists and IS checked) — verify by running; adjust only if the check logic itself needs a `model.soft_delete` guard.
2. Add a **generic delete-semantics test** (in the same file or `test_generic_service_list.py` — implementer's call, same file preferred): parametrized over CONTRACT_CONFIG, for each entity create → delete via service → assert per `delete_semantics`: `hard` → `repository.get(...) is None` (or service get returns None/raises); `soft` → row still fetchable with `is_active == False`. Skip entities whose service has no generic delete path (PaymentService uses BaseRepository already — include it as `hard`).
3. Fix `test_generic_service_list.py:74-86` if not already covered by Task 3 edits (filter behavior per flag).

**Steps:**
- [ ] Edits + new parametrized test
- [ ] `cd backend && uv run pytest tests/services/ -q`
- [ ] Commit: `test: EntityConfig.delete_semantics + generic delete test (#194)`

**DoD:** services test group green; delete_semantics documented in a comment referencing the spec.

---

## Task 10: Admin frontend — TagsTable + PhotosTable cleanup

### Classification: standard
### Required Docs
- Spec §2.4
- `docs/domain-rules/tags.md`, `photos.md`
- Skill `vitest-playwright-patterns` (component test update)

### Task Description

1. **`frontend/admin/app/(main)/tags/components/TagsTable.tsx`:**
   - Remove «Статус» column def (:25) and the hardcoded «Активен» badge cell (:289-296).
   - Remove dead `status` filter state (:56) and its no-op usage (:87-88 comment block).
   - Update `frontend/admin/__tests__/tags/TagsTable.test.tsx` — remove status-column assertions.
2. **`frontend/admin/app/(main)/photos/components/PhotosTable.tsx`:**
   - Remove status filter `<select>` («Все статусы»/«Активен»/«Архив», :260-273) and any related state.
   - Remove `is_active` filtering logic (:91-92).
   - Remove «Статус» column def (:30) and the «Активен»/«Архив» badge cell (:389-402).
3. Type-check: after Task 7, `photo.is_active` etc. no longer typecheck — `cd frontend/admin && pnpm run type-check` must be clean; remove any other `is_active` references to the 4 entities that surface (rg `is_active` in `frontend/admin/app/(main)/tags`, `.../photos`).

**Steps:**
- [ ] Edits + component test updates
- [ ] `cd frontend/admin && pnpm run test` (vitest) — green
- [ ] `cd frontend/admin && pnpm run type-check` — clean
- [ ] Commit: `feat: drop status column/filter from Tags & Photos admin tables (#194)`

**DoD:** vitest green, type-check clean, no `is_active` in tags/photos admin code.

---

## Task 11: Admin test mocks + e2e raw-SQL rewrites

### Classification: standard
### Required Docs
- Spec §2.5 (admin vitest + e2e enumerations)
- Skill `vitest-playwright-patterns` (Full Cycle pattern for e2e)

### Task Description

1. **Vitest mocks** — remove `is_active` from mock objects of the 6 entities (TS excess-property / zod strict failures against updated api-client schemas):
   - `frontend/admin/__tests__/useRecordData.test.tsx:40-94`
   - `frontend/admin/__tests__/RecordHeader.test.tsx`
   - `frontend/admin/__tests__/RecordsContext.test.tsx:88`
   - `frontend/admin/__tests__/ClientsIntegration.test.tsx:156,160`
   - `frontend/admin/__tests__/clientRecordTabSetup.ts:50-51`
   Sweep: `rg "is_active" frontend/admin/__tests__/` — flip/remove hits for Record/Activity/Photo/Visitor/Tag; keep Client/Master/etc.
2. **E2E raw SQL** (dropped columns → "no such column" hard-fails):
   - `frontend/admin/e2e/activity-details-modal.spec.ts:71,80,102,114-141,372-374` — record is_active DB queries: drop the `r.is_active = 1` / `a.is_active = 1` conditions (rows are physically gone now).
   - `frontend/admin/e2e/fixtures/helpers.ts:72,76` — same.
   - `frontend/admin/e2e/unify-caches.spec.ts:48` — same.
   - `frontend/admin/e2e/tags-crud.spec.ts:26-28,118-122` — remove «Статус»-column assertions; `photos-crud.spec.ts:26-27` — remove status filter/column assertions.
   Sweep: `rg "is_active" frontend/admin/e2e/` — classify and fix all hits on the 6 entities.
3. Run e2e: `cd frontend/admin && CI= pnpm exec playwright test --project=shard-rest --workers=1` for the touched specs (tags-crud, photos-crud, unify-caches) and `--project=shard-schedule` for activity-details-modal. Full `pnpm test:all` runs at finishing time.

**Steps:**
- [ ] Mock edits + vitest green
- [ ] E2E edits + targeted Playwright runs green
- [ ] Commit: `test: admin mocks + e2e for hard-delete semantics (#194)`

**DoD:** vitest green; targeted e2e specs pass; grep sweeps reported.

---

## Task 12: Domain-rules documentation sync

### Classification: small
### Required Docs
- Spec §2.7
- Skill `domain-rules`

### Task Description

1. `docs/domain-rules/_overview.md` — add the global deletion-policy table (spec §1 verbatim, incl. User/Tariff stays-soft-delete line); fix invariant `:70` ("Cascade soft-delete: Record → Visits + Payments" → cascade **hard**-delete) and `:71` ("No cascade: Activity delete does NOT cascade to Records" → Activity delete cascades to Records, hard).
2. Rewrite soft-delete/archive language to hard-delete in:
   - `tags.md:15` (soft-delete block: is_active flag, SoftDeleteRepository, GET-by-id 200 — invert all)
   - `photos.md:20` ("archived, never hard-deleted" → hard-deleted; photo is a general resource — survives visitor/activity deletion with nulled link)
   - `visitors.md` (:23 "only active visitors" filter note; :40 "Soft delete" → hard delete; add cascade: visits hard-deleted, photos SET NULL)
   - `activities.md:31,36,37,54,67` (is_active in occupied calc / date filter; add cascade: records hard-deleted, photos SET NULL)
   - `records.md:113,125,144` (cascade soft-delete → hard-delete)
   - `user_settings.md:20` ("archived, never hard-deleted" → hard-deleted)
3. Keepers' files (masters, locations, services, materials, clients) — no changes.

**Steps:**
- [ ] Edits
- [ ] Commit: `docs: sync domain rules with hard-delete policy (#194)`

**DoD:** deletion policy documented; no contradicting "soft-delete"/"never hard-deleted" language remains for the 6 entities (`rg -i "soft.delete|is_active|archive" docs/domain-rules/` → keeper entities only).

---

## Self-Review

- **Spec coverage:** §2.1→T1/T2; §2.2→T2/T3/T4/T5; §2.3→T6/T7; §2.4→T10; §2.5→T8/T9/T11; §2.6→T9; §2.7→T12. AC items all mapped. ✅
- **Placeholders:** FK constraint names in T1 marked "discover first" with the exact discovery command — intentional (names are environment facts, not placeholders). ✅
- **Ordering:** T1↔T2 are order-independent (handwritten migration). T8 is the suite-green gate; T3/T4/T5 land before it. T7 before T10/T11 (api-client types drive frontend). ✅
- **Classification:** T5/T8 large (multi-file logic / broad test surface); T1/T2/T3/T4/T9/T10/T11 standard; T6/T7/T12 small. ✅
