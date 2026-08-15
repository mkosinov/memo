# GH #207 — DELETE hard delete + granular dependency resolutions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 5 soft-delete entities (Master, Location, Service, Material, Client) to real hard delete with a granular dependency-resolution mechanism, move archive/restore to dedicated `POST /archive` + `POST /restore` endpoints, and establish an `is_active`↔`archived` terminology boundary at the Service layer.

**Architecture:** One vocabulary per layer. `is_active` stays in DB/Model/Repo; `archived: bool` (inverted: `true` = in archive) is the API/Frontend contract. `ArchiveService` translates at the boundary and exposes `archive()`/`restore()` methods. DELETE runs a service-level resolution transaction (nullify → cascade → hard delete) guarded by a 409 dry-run preview. `PRAGMA foreign_keys=ON` adds a DB backstop. All FK-blocking relations (activities) force archive instead of delete.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async) + SQLite + Pydantic v2 (backend); Next.js 14 + TypeScript + Zod + React Query (frontend api-client + admin).

**Spec:** `docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md` (all § refs point there).

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **DELETE with no deps → instant hard delete** → user clicks "Удалить" on a Material (or any entity with zero deps); the row vanishes immediately, no dialog. A subsequent GET → 404.
- **DELETE with dependencies → 409 + dependency tree** → user clicks "Удалить" on an entity with FK dependents; a dialog lists what will be deleted (cascade →) / unlinked (nullify ○) with counts. Type-to-confirm enables "Удалить"; clicking it sends `DELETE /{id}` **with body** `{resolutions}` executing the resolution in one transaction.
- **DELETE with blocking deps (activities) → archive instead** → user clicks "Удалить" on a Master/Location/Service that has activities; dialog says "Нельзя удалить: есть N активностей. Сначала удалите их или архивируйте"; primary button is "[Архивировать]" — delete is not offered.
- **DELETE /{id} resolutions (body — Change 1)** → invalid resolution (e.g. `records: "cascade"` when only nullify allowed) → 422; missing required non-auto dep → 422; correct resolutions → 204 (visitors+visits gone, records survive with `client_id=null`, payments survive with their records). Same path/verb as dry-run; body presence = execute.
- **DELETE Master → deletes the linked user account (Change 2 §4.1)** → deleting a master with a linked user row hard-deletes the user automatically (auto-cascade, no choice) — "→ Пользователь: 1 (удалён)" in the dialog.
- **Master archive/restore cascades to the user login (Change 3 §4.2)** → archiving a master also deactivates its linked account (`users.is_active=False`, can't log in); restoring reactivates it. Master-only special case.
- **POST /{id}/archive + POST /{id}/restore** → "В архив" → **HTTP 200 with body** carrying `archived: true` (the frontend updates the row without a refetch — spec §12 S3/S5 literally said "204" but 204 carries no body, so the plan picks 200-with-body); "Восстановить" → 200 with `archived: false`. Works for all 5 including Client (#198 closed). Master cascades the user login per above.
- **PUT/PATCH rejects is_active (#178)** → sending `is_active` in a PUT or PATCH body → 422. Archive/restore only via the two dedicated endpoints.
- **Response schema `archived` inversion** → all 5 entity responses expose `archived: bool` (`true` = in archive); the DB column `is_active` is no longer surfaced to the API for these 5.
- **DB FK backstop** → SQLite connections now `PRAGMA foreign_keys=ON`; service-level transactions remain primary, FK is the safety net.
- **409 cascade_preview (Client only)** → the Client delete dialog shows downstream cascade counts ("Visits: 45") — payments are excluded (record-scoped, survive nullify).

---

## File Map

**Backend:**
- `backend/src/db/database.py` — connect listener: add `PRAGMA foreign_keys=ON` (Task 1)
- `backend/src/repositories/generic.py` — rename `SoftDeleteRepository` → `ArchiveRepository`; remove `delete()` override (hard inherited); rename factory (Task 2)
- `backend/src/services/generic.py` — rename `SoftDeleteService` → `ArchiveService`; add `archive()`/`restore()`; remove `_strip_is_active_none` (Task 3 + Task 6)
- `backend/src/services/{master,location,service,material,client}.py` — inherit `ArchiveService`, update imports (Task 3)
- `backend/src/services/visitor.py` — extract `_delete_cascade(visitor, session)` non-decorated core (Task 7)
- `backend/src/services/client.py` — `list_clients_with_stats` second inversion point (`:210`) (Task 4); `delete()` resolution transaction (Task 10)
- `backend/src/services/service.py` — remove `_strip_is_active_none` import/usage (Task 6)
- `backend/src/schemas/{master,location,service,material,client}.py` — Response: `is_active`→`archived` (inverted); Update/Patch: drop `is_active` (Tasks 4, 5)
- `backend/src/api/v1/{masters,locations,services,materials,clients}.py` — DELETE→hard+409 (no body) / execute-with-resolutions (with body, Change 1); add `POST /archive` + `POST /restore` incl. Master→user cascade (Tasks 9, 10, 11)
- `backend/src/domain/deletion.py` — NEW: FK matrix + dependency resolver + 409 builder (Task 8)
- `backend/tests/generic_contract.py` — `EntityConfig.delete_semantics` flip soft→hard for the 5 (Task 12)
- `backend/tests/services/test_generic_service_contract.py` — delete=hard assertion update (Task 12)
- `backend/tests/test_put_is_active.py`, `backend/tests/test_patch_is_active.py` — invert to 422 (Task 13)
- `backend/tests/test_api_{masters,locations,services,materials,clients}.py` — new 409/POST-delete/archive/restore tests (Tasks 13, 14)

**Frontend api-client:**
- `packages/api-client/src/schemas.ts` — Response `is_active`→`archived` (inverted) on 5 entities + `ClientWithStatsSchema`; Update schemas drop `is_active` (Task 15)
- `packages/api-client/src/endpoints.ts` — add `archiveX`/`restoreX` (5 each, POST); `deleteX` stays (no-body dry-run); add `resolveDeleteX(id, resolutions)` (**DELETE with body**, Change 1) (Task 16)
- `packages/api-client/src/schemas.test.ts`, `endpoints.test.ts` — update inversions + new method tests (Tasks 15, 16)

**Frontend admin:**
- `frontend/admin/hooks/use{Masters,Locations,Services,Materials}Mutations.ts` — patch→archive/restore; delete→409-aware + resolve (Task 17)
- `frontend/admin/contexts/ClientsContext.tsx` — same for Client + add restore parity (Task 17)
- `frontend/admin/app/components/DeleteDialog.tsx` — NEW shared dialog (Mode A + Mode B) (Task 18)
- `frontend/admin/app/(main)/{masters,locations,services,materials,clients}/components/XTable.tsx` — wire dialog + archive/restore (Task 19)
- `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`, `ClientCardModal.tsx` — restore parity + new delete (Task 19)
- `frontend/admin/__tests__/helpers/mockData.ts` + per-entity table test fixtures — `is_active`→`archived` (Task 20)
- `frontend/admin/e2e/*.spec.ts` — S1-S7 new specs (Task 21)

**Domain docs:**
- `docs/domain-rules/_overview.md` + per-entity files for the 5 — update deletion policy + terminology (Task 23)

---

## Task 1: Enable PRAGMA foreign_keys=ON in the SQLite connect listener
### Classification: trivial

### Required Docs
- Spec `docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md` §11.3, §14 (FK AC), §16

### Task Description
Add `PRAGMA foreign_keys=ON` to the existing connect listener in `backend/src/db/database.py:16-43` (currently sets only `busy_timeout` + `WAL`). One line, after the existing two `cursor.execute(...)` calls and before `cursor.close()`. No Alembic migration — the listener runs per-connection at connect time.

### Steps
- [ ] **RED:** Add a regression test in `backend/tests/test_database.py` (create if absent, else add to an existing DB pragma test) that opens a connection and asserts `PRAGMA foreign_keys` returns 1 (ON). Run `pytest backend/tests/test_database.py -k foreign_keys` → fails (currently OFF).
  ```python
  async def test_sqlite_foreign_keys_enabled_on_connect(db_session):
      result = await db_session.execute(text("PRAGMA foreign_keys"))
      assert result.scalar() == 1, "PRAGMA foreign_keys must be ON per #207 §11.3"
  ```
- [ ] **GREEN:** Edit `backend/src/db/database.py` `_set_sqlite_pragmas` — after `cursor.execute("PRAGMA journal_mode=WAL")` add:
  ```python
      cursor.execute("PRAGMA foreign_keys=ON")
  ```
- [ ] Run the full backend suite (`pytest backend/tests/` via the dev workflow) to confirm no existing test breaks under FK-ON (tests already run FK-on via `conftest.py:86,142`, so prod parity is achieved). If a raw-SQL write path raises an IntegrityError → that path has a latent bug and must be fixed in this task (none expected — entity set unchanged).
- [ ] Commit: `feat(db): enable PRAGMA foreign_keys=ON on SQLite connections (#207)`

---

## Task 2: Rename SoftDeleteRepository → ArchiveRepository, make delete = hard
### Classification: standard

### Required Docs
- Spec §3.3 (Repository), §9 (Rename), §14 (rename AC)
- `backend/src/repositories/generic.py` (current `SoftDeleteRepository:117-174`, `get_soft_delete_repository:187-190`)

### Task Description
Rename `SoftDeleteRepository` → `ArchiveRepository`. **Remove the `delete()` override** (the soft-delete `is_active=False` setter at `:153-159`) so `delete` is inherited hard from `BaseRepository.delete()` (`:87-96`). Keep `list()` (with `?status=` filter) and `reorder()` (the is_active-aware variant). Rename factory `get_soft_delete_repository()` → `get_archive_repository()`; update the `GenericRepository` alias (`:178`) and `get_generic_repository()` (`:193-196`) to point at the renamed class. Grep-rename all callers of `get_soft_delete_repository` / `SoftDeleteRepository` across `backend/src/`.

### Steps
- [ ] **RED:** Add a test in `backend/tests/repositories/test_generic_repository.py` (or `test_repositories.py`) asserting `ArchiveRepository` has no own `delete` method overriding hard delete semantics — equivalently, that `inspect.getmembers(ArchiveRepository, predicate=...).delete` is `BaseRepository.delete`. Run → fails (still named SoftDeleteRepository).
- [ ] **GREEN:** In `backend/src/repositories/generic.py`:
  - Rename class `SoftDeleteRepository` → `ArchiveRepository` (line 117).
  - Delete the `async def delete(self, session, table, id)` block (lines 153-159) — `delete` now inherited from `BaseRepository` (hard).
  - Keep `list()` and `reorder()` overrides (they reference `ArchiveStatus` / `is_active` — unchanged).
  - Update docstring of the class (it now does hard delete + archive-status list filtering).
  - Rename `get_soft_delete_repository()` → `get_archive_repository()` (lines 187-190); update the `GenericRepository = SoftDeleteRepository` alias (`:178`) → `GenericRepository = ArchiveRepository`; same for `get_generic_repository()` (`:193-196`).
- [ ] Grep `backend/src/` for `SoftDeleteRepository` and `get_soft_delete_repository` — update every import + call site (the 5 entity service factories at `services/{master,location,service,material,client}.py` use `get_soft_delete_repository()`). Use a project-wide rename; verify with `grep -rn "SoftDeleteRepository\|get_soft_delete_repository" backend/src/` → empty.
- [ ] Run `pytest backend/tests/` — the existing `test_delete_*` contract tests for the 5 entities that asserted `is_active=False` will now FAIL (that's the expected signal flowing into **Task 12** — the contract `delete_semantics` flip soft→hard). Note them; do not fix yet (Task 12 owns the contract assertion update). For this task: only the rename + override-removal must land; tests that asserted soft behavior are intentionally red until Task 12.
- [ ] Commit: `refactor(repo): rename SoftDeleteRepository→ArchiveRepository, delete=hard inherited (#207)`

> **Note:** This task causes downstream test redness (Task 12 fixes the contract redness, Task 13 the put/patch-is_active redness). That's expected — the rename is the foundational mechanical step. If the implementer finds the redness blocks local verification, sequence Task 12 (and Task 13) immediately after.

---

## Task 3: Rename SoftDeleteService → ArchiveService, add archive()/restore()
### Classification: standard

### Required Docs
- Spec §3.4 (Service), §9 (Rename), §14
- `backend/src/services/generic.py` (`SoftDeleteService:189`, the 5 entity services)

### Task Description
Rename `SoftDeleteService` → `ArchiveService`. Add two methods: `archive(db_session, id) -> bool` (sets `is_active=False` via `repo.patch`, returns `True`/`False` for found/not-found — the API route (Task 11) re-fetches the entity to build the `archived`-carrying response, mirroring DELETE's `service.delete → bool` contract) and `restore(db_session, id) -> bool` (sets `is_active=True`, same bool contract). Update the 5 entity services (Master, Location, Service, Material, Client) to inherit `ArchiveService` instead of `SoftDeleteService`. Update all imports.

### Steps
- [ ] **RED:** In `backend/tests/services/test_generic_service_contract.py` (or a new `test_archive_service.py`), add a test that an `ArchiveService` subclass has `archive`/`restore` methods and they flip `is_active`. Use a representative subclass (e.g. Master). Run → fails (methods don't exist).
- [ ] **GREEN:** In `backend/src/services/generic.py`:
  - Rename `class SoftDeleteService(GenericService[...])` → `class ArchiveService(GenericService[...])` (line 189). Update docstring.
  - Add methods (place after the existing `_list_stmt`/`list` overrides):
    ```python
    @transactional
    async def archive(self, db_session: AsyncSession, id: str) -> bool:
        """Archive a record (set is_active=False). Returns False if not found."""
        return await self._repository.patch(db_session, self._model, id, {"is_active": False})

    @transactional
    async def restore(self, db_session: AsyncSession, id: str) -> bool:
        """Restore an archived record (set is_active=True). Returns False if not found."""
        return await self._repository.patch(db_session, self._model, id, {"is_active": True})
    ```
    (Verify `BaseRepository.patch` exists and sets + flushes; if it doesn't return a row, the API route will re-fetch — see Task 11 for the response mapping contract.)
- [ ] Grep `backend/src/` for `SoftDeleteService` and update all imports + class bases (`services/{master,location,service,material,client}.py`, plus any test-construction imports). The `GENERIC_CONTRACT_EXCEPTIONS` set (`generic_contract.py:95`) currently contains `SoftDeleteService` as an abstract intermediate base — update to `ArchiveService`.
- [ ] Run `pytest backend/tests/` — verify the new `archive`/`restore` test passes; the still-red soft-delete contract tests (`test_generic_service_contract.py` `TestGenericServiceDeleteSemantics` for the 5) remain red until **Task 12** (the contract flip — NOT Task 13).
- [ ] Commit: `refactor(svc): rename SoftDeleteService→ArchiveService, add archive()/restore() (#207)`

---

## Task 4: Backend Response schemas — is_active → archived (inverted), 5 entities + ClientWithStats
### Classification: standard

### Required Docs
- Spec §3.1 (Response schema + inversion, incl. ClientWithStats second point), §14
- `backend/src/schemas/{master,location,service,material,client}.py`

### Task Description
For each of the 5 entities, replace `is_active: bool` (currently on `XResponse`) with `archived: bool` where `archived = not is_active` (inversion). The DB column stays `is_active`; Pydantic's `from_attributes` reads the ORM attribute — so we must NOT expose `is_active` directly. Add a computed-field / validator that derives `archived` from `is_active` (Pydantic v2 `@computed_field` or `model_validator`). For `ClientWithStatsResponse` (extends `ClientResponse`, built manually at `client.py:210`): invert the manual `is_active=row.is_active` to `archived = not row.is_active`.

### Steps
- [ ] **RED:** For each entity, in `backend/tests/test_schemas_*.py` (e.g. `test_schemas_master.py`), add: `assert hasattr(XResponse.model_fields, 'archived')` + `archived` inverts `is_active`. Run → fails (no `archived` field). For Client add a `ClientWithStats` inversion test asserting `archived = not is_active`.
- [ ] **GREEN:** In `backend/src/schemas/master.py`:
  - Remove `is_active: bool = Field(...)` from `MasterResponse` (currently `:55`).
  - Add:
    ```python
    from pydantic import computed_field
    class MasterResponse(MasterBase):
        # ... existing fields ...
        @computed_field
        @property
        def archived(self) -> bool:
            return not self.is_active
    ```
    (Note: `self.is_active` requires the model class to carry the attribute. Since `MasterResponse` uses `from_attributes=True`, define `is_active` on the schema as a private/excluded field read from the ORM — use `is_active: bool = Field(..., exclude=True)` so it is parsed from ORM but NOT serialized; `archived` computed from it surfaces to the API. Verify Pydantic v2 supports `exclude=True` on `from_attributes` parse + `computed_field` reading it.)
- [ ] Apply the identical pattern to `LocationResponse`, `ServiceResponse`, `MaterialResponse`, `ClientResponse` (each carries `is_active` on its model; the schema reads it excluded and exposes `archived` computed).
- [ ] `backend/src/schemas/client.py`: `ClientWithStatsResponse` extends `ClientResponse` → inherits the `archived` computed field. No schema edit needed, BUT the manual builder in `services/client.py:210` (`is_active=row.is_active`) must change to pass the ORM attribute, which the computed field reads — actually since the computed field derives `archived` from the stored `is_active`, the builder should STOP passing `is_active=row.is_active` (the Pydantic model will read it via `from_attributes` from the ORM row OR the constructor — verify the `ClientWithStats(...)` construction path supplies `is_active`). If `ClientWithStats` is **constructed positionally** (not from an ORM object), pass `is_active=row.is_active` AND let `archived` derive — OR better: build from `ClientWithStatsResponse.model_validate(row)` if `row` is an ORM-shaped object. The plan: keep passing `is_active=row.is_active` in the builder (the schema still accepts it as a constructor kwarg via the excluded field) — the computed `archived` derives from it. The AC is: API response exposes `archived`, not `is_active`. Verify with a test that the serialized JSON has `archived` and lacks `is_active`.
- [ ] Run `pytest backend/tests/ -k "schema or client"`. Fix any serializer-excluding-`is_active` issue. The API-level `test_api_*.py` assertions on `is_active` in responses will now fail — those are owned by **Task 13** (put/patch-is_active + archive/restore endpoint tests abs the response `archived` field) and **Task 14** (new 409/POST-delete scenario tests asserting `archived` in responses).
- [ ] Commit: `feat(schema): is_active→archived (inverted) on 5 entity Response schemas + ClientWithStats (#207)`

---

## Task 5: Backend PUT/PATCH schemas — remove is_active (auto-closes #178)
### Classification: small

### Required Docs
- Spec §3.2 (PUT/PATCH schemas — is_active removed), §10 (#178 auto-closed), §14
- `backend/src/schemas/{master,location,service,material,client}.py`

### Task Description
Remove `is_active` from all `XUpdate` and `XPatch` (where present) schemas for the 5 entities. After this, PUT/PATCH with `is_active` in the body → 422 (extra/unsupported field — FastAPI's behavior for strict Pydantic models; if the model uses `extra="forbid"` it's 422, if `extra="ignore"` the field is silently dropped — verify the base config and ensure the 422 path: set `extra="forbid"` on the update schemas if not already, OR rely on the existing config). Archive/restore only via POST endpoints.

### Steps
- [ ] **RED:** Add 422 tests in `backend/tests/test_{put,patch}_is_active.py` (or a new `test_update_rejects_is_active.py`) — for each of the 5 entities, PUT/PATCH with `is_active: true` in the body → 422. Run → fails (currently accepted).
- [ ] **GREEN:** In each `schemas/{master,location,service,material,client}.py`:
  - `MasterUpdate` etc.: remove `is_active: bool = Field(...)`.
  - For `ClientUpdate` (the GH #201 canonical full-replace with required `is_active` at `:283-289`): remove `is_active` from the required fields. Client PUT no longer takes `is_active` — the per-entity test #201 must adapt: the GH #201 canonical PUT is now a PUT of the *non-is_active* personal fields; archive/restore is POST.
  - Ensure `model_config = ConfigDict(extra="forbid")` (or whatever the base config is) so a stray `is_active` → 422 rather than silently ignored. If `extra="forbid"` would break other existing-allowed fields, instead add an explicit validator `@model_validator(mode="before")` that raises `ValueError` if `is_active` is present in the input data — this gives a clean 422 with a clear `detail`. Pick the cleaner option and document it in the commit message.
- [ ] Run `pytest backend/tests/test_put_is_active.py backend/tests/test_patch_is_active.py` — the existing tests assert acceptance and will now FAIL (the expected signal — they are flipped to 422-assertions in Task 13). Do not edit Task 13's tests in this task; the redness is the design signal that Task 5 + Task 13 close together.
- [ ] Commit: `feat(schema): remove is_active from PUT/PATCH — #178 auto-closed (#207)`

---

## Task 6: Remove dead _strip_is_active_none + GENERIC_COLUMNS_EXCLUDED is_active entry
### Classification: small

### Required Docs
- Spec §3.2, §14 (dead-code AC)
- `backend/src/services/generic.py:45-53` (`_strip_is_active_none`), callers at `generic.py:222` and `services/service.py:179`
- `backend/src/services/generic.py` or wherever `GENERIC_COLUMNS_EXCLUDED` lives (search for the constant)

### Task Description
Once `is_active` is removed from PATCH schemas (Task 5), the `_strip_is_active_none` helper is dead code (no `is_active` ever in a patch payload). Delete the helper + remove both call sites (`SoftDeleteService._patch_payload` at `generic.py:222`, `ServiceService.patch` at `service.py:179` — including the import at `service.py:18`). Also find the `GENERIC_COLUMNS_EXCLUDED` constant (the contract test config) and remove its `is_active` entry if present (it was a list of columns excluded from generic patch — `is_active` no longer needs exclusion because it's not a patch field).

### Steps
- [ ] **RED:** Add a test in `backend/tests/services/test_generic_service_patch.py` (or contract) that PATCH with `is_active` in body → 422 or the field is never stripped (assert the strip helper is gone via a grep-test on the source, OR assert the patch path raises). Run → expected behavior is no `_strip_is_active_none` exists.
- [ ] **GREEN:** Delete `_strip_is_active_none` from `services/generic.py:45-53`. Remove the call in `_patch_payload` (`:222`) — `SoftDeleteService`/`ArchiveService._patch_payload` should just return `super()._patch_payload(data)`. Update `services/service.py:18` import + `:179` call site.
- [ ] Find `GENERIC_COLUMNS_EXCLUDED` (grep `backend/tests/`) and remove `"is_active"`/`"is_active"` from the list; verify the contract test still passes for non-is_active columns.
- [ ] Run `pytest backend/tests/ -k "patch and not is_active"` → confirm the generic-patch contract tests (excluding `test_patch_is_active.py`, which stays red until **Task 13** flips it to 422-asserts) pass green. The `is_active` strip no longer fires; the field is forbidden by Task 5's schema. (Do not run `-k patch` alone — that would include the still-red `test_patch_is_active.py` and confuse the implementer.)
- [ ] Commit: `refactor(svc): remove dead _strip_is_active_none + GENERIC_COLUMNS_EXCLUDED is_active (#207)`

---

## Task 7: VisitorService._delete_cascade — extract non-decorated shared core
### Classification: standard

### Required Docs
- Spec §8 (atomicity requirement — BLOCKER-class), §14 (Client→visitors cascade AC)
- `backend/src/services/visitor.py:37-59` (`VisitorService.delete` @transactional)
- `backend/src/services/decorators.py:41-88` (`@transactional` commits at `:85`)

### Task Description
The current `VisitorService.delete` is one `@transactional` method that deletes visits → photos SET NULL → visitor_tags → visitor. Extract its body into a **non-decorated** inner method `_delete_cascade(self, session, visitor_id) -> bool` that operates on the passed session WITHOUT committing. Keep `VisitorService.delete` as the decorated public wrapper that calls `_delete_cascade`. This lets `ClientService.delete` (Task 10) call `_delete_cascade` inside its OWN `@transactional` cascade loop on the shared outer session — atomicity preserved (one commit at the outer boundary, not N mid-loop commits).

### Steps
- [ ] **RED:** Add a test in `backend/tests/services/test_visitor_service.py` asserting `_delete_cascade` is callable as a non-decorated method (does NOT call `session.commit()` directly — inspect that calling it leaves the session uncommitted; the existing `VisitorService.delete` calls it then commits per the wrapper). Run → fails (`_delete_cascade` doesn't exist yet). **Note:** the full atomicity test (visitor loop rolled back on mid-cascade failure) lives in **Task 14** — it requires `ClientService.resolve_delete` (Task 10) to exist; do NOT attempt that test in Task 7.
- [ ] **GREEN:** In `backend/src/services/visitor.py`:
  - Rename the body of `delete` into `_delete_cascade`:
    ```python
    async def _delete_cascade(self, db_session: AsyncSession, visitor_id: str) -> bool:
        """Delete visits → photos SET NULL → visitor_tags → visitor on the given session. NO commit (caller owns the transaction)."""
        visitor = await self._repository.get(db_session, Visitor, visitor_id)
        if not visitor:
            return False
        await db_session.execute(delete(Visit).where(Visit.visitor_id == visitor_id))
        await db_session.execute(update(Photo).where(Photo.visitor_id == visitor_id).values(visitor_id=None))
        await db_session.execute(delete(visitor_tags).where(visitor_tags.c.visitor_id == visitor_id))
        await db_session.execute(delete(Visitor).where(Visitor.id == visitor_id))
        return True
    ```
  - Keep the public decorated method:
    ```python
    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        return await self._delete_cascade(db_session, id)
    ```
- [ ] Run `pytest backend/tests/services/test_visitor_service.py` (existing visitor cascade tests) → still green (the decorated wrapper behaves identically).
- [ ] Commit: `refactor(visitor): extract _delete_cascade non-decorated core for atomic reuse (#207)`

---

## Task 8: Domain layer — FK matrix + dependency resolver + 409 builder
### Classification: large

### Required Docs
- Spec §4 (FK matrix — the full table), §5 (409 response shape), §11 (facts), §14
- `backend/src/domain/deletion.py` (NEW file)

### Task Description
Create `backend/src/domain/deletion.py` — the single source of truth for the FK matrix (§4) and the dependency resolver. Contains:
1. `FKDependency` dataclass: `entity: str`, `relation: str`, `nullable: bool`, `action: Literal["block","nullify","cascade"]`, `auto: bool`, `allowed_actions: list[str]`, `message: str | None`.
2. `FK_MATRIX: dict[type, list[FKDependency]]` — the full §4 table per entity model (Master, Location, Service, Material, Client). Material = `[]` (no deps). For the others, list each FK relation as per §4.
3. `ResolutionError(Exception)` — defined HERE (raised by `validate_resolutions` / the executor in Task 10): subtypes `BlockingDepsError` (activities present — 422 "archive instead") and `InvalidResolutionError` (wrong action / missing dep — 422). The DELETE-with-body route (Task 9, Change 1) catches these and maps to HTTP 422. Defining the exception in the domain module keeps it out of the API layer.
4. `async def collect_dependencies(session, model, entity_id) -> list[DependencyNode]` — for the entity, run COUNT queries for each FK relation; return the 409 `dependencies` array (with `count`, `allowed_actions`, `message`, and `cascade_preview` for Client→visitors with `{"visits": N}` — payments EXCLUDED per §5). Skip zero-count deps (only deps with count > 0 appear in the tree).
5. `def has_blocking_deps(nodes) -> bool` — True if any node has `allowed_actions == []`.
6. `def validate_resolutions(model, nodes, resolutions_body) -> list[ValidationError]` — for each non-auto dep with count > 0: a resolution is required; the action must be in `allowed_actions`; blocked deps (allowed_actions=[]) → 422 always (no resolution accepts them); auto deps → ignored (any user-sent value for an auto dep is ignored, per §16). Returns a list of errors (empty = valid).

### Steps
- [ ] **RED:** In `backend/tests/domain/test_deletion.py` (NEW): write tests for each entity's `FK_MATRIX`:
  - Material: `FK_MATRIX[Material] == []`.
  - Master: deps = activities (block), **users (cascade, auto — Change 2 §4.1)**, master_tags (cascade, auto).
  - Location: activities (block), location_tags (cascade, auto).
  - Service: activities (block), tariffs (cascade, auto), photos (nullify, auto), service_tags (cascade, auto).
  - Client: records (nullify, non-auto), visitors (cascade, non-auto), client_tags (cascade, auto).
  Plus `collect_dependencies` returns the right counts (seed 1 master+3 activities+1 user+2 tags → activities count 3, users count 1, master_tags count 2). Plus `validate_resolutions` returns errors for missing/wrong action, OK for correct — and ignores auto deps (Master→users, tags) even if the user sends them. Run → all fail.
- [ ] **GREEN:** Create `backend/src/domain/deletion.py` with the dataclass + matrix + functions per the spec §4/§5. Use SQLAlchemy `select(func.count()).where(...)` for each dep. For `cascade_preview` on Client→visitors: count visits via `select(func.count(Visit.id)).join(Visitor, Visit.visitor_id == Visitor.id).where(Visitor.client_id == entity_id)`. Do NOT query payments.
- [ ] Verify the 409 response shape matches §5 exactly: `{"detail":"has_dependencies", "dependencies":[{"entity":..., "count":..., "allowed_actions":..., "message":..., "cascade_preview":...}]}`.
- [ ] Run `pytest backend/tests/domain/test_deletion.py` → green.
- [ ] Commit: `feat(domain): FK matrix + dependency resolver + 409 builder (#207)`

---

## Task 9: DELETE /{id} → unified dry-run (no body) + execute (with body) route (all 5 API modules)
### Classification: standard

### Required Docs
- Spec §2 (Change 1 — unified DELETE endpoint), §5 (409 dry-run), §6 (DELETE with body = execute), §14
- `backend/src/api/v1/{masters,locations,services,materials,clients}.py` (current DELETE route, e.g. `masters.py:132-147`)
- `backend/src/domain/deletion.py` (Task 8 — collect_dependencies); the `resolve_delete` executor comes in Task 10

### Task Description
The single `DELETE /{id}` route handles both modes per Change 1:
- **No body (dry-run):** call `collect_dependencies(session, model, id)`. If empty → `service.delete` (hard) → 204 (row deleted). If non-empty → 409 with the dependency tree JSON (`detail: "has_dependencies"`, `dependencies: [...]`).
- **With body `{"resolutions": {...}}` (execute):** call `service.resolve_delete(session, id, resolutions)` (the executor built in Task 10) inside one transaction → 204 on success; 422 on invalid/missing resolution (caught `ResolutionError`); 404 if entity not found.

FastAPI accepts an optional `Body` on a DELETE route: `resolutions: dict[str, str] | None = Body(default=None)`. When `resolutions is None` → dry-run path; when not None → execute path. On 404 (entity not found) → 404 (same for both paths). Material always 204 on the no-body path (empty deps).

### Steps
- [ ] **RED:** In `backend/tests/test_api_masters.py` (and the 4 siblings): add tests covering BOTH modes — (a) no-body path: master+activities → DELETE (no body) → 409 + activities dep; master+user+tags (no activities) → DELETE (no body) → 409 + users (`["cascade"]`, auto) + master_tags; bare master → DELETE (no body) → 204, GET → 404. (b) with-body path: master+user+tags (no activities) → DELETE body `{}` → 204, assert master gone + **user row hard-deleted** (DB query, §4.1) + tags gone; master+activities → DELETE body `{}` → 422 ("blocking"); client+records+visitors+visits+payments+tags → DELETE body `{"resolutions":{"records":"nullify","visitors":"cascade"}}` → 204 + the S4 cascade assertions from Task 10's RED (do not duplicate — reference); DELETE body `{"resolutions":{"records":"cascade"}}` → 422. Run → fail.
- [ ] **GREEN:** In each `api/v1/{masters,locations,services,materials,clients}.py` update the DELETE route to dispatch on body presence:
  ```python
  from fastapi import Body
  @router.delete("/{entity_id}", status_code=204)
  async def delete_entity(
      entity_id: str,
      service: _ServiceDep,
      session: SessionDep,
      resolutions: dict[str, str] | None = Body(default=None),
  ) -> None:
      if resolutions is not None:
          # Execute path (Change 1 — body present)
          try:
              ok = await service.resolve_delete(db_session=session, id=entity_id, resolutions=resolutions)
          except ResolutionError as e: raise HTTPException(status_code=422, detail=str(e))
          if not ok: raise HTTPException(status_code=404, detail=ErrorDetail(...).model_dump())
          return  # 204
      # Dry-run path (no body)
      deps = await collect_dependencies(session, EntityModel, entity_id)
      if deps:
          raise HTTPException(status_code=409, detail={"detail": "has_dependencies", "dependencies": [d.model_dump() for d in deps]})
      deleted = await service.delete(db_session=session, id=entity_id)
      if not deleted:
          raise HTTPException(status_code=404, detail=ErrorDetail(...).model_dump())
  ```
  (Use the existing error-code conventions; the 409 `detail` is a dict per FastAPI.)
- [ ] Run the new API tests + existing 404 tests. The previous soft-delete-is-active assertions are handled in Task 12/13.
- [ ] Commit: `feat(api): unified DELETE route — dry-run (no body) + execute (with body) (#207)`

---

## Task 10: Resolution transaction executor (`service.resolve_delete`) — domain + service layer
### Classification: large

### Required Docs
- Spec §6 (DELETE-with-body execution rules — full), §4 (FK matrix, incl. Master→users §4.1), §8 (atomicity + VisitorService._delete_cascade), §14
- `backend/src/services/{client,master,location,service,material}.py`, `backend/src/domain/deletion.py`
- `backend/src/services/visitor.py` (Task 7 — `_delete_cascade`)

### Task Description
Build the `resolve_delete(db_session, entity_id, resolutions: dict[str, str]) -> bool` executor (the implementation behind Task 9's with-body DELETE route). Called by the DELETE-with-body path; NOT a separate endpoint. Flow:
1. Collect deps (Task 8). If any blocked (`allowed_actions == []`, i.e. activities) → raise `BlockingDepsError` → API returns 422 ("entity has blocking dependencies — archive instead").
2. `validate_resolutions` → if errors → raise `InvalidResolutionError` → 422 with details.
3. Execute in ONE `@transactional` method: **nullify** non-auto nullify deps (set their FK to NULL); **cascade** non-auto cascade deps (Client→visitors: loop `visitor_service._delete_cascade(session, visitor_id)` on the shared session — atomic, single commit); then **auto** deps (Master→users §4.1 hard-delete the linked user row, tags/tariffs — cascade; Service photos — nullify); then **hard-delete** the entity row.
4. 204 on success (route returns no body). 404 if entity not found (`False` return).

**Per-entity transactions:**
- **Master:** hard-delete linked `users` row (auto-cascade §4.1) → delete `master_tags` (auto) → hard-delete master. No user-choice deps if no activities. (`resolutions` body is `{}`.)
- **Location:** delete `location_tags` (auto) → hard-delete location. (`resolutions` body is `{}`.)
- **Service:** nullify `photos.service_id` (auto) → delete `tariffs` (auto) → delete `service_tags` (auto) → hard-delete service. (`resolutions` body is `{}`.)
- **Material:** just hard delete (no deps — Task 9's no-body path already returns 204).
- **Client:** nullify `records.client_id` (non-auto, user choice `nullify`) → cascade `visitors` (non-auto, user choice `cascade` — loop `_delete_cascade` on shared session, visits → photos SET NULL → visitor_tags → visitor) → delete `client_tags` (auto) → hard-delete client. (`resolutions` body = `{"records":"nullify","visitors":"cascade"}`.)

The atomicity rule (§8): ONE `@transactional` method on the service, calling `visitor_service._delete_cascade(session, vid)` in a loop — NO per-visitor commit. The Master→users hard-delete and tags-deletes happen on the same outer session.

### Steps
- [ ] **RED:** Integration tests in `backend/tests/test_api_clients.py` — S4 scenario: seed client+records+visitors+visits+payments+client_tags; DELETE (no body) → 409; DELETE with body `{"resolutions":{"records":"nullify","visitors":"cascade"}}` → 204; assert records survive with `client_id=NULL`, payments survive with records, visitors/visits/client_tags gone, client gone. Plus the §6 422 tests on the with-body path: wrong action (`records:"cascade"`), missing dep (no `visitors`), blocked-deps-present (clients can't have activities — use Master+activities for the blocked test). Plus atomicity: a mid-cascade failure (mock `_delete_cascade` raise on 2nd visitor) rolls back — assert client still present, records still linked, first visitor NOT deleted. **Master→users cascade test:** seed master+user+tags (no activities); DELETE with body `{}` → 204; assert **user row gone** (DB query `users WHERE master_id = master.id` → 0) + master gone + tags gone. Run → fail.
- [ ] **GREEN:** Add the resolution executor. Put it on the service (cleaner — has `self._model` + `self._repository`); the entity-specific per-dependency deletes/nullifies can dispatch on `self._model` against the `FK_MATRIX` (Task 8). For Client→visitors loop: `for v in visitors: await self._visitor_service._delete_cascade(db_session, v.id)` — single session, single outer commit. For Master→users: `await db_session.execute(delete(User).where(User.master_id == entity_id))` (the user row itself has no further dependents — verify with an explore check; if user has FK dependents, follow any existing cascade; the explore earlier did not flag user dependents, so a plain hard delete is expected to work). Sketch:
```python
  @transactional
  async def resolve_delete(self, db_session, entity_id, resolutions: dict[str, str]) -> bool:
      nodes = await collect_dependencies(db_session, self._model, entity_id)
      if has_blocking_deps(nodes): raise BlockingDepsError("blocking dependencies — archive instead")
      errors = validate_resolutions(self._model, nodes, resolutions)
      if errors: raise InvalidResolutionError(...)
      # 1. nullify non-auto nullify deps
      # 2. cascade non-auto cascade deps (Client→visitors via visitor_service._delete_cascade in a loop)
      # 3. auto deps: Master→users hard delete (delete(User).where(master_id==id)), *_tags delete, Service tariffs delete, Service photos SET NULL
      # 4. hard delete entity row (self._repository.delete)
      return True
  ```
  (The `ClientService` needs a reference to `VisitorService` — inject via the existing DI factory or construct in `__init__`; document the choice.) A `MasterService`-specific executor is NOT required if the generic dispatch over `FK_MATRIX[Master]` covers the users auto-cascade — but if Master→users has user-table-specific logic (verify no downstream user FKs), a `MasterService.resolve_delete` override is cleaner. Pick the design that avoids `if model is Master` branches in the generic executor; document it in the commit.
- [ ] The route wiring is already done in Task 9 (the with-body path calls `service.resolve_delete`). Verify the route's `except ResolutionError` catches both `BlockingDepsError` and `InvalidResolutionError` (they're subtypes — Python catches the base).
- [ ] Run `pytest backend/tests/test_api_clients.py -k delete` + the 4 siblings — green. The atomicity test passes only because `_delete_cascade` (Task 7) shares the session without committing.
- [ ] Commit: `feat(svc): resolve_delete transaction executor — nullify→cascade(auto+users)→hard (#207)`

---

## Task 11: POST /{id}/archive + POST /{id}/restore routes (5 entities) + Master→user cascade
### Classification: standard

### Required Docs
- Spec §2 (API surface: archive/restore — HTTP 200 with body), §3.4 (Service archive/restore — Master-only user cascade), §4.2 (Master archive/restore cascades to user.is_active — Change 3), §14
- `backend/src/api/v1/{masters,locations,services,materials,clients}.py`
- `backend/src/services/generic.py` (ArchiveService.archive/restore from Task 3), `backend/src/services/master.py`

### Task Description
Add two POST routes per entity. Both return **HTTP 200 with body** (the re-fetched entity serialized with `archived`) — the frontend updates the row without a refetch (the spec §12 S3/S5 literally said "204" but 204 carries no body, so the plan picks 200-with-body; G2 approved). `POST /{id}/archive` → `service.archive(session, id)` (sets `is_active=False`) → 200 `archived: true`. `POST /{id}/restore` → `service.restore(session, id)` → 200 `archived: false`. 404 if not found. Idempotent (archive an archived row → still 200 `archived: true`).

**Master-only cascade (Change 3, §4.2):** `MasterService.archive()` and `restore()` OVERRIDE the generic `ArchiveService` methods to additionally write the linked `users.is_active` (find `User` where `users.master_id == master.id`, set `is_active` to match) in the SAME transaction as the master's `is_active` patch. This is a Master-specific override — do NOT add it to the generic `ArchiveService` (the other 4 entities don't cascade).

### Steps
- [ ] **RED:** In `backend/tests/test_api_masters.py` etc.: test archive → 200 with body `archived: true` + DB `is_active=False`; restore → 200 `archived: false` + DB `is_active=True`; archive a non-existent id → 404; restore a non-existent id → 404; archive an already-archived → idempotent 200 (still `archived: true`); restore an active → idempotent 200. Assert `?status=archived` now returns the archived row. **Master-only extra test (§4.2):** seed master+linked user (user `is_active=True`); `POST /masters/{id}/archive` → 200, assert `users.is_active=False` (DB query); `POST /masters/{id}/restore` → 200, assert `users.is_active=True`. The other 4 entities' archive/restore must NOT touch any user (no user link — assert no DB change to users). Run → fail.
- [ ] **GREEN:** In each `api/v1/{masters,locations,services,materials,clients}.py` add:
  ```python
  @router.post("/{entity_id}/archive", response_model=XResponse)
  async def archive_entity(entity_id: str, service: _ServiceDep, session: SessionDep):
      ok = await service.archive(db_session=session, id=entity_id)
      if not ok: raise HTTPException(404, ...)
      return await service.get(db_session=session, id=entity_id)  # re-fetch → serialized with archived

  @router.post("/{entity_id}/restore", response_model=XResponse)
  async def restore_entity(...):
      ok = await service.restore(db_session=session, id=entity_id)
      ...
      return await service.get(...)
  ```
  (Adapt to the actual `get` signature; the response is the `XResponse` with `archived` computed via Task 4's schema.)
- [ ] **GREEN (Master cascade §4.2):** In `backend/src/services/master.py`, override `archive`/`restore`:
  ```python
  @transactional
  async def archive(self, db_session, id: str) -> bool:
      ok = await super().archive(db_session, id)  # flips master.is_active=False (super's @transactional commits — see note)
      if not ok: return False
      # Cascade to linked user
      await db_session.execute(update(User).where(User.master_id == id).values(is_active=False))
      return True
  # Same shape for restore() with is_active=True.
  ```
  **Atomicity caveat:** the generic `ArchiveService.archive` (Task 3) is itself `@transactional` → commits. Overriding it and calling `super().archive()` then doing the user write would mean TWO commits (master first, then user) — NOT atomic. To fix: either (a) have `MasterService.archive` NOT call super but instead replicate the master `repo.patch` + the user write in ONE `@transactional` method (preferred — explicit, atomic); or (b) refactor `ArchiveService.archive` into a `_archive_core(session, id)` non-decorated helper (mirrors Task 7's `_delete_cascade` pattern) and override `MasterService.archive` to call `_archive_core` + the user write in one `@transactional`. **Recommended: approach (a)** — Master has exactly one cascade, replicating the patch is 2 lines, no need to refactor the generic. Document the choice in the commit message.
- [ ] Run the new tests → green (incl. the Master→user cascade assertions).
- [ ] Commit: `feat(api): POST /archive + POST /restore (200-with-body), Master→user cascade (#207)`

---

## Task 12: Update GenericService contract tests — delete=hard, archive/restore contract
### Classification: standard

### Required Docs
- Spec §10 (#184/#185 reconciliation), §14
- `backend/tests/generic_contract.py:95` (`GENERIC_CONTRACT_EXCEPTIONS`), `:122-149` (`EntityConfig`), `:153+` (`CONTRACT_CONFIG` with `delete_semantics`)
- `backend/tests/services/test_generic_service_contract.py:390-436` (`TestGenericServiceDeleteSemantics` + `:438-454` nonexistent test)

### Task Description
The contract test currently asserts the 5 soft-delete entities' `delete_semantics == "soft"` and that the row remains with `is_active=False` after delete. Flip them: `delete_semantics == "hard"` for the 5, and `TestGenericServiceDeleteSemantics` asserts the row is physically gone after `service.delete`. Add a new contract assertion class `TestArchiveServiceArchiveRestore` that asserts `archive()`/`restore()` flip the DB `is_active` column (assert `is_active=False` after `archive()`, `True` after `restore()`); the **route** re-fetches to build the `archived`-carrying response body — the contract test asserts the bool service contract (the mapped response is asserted at the API route level in Task 13). `ServiceService` stays in `GENERIC_CONTRACT_EXCEPTIONS` (its delete is conditional on activities — per-entity test covers it).

### Steps
- [ ] **RED:** (Tests are already red from Task 2/3.) Update them now: in `backend/tests/generic_contract.py` `CONTRACT_CONFIG`, set `delete_semantics="hard"` for Master/Location/Service/Material/Client (was `"soft"`). The existing `TestGenericServiceDeleteSemantics` then asserts `orm is None` for these — which is the now-correct behavior.
- [ ] **GREEN:** Run the contract suite → green for the 5. For `ServiceService` (in exceptions): add a per-entity delete test in `test_api_services.py` asserting DELETE → 409 when activities exist, 204 when none (Task 9's route handles it; this test just locks the contract). Add `TestArchiveServiceArchiveRestore` parameterized over the 5 entities asserting the archive/restore round-trip.
- [ ] Run `pytest backend/tests/generic_contract.py backend/tests/services/test_generic_service_contract.py` → green.
- [ ] Commit: `test(contract): flip 5-entity delete=hard, add archive/restore contract (#207)`

---

## Task 13: Invert test_put_is_active.py + test_patch_is_active.py to 422 + add archive/restore endpoint tests
### Classification: standard

### Required Docs
- Spec §3.2, §10, §14
- `backend/tests/test_put_is_active.py` (12-115, 4 entity classes), `backend/tests/test_patch_is_active.py` (1 class, 4 entity methods + a restore assertion at `:89`)

### Task Description
These currently assert PUT/PATCH with `is_active` round-trips for Master/Location/Material/Service. After Task 5, that body is rejected. Invert: each test now asserts 422 when `is_active` is in the PUT/PATCH body. Move the archive/restore round-trip assertions to dedicated `test_api_{entity}_archive.py` (or fold into `test_api_{entity}.py`) using the POST endpoints from Task 11. Add Client tests too (#201 + #198).

### Steps
- [ ] Rewrite `test_put_is_active.py` → each `test_put_X_with_is_active_false` becomes `test_put_X_rejects_is_active` asserting 422. Similarly `test_patch_is_active.py`. Keep Client coverage — add `test_put_client_rejects_is_active`, `test_patch_client_rejects_is_active` (Client PATCH type-restricts the field per Task 5).
- [ ] Add `backend/tests/test_api_{entity}_archive.py` (or fold into existing `test_api_{entity}.py`): archive → 200 `archived: true`; restore → 200 `archived: false`; for all 5 (incl. Client, closing #198). Assert behavior matches §2/§3.
- [ ] Run `pytest backend/tests/test_put_is_active.py backend/tests/test_patch_is_active.py backend/tests/test_api_*` → green.
- [ ] Commit: `test(api): invert put/patch is_active → 422, add archive/restore endpoint tests (#207)`

---

## Task 14: New backend dependency-resolution + 409 + atomicity tests
### Classification: standard

### Required Docs
- Spec §5, §6, §8 (atomicity), §12 (scenarios S1-S4, S7)
- `backend/tests/test_api_{masters,locations,services,materials,clients}.py`

### Task Description
Lock the new behavior with backend tests mirroring the spec scenarios at the API level (the E2E in **Task 21** mirrors them at the browser level). **S4 (Client full cascade) + the mid-cascade atomicity fault-injection test are already covered as Task 10's RED-GREEN** — Task 14 should not duplicate them; reference Task 10 for S4/atomicity and focus Task 14 on S1/S2/S3/S7 (the other entities):
- S1: Material DELETE (no body) → 204 (zero deps); GET → 404.
- S2: Master + user + tags (no activities) → DELETE (no body) 409 (users cascade **auto** (§4.1), master_tags cascade auto — `resolutions` body is `{}`); DELETE with body `{}` → 204; assert **user row hard-deleted** (DB query users WHERE master_id → 0), tags gone, master gone. (Change 2 — no more nullify choice on users.)
- S3: Master + 3 activities → DELETE (no body) 409 (activities block); DELETE with body `{}` → 422 (blocked); POST /archive → 200 + `users.is_active=False` (cascade §4.2); POST /restore → 200 + `users.is_active=True`.
- S4: (covered by Task 10 — Client full cascade + atomicity) — reference, do not duplicate.
- S5: per 5 entities archive → 200 `archived: true`; restore → 200 `archived: false`; **Master only asserts `users.is_active` flipped both ways** (cascade §4.2); the other 4 entities assert NO user-table change. (Change 3.)
- S7: 422 paths on DELETE-with-body — wrong action `{"records":"cascade"}`, missing `visitors`, blocked activities (use Master+activities with body `{}`).

### Steps
- [ ] Write each test (RED-GREEN). The GREEN is the routes/services from Tasks 9/10/11 — these tests lock them. If any green fails, return DONE_WITH_CONCERNS noting the gap (the implementation task owns the fix).
- [ ] **Atomicity test** is owned by Task 10 (mock `_delete_cascade` raise on 2nd visitor → assert rollback). Reference it; do not duplicate.
- [ ] Run `pytest backend/tests/` full suite → expected green (the 5-entity hard-delete flip + archive/restore + 409 + DELETE-with-body + Master→user cascades all covered).
- [ ] Commit: `test(api): scenarios S1-S3+S5+S7 + Master→user cascade (delete §4.1 + archive §4.2) (#207)`

---

## Task 15: Frontend api-client Zod schemas — is_active → archived (inverted) on 5 entities
### Classification: standard

### Required Docs
- Spec §3.5 (api-client), §14
- `packages/api-client/src/schemas.ts` (Master `:13`, Location `:51`, Service `:135`, Material `:444`, Client `:262`, ClientWithStats `:295-300`)
- `packages/api-client/src/schemas.test.ts` (assertions at Master `:62`, Client `:434`, etc.)

### Task Description
In `schemas.ts`, for each of the 5 `XResponseSchema`: replace `is_active: z.boolean()` with `archived: z.boolean()` (inverted — the frontend receives `archived = true` when in archive). For `ClientWithStatsSchema` (`:295`, extends `ClientResponseSchema`) → inherits `archived` automatically once `ClientResponseSchema` is updated. Remove `is_active` from `XUpdateSchema` (`MasterUpdateSchema` `:33`, `Location` `:435`, `Service` `:414`, `Material` `:458`, `ClientUpdateSchema` `:283-289` — remove the `is_active: z.boolean()` and the required-`is_active` lines). Update the inferred types. Update `schemas.test.ts` to assert `archived` instead of `is_active` and that Update rejects `is_active` (parse failure).

### Steps
- [ ] **RED:** Update `schemas.test.ts`: for each of 5 entities, replace `expect(result.is_active).toBe(...)` with `expect(result.archived).toBe(not-is_active)`. For Update schemas, assert `XUpdateSchema.parse({...valid, is_active: true})` THROWS (or omits — depends on strict config). Run → fail.
- [ ] **GREEN:** In `schemas.ts`:
  - `MasterResponseSchema` (`:13`): `is_active: z.boolean()` → `archived: z.boolean()`. Same for Location `:51`, Service `:135`, Material `:444`, Client `:262`.
  - `MasterUpdateSchema` (`:33`): `MasterCreateSchema.extend({ is_active: z.boolean() })` → `MasterCreateSchema.extend({})` (or just `MasterCreateSchema` if `.extend({})` is awkward) — remove `is_active`. Same for the other 4.
  - `ClientUpdateSchema` (`:283-289`): remove the `is_active: z.boolean()` required field.
  - To make stray `is_active` rejected by parse (matching backend 422): add `.strict()` to the Update schemas OR rely on the default strict mode — verify the schemas.ts convention; if Update schemas already use strict mode that rejects unknown keys, nothing else; else add a `superRefine` that rejects `is_active` in input. Match backend Task 5's choice.
- [ ] Update inferred types `MasterUpdate` etc. (`:34`, etc.) — drop `is_active`.
- [ ] **Inversion parity test (spec §16 — required):** Add `frontend/admin/__tests__/archived-inversion-parity.test.ts` (or fold into `schemas.test.ts`): load a backend-response fixture (one per entity, the JSON shape the API emits) and assert (a) the Zod schema parses it, (b) `archived` is present and `is_active` is absent, (c) the inversion polarity matches the backend — i.e. an archived row (`is_active=false` in DB) serializes to `archived: true` and the frontend parses `archived: true`. Run against a representative active + archived fixture pair. This locks the Zod↔Pydantic inversion contract per spec §16 ("`archived = true` means IN archive" — both sides must agree exactly, no polarity flip). The fixture can be a literal tapped from a live GET response during Task 14's backend tests (paste into the test file as a JSON literal).
- [ ] Run `pnpm --filter @memo/api-client test` → green.
- [ ] Commit: `feat(api-client): Zod schemas is_active→archived + remove from Update + parity test (#207)`

---

## Task 16: Frontend api-client endpoints — add archive/restore/resolveDelete, keep delete
### Classification: standard

### Required Docs
- Spec §3.5, §6, §14
- `packages/api-client/src/endpoints.ts` (`deleteX` already exist; `patchX` pass `Partial<XUpdate>` at ~:127, :318, :533, :564, :606)
- `packages/api-client/src/endpoints.test.ts`

### Task Description
Add to `endpoints.ts`:
1. `archiveX(id: string): Promise<XResponse>` — POST `/api/v1/Xs/{id}/archive` with `z.any()` or `XResponseSchema` parse.
2. `restoreX(id: string): Promise<XResponse>` — POST `/api/v1/Xs/{id}/restore`.
3. `resolveDeleteX(id: string, resolutions: Record<string,string>): Promise<void>` — **`DELETE` with body** (Change 1): `api(`/api/v1/Xs/${id}`, z.any(), { method: 'DELETE', body: { resolutions } })` → 204 (no body). The existing `deleteX(id)` (no body) is the dry-run; `resolveDeleteX(id, resolutions)` (with body) is the execute.
4. Keep existing `deleteX(id)` (the no-body dry-run / instant-204 path).
5. `patchX` no longer needs `is_active` (removed from `Partial<XUpdate>`). The mutation hooks (**Task 17**) will switch archive toggles from `patchX` to `archiveX`/`restoreX`.

### Steps
- [ ] **RED:** In `endpoints.test.ts` add tests for `archiveMaster`/`restoreMaster` (POST routes asserted) + `resolveDeleteClient(id, {records:'nullify', visitors:'cascade'})` (**DELETE-with-body** asserted — `method: 'DELETE'` + body, NOT POST) + delete tests for `deleteMaster`/`deleteMaterial`/`deleteClient` (currently absent per codebase explore — add them).
- [ ] **GREEN:** In `endpoints.ts` add the 3 new methods per entity (15 total: 5 archive + 5 restore + 5 resolveDelete). Use the existing `api()` helper pattern:
  ```ts
  export async function archiveMaster(id: string): Promise<MasterResponse> {
    return api(`/api/v1/masters/${id}/archive`, MasterResponseSchema, { method: 'POST' });
  }
  export async function restoreMaster(id: string): Promise<MasterResponse> {
    return api(`/api/v1/masters/${id}/restore`, MasterResponseSchema, { method: 'POST' });
  }
  export async function resolveDeleteMaster(id: string, resolutions: Record<string, string>): Promise<void> {
    await api(`/api/v1/masters/${id}`, z.any(), { method: 'DELETE', body: { resolutions } });
  }
  ```
- [ ] Remove the stale `patchMaster` (etc.) tests asserting `is_active` is passed in the patch payload (update them to assert archive/restore endpoints are used instead — **Task 17** owns the hook side).
- [ ] Run `pnpm --filter @memo/api-client test` → green.
- [ ] Commit: `feat(api-client): add archive/restore/resolveDelete endpoint methods (#207)`

---

## Task 17: Frontend mutation hooks + ClientsContext — delete→409-aware, archive/restore mutations
### Classification: standard

### Required Docs
- Spec §3.5, §7 (dialog fetch flow), §14
- `frontend/admin/hooks/use{Masters,Locations,Services,Materials}Mutations.ts` (delete `:32-38`, patch `:23-30`; invalidate `['X']` `:11,19,28,36`)
- `frontend/admin/contexts/ClientsContext.tsx` (delete `:126-129`, patch `:120-124`, invalidate `:105-108`)

### Task Description
- **Mutation hooks (4 entities):** keep `useDeleteX` but rename/repurpose: it calls `deleteX(id)` and on `onError` if status 409, exposes the dependency tree (parsed from `error.response.detail.dependencies`) to the UI for the dialog (Task 19). Add `useArchiveX` (`archiveX(id)`) and `useRestoreX` (`restoreX(id)`). Remove the `patchX({is_active})` flow from the table — tables switch to `useArchiveX`/`useRestoreX` in Task 19. Invalidation: archive/restore/delete all invalidate `['X']`. **Cross-invalidation (sensible cache hygiene, beyond the literal spec §7/§14 but required to keep records-derived views consistent after a hard-deleted master/location/service):** hard delete of Master/Location/Service also invalidates `['records']`-consumer queries — the `useRecordData.ts` keys on `['services']`/`['masters']`/`['locations']` (built-in queries, NOT auto-invalidated by the entity mutations today); add `queryClient.invalidateQueries({queryKey:['masters']})` analogues for the cross-keys in the delete hook `onSuccess`. For Client, `invalidateClients` already covers `['records']`.
- **ClientsContext:** add `archiveClient`/`restoreClient` (parity #198), keep `deleteClient` but route through the new resolver (same 409-aware pattern). The context's `apiDeleteClient` call is the no-body DELETE dry-run; on 409 → expose deps → on confirm call `resolveDeleteClient(id, resolutions)` (DELETE with body). (Master archive/restore also cascades to the linked user — that's backend-side in Task 11; the admin hook just calls `archiveMaster`/`restoreMaster` and invalidates `['masters']` + the cross-keys. The user-side is_active flip is transparent to the frontend.)

### Steps
- [ ] **RED:** Update `useMastersMutations.test.ts` etc. — assert `useArchiveMaster` calls `archiveMaster`, `useRestoreMaster` calls `restoreMaster`. Remove the `expect(mockPatchMaster).toHaveBeenCalledWith(id, { is_active: false })` assertions (replace with archive/restore assertions). Run → fail.
- [ ] **GREEN:** In `useMastersMutations.ts` add `useArchiveMaster`, `useRestoreMaster`; keep `useDeleteMaster`. Same for the other 3 hook files. In `ClientsContext.tsx` add `archiveClient`, `restoreClient`; keep `deleteClient`. Invalidation: each `onSuccess` invalidates `['X']` (and Client's `invalidateClients` already covers `['records']`).
- [ ] Run `pnpm --filter memo-admin test -- use*Mutations` → green.
- [ ] Commit: `feat(admin): hooks/ClientsContext — archive/restore mutations, 409-aware delete (#207)`

---

## Task 18: Shared DeleteDialog component (Mode A type-to-confirm + Mode B blocked→archive)
### Classification: standard

### Required Docs
- Spec §7 (deletion dialog — two modes, fetch flow), §13 (visual checks), §14
- Skill `colourmountains-design` (mobile-first overlay patterns)
- Skill `vitest-playwright-patterns` (component testing)
- `frontend/admin/app/components/` (new `DeleteDialog.tsx`; no existing confirm/typ-to-confirm component exists per codebase explore — each entity's delete currently uses `window.confirm`)

### Task Description
Create a shared `DeleteDialog` component handling both modes per spec §7:
1. **Trigger flow:** parent calls `DELETE /{id}` (no body — dry-run) first; if 204 → onDone (delete already succeeded, no deps); if 409 → parse `dependencies`; if any `allowed_actions == []` → render **Mode B** ("Нельзя удалить: есть N активностей." + "[Архивировать]" + "[Отмена]"); otherwise render **Mode A** (list deps with → cascade / ○ nullify, auto-deps shown but not asked — incl. **Master→users** "→ Пользователь: 1 (удалён)" per §4.1 Change 2, no choice, type-to-confirm input enabled when the entity name matches; on confirm → `resolveDeleteX(id, resolutions)` which sends `DELETE /{id}` **with body** — only non-auto resolutions, auto deps like Master→users/tags omitted; success → onDone).
2. Mode A: "[Введите название для подтверждения] [Удалить] [Отмена]". "Удалить" disabled until name matches; destructive button styling.
3. Mode B: primary "[Архивировать]" calls `archiveX(id)` then onDone; delete not offered.
4. Mobile-first per colourmountains-design — overlay/modal pattern consistent with the rest of the admin.

### Steps
- [ ] **RED:** Component test `frontend/admin/__tests__/DeleteDialog.test.tsx` — render Mode A with a deps fixture (Master: users cascade **auto** per §4.1, master_tags cascade auto — both shown as "→ ... (удалён)" with no choice, `resolutions` body is `{}`), assert the list renders, type-to-confirm disables/enables "Удалить", clicking it calls `resolveDeleteX` with `{}` (all auto). Render a Client Mode A fixture (records nullify non-auto, visitors cascade non-auto, client_tags cascade auto) → confirm calls `resolveDeleteX` with `{records:'nullify', visitors:'cascade'}` (tags omitted). Render Mode B with activities-blocked deps (Master+activities), assert "[Архивировать]" present and "Удалить" absent, click → calls `archiveX`. Run → fail.
- [ ] **GREEN:** Implement `frontend/admin/app/components/DeleteDialog.tsx` per §7. Props: `entityName: string`, `entityType: 'master'|'location'|'service'|'material'|'client'`, `entityId: string`, `dependencies: DependencyNode[]` (already-fetched from the DELETE 409), `onDone: () => void`, `onCancel: () => void`. The parent owns the initial DELETE call (Task 19/20).
- [ ] Run the component test → green.
- [ ] Commit: `feat(admin): shared DeleteDialog — Mode A type-confirm + Mode B blocked→archive (#207)`

---

## Task 19: Wire DeleteDialog + archive/restore into the 5 table components + ClientsTable
### Classification: standard

> **Sequencing note:** Execute **Task 20 (vitest mocks is_active→archived)** FIRST, then this task. The table-component tests in Task 19 consume mock fixtures (`mockMasterResponse` etc.); once Task 15 drops `is_active` from the api-client Zod schemas, those fixtures must carry `archived` (Task 20) for the table tests to type-check and the archive-label assertions to pass. Reversing the order leaves Task 19's RED `pnpm --filter memo-admin test -- XTable` red on missing `archived` until Task 20 lands.

### Required Docs
- Spec §7, §14
- `frontend/admin/app/(main)/{masters,locations,services,materials,clients}/components/XTable.tsx` (delete handler e.g. MastersTable `:217-226`, archive toggle `:181-192`, buttons `:393-412`)
- `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx` (`:41-51`), `ClientsTable.tsx` (`:154-172`)

### Task Description
For each of the 5 entities:
1. Replace the `window.confirm('Удалить X?')` delete handler with: call `useDeleteX.mutateAsync(id)`; on 409 → open the `DeleteDialog` with the parsed `dependencies`; on 204 → invalidate + close (instant delete, e.g. Material).
2. Replace the `patchX({is_active: !row.is_active})` archive toggle with: call `useArchiveX(id)` / `useRestoreX(id)` based on `row.archived` (the response carries `archived`). The button label switches "В архив" / "Восстановить" based on `row.archived` (was `is_active`). For the edit PUT ensure the stale `is_active: editX.is_active` propagation (MastersTable `:165`, LocationsTable `:168`, ServicesTable `:310`, MaterialsTable `:223`) is removed — the Update schema no longer carries `is_active` (PUT just sends the editable fields).
3. Client table (`ClientsTable.tsx`): add the "В архив"/"Восстановить" buttons (the missing #198 restore parity) + switch the trash-icon delete to the DeleteDialog flow.
4. Cross-invalidation: hard delete of Master/Location/Service invalidates `['records']`-consumer queries (`useRecordData.ts` keys on `['services']`/`['masters']`/`['locations']`) — add the cross-invalidate in the hook onSuccess (or in the table handler).

### Steps
- [ ] **RED:** Update `MastersTable.test.tsx`, `LocationsTable.test.tsx`, `ServicesTable.test.tsx`, `MaterialsTable.test.tsx`, `ClientsTable.test.tsx` — replace `window.confirm` assertions with DeleteDialog open assertions; replace `patchX({is_active})` assertions with `archiveX`/`restoreX` assertions; add a Mode B test (activities present → "Архивировать"). Run → fail.
- [ ] **GREEN:** Wire the hooks + dialog in each table per the description. Replace `row.is_active` references with `row.archived` (inverted — `archived ? 'Восстановить' : 'В архив'`). Remove `is_active` from the edit-modal PUT payload construction.
- [ ] Run `pnpm --filter memo-admin test -- XTable` → green.
- [ ] Commit: `feat(admin): wire DeleteDialog + archive/restore into 5 tables (Client #198 parity) (#207)`

---

## Task 20: Vitest mocks — is_active → archived across admin test fixtures
### Classification: standard

> **Sequencing note:** Execute this task BEFORE Task 19 (table wiring) — Task 19's table-component tests require the `archived`-carrying fixtures this task produces. See Task 19's sequencing note.

### Required Docs
- Spec §3.5 (inversion), §14
- `frontend/admin/__tests__/helpers/mockData.ts` (`mockClient:98`, `mockLocationResponse:173`, `mockLocationResponseArchived:190`, `mockMasterResponse:215`, `mockMasterResponseArchived:229`, `createMockLocationResponse`, `createMockMasterResponse`)
- `frontend/admin/__tests__/helpers/clientRecordTabSetup.ts` (`mockServiceResponse:84`, `mockMasters:89-95`, `mockLocations:89-95`)
- Per-entity table-test fixtures (MastersTable.test `:91/:492`, LocationsTable `:91/:378`, ServicesTable `:7-64/:127`, MaterialsTable `:7/:16`, ClientsTable/ClientsPage/ClientsIntegration)

### Task Description
Replace every `is_active: boolean` with `archived: boolean` (inverted: `archived = not is_active`) in all admin test mock data. The fixture pairs (active + archived) invert: `mockMasterResponse.is_active = true` → `mockMasterResponse.archived = false`; `mockMasterResponseArchived.is_active = false` → `mockMasterResponseArchived.archived = true`. Update any test assertion that reads `is_active` to read `archived` (the GH #195 archive-active-filter tests at MastersTable `:534-553`, LocationsTable `:583-601`, ServicesTable `:368-396`, MaterialsTable `:179-199` use these fixtures — update assertions).

### Steps
- [ ] **RED:** Run `pnpm --filter memo-admin test` → many fixtures and tests fail at **runtime** (esbuild does NOT type-check, so failures are undefined-`archived` reads / missing-`is_active` assertions, not compile errors). That's the signal — the fixtures must carry `archived` to match the api-client Zod schemas from Task 15.
- [ ] **GREEN:** Update `mockData.ts` + `clientRecordTabSetup.ts` + per-entity fixtures: replace `is_active` with `archived` (inverted). Update table tests' archive-filter assertions.
- [ ] Run `pnpm --filter memo-admin test` → green.
- [ ] Commit: `test(admin): is_active→archived in all vitest mocks (#207)`

---

## Task 21: E2E specs S1-S7 (Playwright Full Cycle)
### Classification: large

### Required Docs
- Spec §12 (scenarios S1-S7), §14
- Skill `vitest-playwright-patterns` (Full Cycle pattern + fixtures + DB verification)
- `frontend/admin/e2e/fixtures/factories.ts` (API seed factories), `helpers.ts` (`waitForXReady`, `cleanTestData`), `db-query.ts` (raw SQL verification), `globalSetup.ts`

### Task Description
Add 7 E2E specs per the spec's §12 scenarios, each following the Full Cycle pattern (seed via API factories → navigate → act → assert UI + DB via raw SQL → cleanup):
- `e2e/materials-delete.spec.ts` (S1) — create material, delete, assert row absent + API 404.
- `e2e/masters-delete-auto-cascade.spec.ts` (S2 — Change 2) — seed master+user+tags (no activities), open delete dialog, preview shows "→ Пользователь: 1 (удалён)" + "→ Теги: N (удалены)" (auto-cascade both, NO choice), type-confirm, `DELETE /masters/{id}` with body `{}` → assert 204 + **user row gone** (DB query, §4.1) + master gone + tags gone.
- `e2e/masters-delete-blocked.spec.ts` (S3) — seed master+3 activities, open delete → Mode B "Нельзя удалить: есть 3 активности.", click "Архивировать" → `archived: true`, click "Восстановить" → `archived: false`.
- `e2e/clients-delete-cascade.spec.ts` (S4) — seed client+records+visitors+visits+payments+tags, assert DELETE (no body) 409 + cascade_preview `{"visits": 45}`, type-confirm, `DELETE /clients/{id}` **with body** `{resolutions:{records:'nullify', visitors:'cascade'}}` → assert 204 + records.client_id NULL + **payments still present** (record-scoped) + visitors/visits/client_tags gone + client gone.
- `e2e/archive-restore-parity.spec.ts` (S5) — per 5 entities: archive → absent from active, present in archived; restore → back. Covers Client (#198 parity).
- `e2e/update-rejects-is-active.spec.ts` (S6) — per 5 entities: PUT with is_active → 422 (assert error UI).
- `e2e/clients-delete-invalid-resolution.spec.ts` (S7) — wrong action 422, missing dep 422, correct 204.

### Steps
- [ ] Write each spec via the Full Cycle pattern: factory seed → helper navigation → dialog interaction → DB verification via `queryDB`/`queryDBRow`. Use the `page.on('dialog')` → accept pattern ONLY for legacy `window.confirm` paths (none here — all new flows use the DeleteDialog component).
- [ ] Add the 7 specs to the e2e shard config (per the existing shard setup — check `playwright.config.ts` for shard assignments).
- [ ] Run `pnpm --filter memo-admin e2e` (or the sharded variant) → green. Update visual-regression baselines if any new snapshot is needed (per spec §13 the 5 entity tables should render cleanly — snapshot if the project convention requires).
- [ ] Commit: `test(e2e): scenarios S1-S7 — delete/nullify/cascade/block/archive/restore (#207)`

---

## Task 22: Backend schema/api is_active sweep (final, before merge)
### Classification: small

### Required Docs
- Spec §3.2, §14
- `backend/src/api/v1/{masters,locations,services,materials,clients}.py` (response builders — verify no `is_active` in any serializer path for the 5)

### Task Description
Final sweep for any residual `is_active` **serialized in the API response** for the 5 entities. After Tasks 4/5/13/14, no API response path should serialize `is_active` on the 5 entities, and no PUT/PATCH should accept it. **Important caveat (Task 4 design):** the Response schemas legitimately keep an `is_active: bool = Field(..., exclude=True)` field on the Pydantic model — it is parsed from the ORM but `exclude=True` prevents serialization, and `@computed_field archived` reads it. So a grep for `is_active` in `backend/src/schemas/{master,location,service,material,client}.py` will find these legitimate `exclude=True` declarations — those are correct and must NOT be "fixed". The sweep targets: (a) any response mapper that explicitly passes `is_active` into a serialized path; (b) any Update/Patch schema that still accepts `is_active`; (c) the `ClientWithStats` manual builder (`client.py:210`) — verify it does not surface `is_active` to the JSON output (the computed `archived` derives from it). Confirm `_map_*` functions (where they exist) and the `ClientWithStats` builder do not emit `is_active`.

### Steps
- [ ] Grep `backend/src/api/v1/{masters,locations,services,materials,clients}.py` and `backend/src/schemas/{...}.py` for `is_active` → **allowed**: the schema `exclude=True is_active` field + the DB/Model/Repo layer (those use `is_active` per the terminology boundary). **Flag & fix**: any serializer path that surfaces `is_active` to JSON, any Update/Patch schema that still accepts it, any mapper with `is_active=...` in a non-excluded context. The `ClientWithStats` builder keeps `is_active=row.is_active` (Task 4 — feeds the excluded field that `archived` derives from); confirm with a response test that the JSON lacks `is_active` and has `archived`.
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `chore(api): final is_active sweep — no leakage in 5-entity responses (#207)`

---

## Task 23: Domain rules documentation + scratchpad delta
### Classification: small

### Required Docs
- Spec §1, §3, §4, §14, `docs/domain-rules/_overview.md` + per-entity files

### Task Description
Update `docs/domain-rules/`:
1. `_overview.md`:
   - **Deletion Policy table (`:65-72`):** the 5 soft-delete entities now hard-delete-with-resolutions + archive endpoints. Update the row "Soft-delete (`is_active` flag) | Master, Location, Service, Material, Client" → "Hard-delete with resolutions + archive endpoints (`POST /archive`, `POST /restore`) | Master, Location, Service, Material, Client".
   - **is_active-semantics section (`:74-83`):** rewrite the `update`/`patch` rules — `is_active` no longer accepted on PUT/PATCH; archive/restore via dedicated endpoints; the `archived` inversion at the API boundary (Service layer translates).
   - Add a new subsection documenting the FK dependency matrix for the 5 entities + the 409/422 contract + the `activities = always block` rule.
2. Per-entity files for the 5 (`masters.md`, `locations.md`, `services.md`, `materials.md`, `clients.md`): document the new hard-delete-with-dependency-resolutions behavior + the archive/restore endpoints + the `archived` response field (inverted).

### Steps
- [ ] Update `_overview.md` per the description.
- [ ] Update the 5 per-entity files with the new endpoints + the `archived` field + the dependency matrix row(s) relevant to each.
- [ ] Commit: `docs: update domain rules — hard-delete + archive terminology + FK matrix (#207)`

---

## Self-Review

- **Spec coverage:** every §14 AC maps to a task — FK ON (T1); rename (T2/T3); schema inversion incl. ClientWithStats (T4); PUT/PATCH rejects is_active + #178 (T5); dead-code (T6); VisitorService extracted core + atomicity (T7); FK matrix + 409 builder incl. Master→users auto-cascade (T8); DELETE unified route dry-run+execute (T9); resolve_delete transaction executor (T10); archive/restore routes + Master→user cascade (T11); contract tests (T12); put/patch inversion + archive endpoint tests (T13); scenarios S1-S3+S5+S7 + Master→user cascade tests (T14); api-client Zod + parity test (T15/T16); hooks (T17); DeleteDialog (T18); table wiring (T19); vitest mocks (T20); E2E S1-S7 (T21); sweep (T22); domain docs (T23). All §12 scenarios have a backend test (T14) + an E2E (T21). **Change 1 (unified DELETE)** in T9/T16; **Change 2 (Master→users delete cascade)** in T8/T10/T14/T21; **Change 3 (Master archive/restore user cascade)** in T11/T14/T21.
- **Placeholder scan:** no TBD/TODO/"implement later"; every step has a concrete file path or action.
- **Type consistency:** `ArchiveService`/`ArchiveRepository` named consistently; `archived: bool` inverted consistently; `resolve_delete`/`_delete_cascade` named consistently.
- **Required Docs:** every task carries a `### Required Docs` section.
- **Note:** Tasks 2-3 cause downstream test redness until Task 12/13 (contract inversion). This is expected — the implementer must NOT fix the red contract/put/patch tests during T2/T3; T12/T13 owns them. Document this constraint when dispatching T2/T3.