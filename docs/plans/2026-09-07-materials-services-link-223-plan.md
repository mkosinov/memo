# Materials ↔ Services Link (#223) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link materials to services (M2M with a per-link note), filter services by material, show a usage counter on materials, and retire `material_hint` everywhere — client screens derive materials from links (`note ?? description` fallback).

**Architecture:** A mapped `ServiceMaterial` association object (spec §3.1 — a payload column on a bare `secondary` join is unreachable) carries `note`; `ServiceResponse.materials` is built from association rows; the write path mirrors the tags hard-replace idiom with explicit id pre-validation (422); the read path gains `?material_id=` and `used_in_services_count`; `material_hint` is removed in the final task together with the single Alembic revision (create table + drop column). Everything before Task 13 is additive — build stays green task-by-task.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, Alembic (hand-written), Pydantic v2; `packages/api-client` (Zod), `packages/domain`; Next.js 14 admin (TanStack Query, DataTable), Next.js web client; Vitest + Playwright.

**Spec (binding):** `docs/specs/2026-09-07-materials-services-link-design.md` — §3 data model/migration, §4 write contract, §5 read/filter, §6 counter, §7 deletion & archive, §8 admin UI, §9 web client, §10 removal checklist, §11 testing, `## User Scenarios` S1-S6.

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/materials-services-link-223`.

**Test commands** — backend (from `backend/`): `python -m pytest tests/test_api_services.py -x -q`, full `python -m pytest -q`; admin (from `frontend/admin/`): `npx vitest run <paths>`, `npx tsc --noEmit`, `npm run lint`, e2e `npm run test:e2e -- <spec>`; web (from `frontend/web/`): `npm test`, `npx playwright test`; api-client (from `packages/api-client/`): `npm test`.

---

## Behavioral Delta

How this behaves for the user, mapped to spec acceptance criteria:

- **Материалы привязываются к услуге (S1)** — в карточке услуги вместо свободного текста «что взять с собой» появляется выбор материалов из справочника (несколько можно), у каждого — необязательная уточняющая заметка; выбранные материалы видны в строке таблицы услуг компактными бейджами.
- **Услуги фильтруются по материалу (S2)** — на странице услуг появляется выбор материала; при выборе «акварель» таблицка показывает только услуги акварели, счётчик найденного совпадает.
- **Набор материалов редактируется безопасно (S3)** — сняв один материал и сохранив, вы не трогаете остальные; сохранение формы «не трогая материалы» не меняет связи.
- **Видно, где используется материал (S4)** — в таблице материалов появляется колонка «Где используется» с числом активных услуг; привязал/отвязал — число обновилось.
- **Удаление привязанного материала — с подтверждением (S5)** — при удалении материала, used by услугами, появляется диалог зависимостей с числом услуг; подтверждение удаляет материал и снимает связи, услуги остаются живы.
- **Клиентский экран строится из связей (S6)** — на карточке занятия в веб-клиенте подпись материала = название первого привязанного материала, детали = строка «заметка, иначе описание» по каждому; в форме записи поле «Материал» остаётся редактируемым, но подставляется первый материал; без привязок — блока нет.
- **Старое поле исчезает без следа** — текстовая «подсказка о материалах» уходит из формы, таблицы, API и базы; сортировка по старому ключу перестаёт существовать (для пользователя неотличимо — UI в том же релизе её больше не шлёт).

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `backend/src/models/service_material.py` | CREATE | `ServiceMaterial` association (composite PK, `note`, FKs ON DELETE CASCADE) |
| `backend/src/models/service.py` | MODIFY | `service_materials` relationship + `materials` payload property |
| `backend/src/models/__init__.py` | MODIFY | export ServiceMaterial |
| `backend/src/schemas/service.py` | MODIFY | `ServiceMaterialLinkIn`, `ServiceMaterialItem`, `materials` on Create/Update/Patch/Response |
| `backend/src/services/service.py` | MODIFY | link replace/preserve in create/update/patch; id pre-validation; eager loads |
| `backend/src/api/v1/services.py` | MODIFY | `material_id` query param; sort whitelist change (Task 13) |
| `backend/src/schemas/material.py` | MODIFY | `used_in_services_count` (default 0) |
| `backend/src/services/material.py` | MODIFY | aggregate helper on list/all/get/mutations |
| `backend/src/domain/deletion.py` | MODIFY | `service_materials` rows for Service + Material (+ counters + cascade handler) |
| `backend/alembic/versions/<rev>_service_materials_drop_material_hint.py` | CREATE (Task 13) | the single revision: create table + drop column |
| `backend/src/seed/seed.py` | MODIFY (Task 13) | stop seeding `material_hint`; seed links |
| `packages/api-client/src/schemas.ts` | MODIFY | `materials` in Service schemas (T2); remove `material_hint` (T13) |
| `packages/api-client/src/endpoints.ts` | MODIFY | `ListParams.material_id` (T2) |
| `packages/api-client/src/__fixtures__/backend-responses.json` | MODIFY | fixtures (T2 add, T13 clean) |
| `packages/domain/src/schedule.ts` | MODIFY (T12) | `ScheduleDTO.materialHint` → materials-derived fields |
| `frontend/admin/app/(main)/services/components/serviceColumns.tsx` | MODIFY | badges column (T3); drop hint column (T13) |
| `frontend/admin/app/(main)/services/components/serviceFields.tsx` + `ServiceModal.tsx` | MODIFY | materials multi-select with notes (T5); hint field out (T5) |
| `frontend/admin/app/(main)/services/page.tsx` + `ServicesContext` | MODIFY (T7) | filter control + `?material_id=` |
| `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` + `materialsColumns.tsx` | MODIFY (T9) | usage column |
| `frontend/admin/app/(main)/services/components/ServicesTable.tsx` | MODIFY (T13) | hint row transform out |
| `frontend/admin/lib/buildSchedule.ts` | MODIFY (T13) | hint consumer out |
| `frontend/web/app/lib/mappers/buildSchedule.ts`, `lib/model/dto/schedule.ts` | MODIFY (T12) | derive `material`/`materialHint` from links |
| `frontend/web/app/page.tsx`, `app/ui/ActivityDetail.tsx`, `app/ui/BookingPrivateOverlay.tsx` | MODIFY (T12) | consume derived fields (booking prefill) |
| `docs/domain-rules/services.md`, `docs/domain-rules/materials.md` | MODIFY (T13) | "(in design)" markers → landed |
| `frontend/admin/e2e/services-materials.spec.ts` | CREATE (T5) | S1/S3 e2e |
| `frontend/admin/e2e/materials-delete.spec.ts` | MODIFY (T11) | S5 e2e |
| e2e S2/S4 | EXTEND (T7/T9) | filter + counter e2e |
| `frontend/web/tests/visual.spec.ts` + admin visual snapshots | MODIFY | snapshot updates (T3, T12, T13) |

**Commits:** per-task, prefix `feat(#223):` / `test(#223):` / `chore(#223):`. Single PR at the end.

**Ordering invariants (keep the build green):**
- Tasks 1-12 are **additive**: `material_hint` keeps flowing; old UI keeps working.
- Task 4 (backend write) and Task 5 (admin form) are adjacent — between them, an admin service PUT would send no `materials` (default `[]` = clear links). Don't run admin flows/e2e between Tasks 4 and 5.
- The single Alembic revision (create table + drop column, spec §3.2) lands in Task 13. Until then tests run on `create_all`-built schemas; **do not run `alembic upgrade head` on a dev DB before Task 13** (the model and migrations realign there).

---

## Task 1: `ServiceMaterial` association + nested materials in read path

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §3.1-§3.3 — association shape, ordering, eager loads
- `docs/domain-rules/_overview.md` — Naming Conventions (new entity + table name)
- `docs/domain-rules/services.md` — Relationships (the link contract)

### Files
- CREATE `backend/src/models/service_material.py`
- MODIFY `backend/src/models/service.py`, `backend/src/models/__init__.py`
- MODIFY `backend/src/schemas/service.py`, `backend/src/services/service.py`
- TEST `backend/tests/test_api_services.py`

### Steps
- [ ] Create `backend/src/models/service_material.py`:
```python
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base  # same declarative base as other models
from .material import Material
from .service import Service


class ServiceMaterial(Base):
    """Association object (spec §3.1): payload column `note` is unreachable via a bare secondary join."""
    __tablename__ = "service_materials"

    service_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    material_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("materials.id", ondelete="CASCADE"), primary_key=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    service: Mapped["Service"] = relationship(back_populates="service_materials")
    material: Mapped["Material"] = relationship()
```
  (Match the actual Base import path used by sibling models, e.g. `models/tag.py`.)
- [ ] `models/service.py`: add `service_materials: Mapped[list["ServiceMaterial"]] = relationship(back_populates="service", cascade="all, delete-orphan")` and a payload property (Pydantic `from_attributes` reads it; Python-side sort = deterministic order, spec §3.3):
```python
@property
def materials(self) -> list[dict]:
    return [
        {"id": sm.material.id, "title": sm.material.title,
         "description": sm.material.description, "note": sm.note}
        for sm in sorted(self.service_materials,
                         key=lambda sm: (sm.material.title, sm.material.id))
    ]
```
- [ ] `models/__init__.py`: export `ServiceMaterial` (import ordering per file conventions).
- [ ] `schemas/service.py`: add `class ServiceMaterialItem(BaseModel): id: str; title: str; description: str; note: str | None` and `materials: list[ServiceMaterialItem] = []` on `ServiceResponse`.
- [ ] `services/service.py`: extend every eager-load site with `selectinload(Service.service_materials).joinedload(ServiceMaterial.material)` — the three list/get options (`:86`, `:101`, `:109`) and `get()` (`:133`).
- [ ] RED: extend `tests/test_api_services.py` — insert two `ServiceMaterial` rows directly via the test session (links unordered, one with `note="..."`), then `GET /api/v1/services/{id}` → assert `materials` ordered by title, note carried; a service without links → `materials: []`. Run `python -m pytest tests/test_api_services.py -x -q` → fails (field missing).
- [ ] GREEN: implement the model/schema changes above → the same tests pass.
- [ ] Run the full backend suite: `python -m pytest -q` → green (nothing else touched).
- [ ] Commit: `feat(#223): ServiceMaterial association + nested materials in service reads`

### DoD
Read endpoints (`GET /{id}`, list, `/all`) return `materials: [{id, title, description, note}]` ordered `title ASC, id ASC`; full backend suite green.

---

## Task 2: api-client — `materials` schemas + `material_id` list param

### Classification: small
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §4-§5 (payload shapes), §10 (api-client row)
- `packages/api-client/src/schemas.ts` — existing Service schema style (Zod, `.strict()` derivatives)

### Files
- MODIFY `packages/api-client/src/schemas.ts`, `packages/api-client/src/endpoints.ts`, `packages/api-client/src/__fixtures__/backend-responses.json`
- TEST `packages/api-client/src/schemas.test.ts`

### Steps
- [ ] `schemas.ts`: add `export const ServiceMaterialLinkSchema = z.object({ material_id: z.string(), note: z.string().nullable().optional() })` and `ServiceMaterialItemSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), note: z.string().nullable() })`.
- [ ] `ServiceResponseSchema`: add `materials: z.array(ServiceMaterialItemSchema).default([])`.
- [ ] `ServiceCreateSchema`: add `materials: z.array(ServiceMaterialLinkSchema).default([])` (`ServiceUpdateSchema = ServiceCreateSchema.strict()` inherits it — verified :433/:442 pattern).
- [ ] `endpoints.ts` `ListParams` (:86-108): add optional `material_id?: string` threaded into the services list query string.
- [ ] Fixtures: add `"materials": [...]` to the two service fixtures (:76, :106).
- [ ] RED→GREEN: extend `schemas.test.ts` — response with materials parses; create schema defaults `materials: []`; unknown key still rejected by strict update schema. `npm test` from `packages/api-client/` → green.
- [ ] Commit: `feat(#223): api-client — materials payload + material_id list param`

### DoD
`npm test` in `packages/api-client/` green; admin can now type services with `materials`.

---

## Task 3: Admin — materials badges column in the services table

### Classification: small
### Required Docs
- `docs/design-system.md` — chip/badge styling conventions
- `docs/domain-rules/services.md` — Relationships (badges show TITLES only; the note/description fallback does NOT apply to badges — spec §8)

### Files
- MODIFY `frontend/admin/app/(main)/services/components/serviceColumns.tsx`
- TEST: unit test next to existing column tests; visual snapshots

### Steps
- [ ] Add a «Материалы» column after the existing `material_hint` column: renders `service.materials` titles as compact chips; `materials.length === 0` → em dash, matching the empty-cell convention of the hint column (`serviceColumns.tsx:63-67` idiom).
- [ ] Unit test: row with two materials renders two chips in title order; empty → dash. `npx vitest run` (admin) → green; `npx tsc --noEmit` → clean.
- [ ] Update affected visual snapshots: `npm run test:e2e:update -- <visual spec>` or per the repo's snapshot flow; verify no unrelated snapshot changed.
- [ ] Commit: `feat(#223): services table — materials badges column`

### DoD
Badges visible on rows with links; snapshots consistent; hint column untouched (removed in Task 13).

---

## Task 4: Backend — writing links: create/PUT/PATCH + 422 validation

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §4 — semantics table, validation rules, note normalization
- `docs/domain-rules/services.md` — Business Logic (tags hard-replace pattern this mirrors)

### Files
- MODIFY `backend/src/schemas/service.py`, `backend/src/services/service.py`
- TEST `backend/tests/test_api_services.py`, `backend/tests/test_schemas_service.py`

### Steps
- [ ] `schemas/service.py`: `class ServiceMaterialLinkIn(BaseModel): material_id: str; note: str | None = None`. `ServiceCreate.materials: list[ServiceMaterialLinkIn] = []`; `ServiceUpdate.materials: list[ServiceMaterialLinkIn] = []`; `ServicePatch.materials: list[ServiceMaterialLinkIn] | None = None` (absent = preserve — same exclude_unset idiom as `tag_ids`, `services/service.py:207-215`).
- [ ] `services/service.py` — a shared helper mirroring the tag replace loop (`:142-178`):
```python
async def _replace_service_materials(self, db_session, service_id: str,
                                     items: list[ServiceMaterialLinkIn]) -> None:
    if not items:
        await db_session.execute(
            delete(ServiceMaterial).where(ServiceMaterial.service_id == service_id))
        return
    ids = [i.material_id for i in items]
    if len(set(ids)) != len(ids):
        raise 422 duplicate  # repo idiom below
    found = (await db_session.execute(
        select(Material.id).where(Material.id.in_(ids)))).scalars().all()
    missing = set(ids) - set(found)
    if missing:
        raise 422 unknown-ids  # repo idiom below
    await db_session.execute(
        delete(ServiceMaterial).where(ServiceMaterial.service_id == service_id))
    for i in items:
        note = (i.note or "").strip() or None  # whitespace-only → NULL (spec §4)
        db_session.add(ServiceMaterial(service_id=service_id,
                                       material_id=i.material_id, note=note))
```
  **Error-raising idiom (plan-review finding, pin the wire format):** the services layer raises `HTTPException(422, detail=ErrorDetail(code=ErrorCode.VALIDATION_ERROR, ...))` — mirror `api/v1/services.py:124-128` exactly; tests assert that detail shape (`VALIDATION_ERROR` code + the offending ids in the message), not a bare string.
- [ ] Wire into `create` (insert links like tags :157-163), `update` (delete + reinsert like :186-196), `patch` (`materials` popped with `tag_ids`; `None` → untouched; sent → replace; `[]` → clear).
- [ ] RED→GREEN tests in `test_api_services.py`: POST with materials → links exist (GET returns them); PUT `[]` clears; PUT replaces set; PATCH without `materials` preserves; PATCH `[]` clears; unknown id → 422 with the id named; duplicate id → 422; note `"  "` → GET returns `note: null`; archived material id is a VALID target (archive it first, link succeeds).
- [ ] `python -m pytest tests/test_api_services.py tests/test_schemas_service.py -q` → green; full suite `python -m pytest -q` → green.
- [ ] Commit: `feat(#223): services write path — materials links with 422 pre-validation`
- [ ] **Proceed directly to Task 5** (until the form sends `materials`, every admin service save clears links — spec ordering invariant).

### DoD
All §4 semantics covered by tests; suite green.

---

## Task 5: Admin — ServiceModal materials multi-select with notes (S1, S3)

### Classification: large
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §8 — picker source, form shape, config-union note
- `docs/design-system.md` — form controls, multi-select/combobox conventions
- `docs/domain-rules/materials.md` — picker = `/all?status=active` only

### Files
- MODIFY `frontend/admin/app/(main)/services/components/serviceFields.tsx`, `ServiceModal.tsx`; form state/types as used by the modal
- CREATE `frontend/admin/e2e/services-materials.spec.ts`
- TEST unit tests alongside the modal's existing suite

### Steps
- [ ] New field type in the `SERVICE_FIELDS` config union (`serviceFields.tsx:3-40`): `materials` — renders a checkbox multi-list (or existing multi-select control if one exists in the design system) of active materials from `getAllMaterials` (`/all?status=active`), plus a one-line note input under each checked item.
- [ ] Form state: `materials: {material_id, note?}[]`; map both ways against `service.materials` (edit mode: checked + note prefilled). The `material_hint` text field is REMOVED from the form here (spec §8; the payload keeps carrying `material_hint: ''` via the api-client default until Task 13 — harmless while backend still accepts it).
- [ ] Save: create/PUT payload includes `materials` (api-client schema from Task 2).
- [ ] Unit tests: select two materials + one note → payload CONTAINS `materials` (do NOT assert the payload lacks `material_hint` — the api-client `.default('')` keeps sending it until Task 13, and the backend keeps accepting it); edit prefills; unchecking removes from payload; note whitespace trimmed client-side is NOT required (server normalizes) but UI keeps raw input.
- [ ] RED e2e `services-materials.spec.ts` — **Scenario S1**: open ServiceModal for an existing service → check «Акварель» (+ note «бумага 300 г») and «Керамика» → save → the table row shows badges «Акварель», «Керамика». **Scenario S3**: reopen → uncheck «Керамика», save → only «Акварель» badge remains; a second edit saved WITHOUT touching materials keeps «Акварель».
- [ ] RED run: `npm run test:e2e -- services-materials.spec.ts` → fails; implement form changes → GREEN; run admin unit suite + `npx tsc --noEmit` + `npm run lint` → green.
- [ ] Commit: `feat(#223): ServiceModal — materials multi-select with notes (S1, S3)`

### DoD
**E2E test for scenarios S1 and S3 passes (RED-GREEN-REFACTOR)**; unit suite green; hint field gone from the form.

---

## Task 6: Backend — `?material_id=` list filter

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §5 — filter contract + implementation note
- `docs/domain-rules/services.md` — List contract (where the param joins `q`/`status`)

### Files
- MODIFY `backend/src/api/v1/services.py`, `backend/src/services/service.py`
- TEST `backend/tests/test_api_services.py`

### Steps
- [ ] `list_services` gains `material_id: UUID | None = Query(None)`; threaded into `ServiceService.list` like `q`.
- [ ] Predicate HOME (pinned, plan-review finding): the `ServiceService.list()` override in `services/service.py` (alongside the `q` handling, ~:75-100) — NOT `repositories/generic.py`: the generic `filters` dict is column-equality via `getattr(table, key)` (`generic.py:259-261`) and cannot express a join predicate. Predicate: `Service.id.in_(select(ServiceMaterial.service_id).where(ServiceMaterial.material_id == material_id))`, applied BEFORE COUNT so `total` reflects it.
- [ ] RED→GREEN tests: linked service filtered in; `total` = filtered count; composable with `q`/`status`/pagination; invalid UUID → 422; valid-but-unknown → `200 {"items": [], "total": 0}`; archived material id still filters (links survive archive).
- [ ] `python -m pytest tests/test_api_services.py -q` → green; full suite green.
- [ ] Commit: `feat(#223): services list — material_id filter`

### DoD
All §5 filter cases pass.

---

## Task 7: Admin — services page filter control (S2)

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §8
- `docs/design-system.md` — filter/select control conventions

### Files
- MODIFY `frontend/admin/app/(main)/services/page.tsx` + `ServicesContext` (query param plumbing)
- TEST extend `frontend/admin/e2e/services-materials.spec.ts`

### Steps
- [ ] A select «Материал: все | <title>…» (source: `getAllMaterials` active list) above the services table; selection feeds `material_id` into the server-paginated query via `ServicesContext` (api-client `ListParams` from Task 2); «все» = param omitted.
- [ ] Unit: context passes the param; reset on page change as other params behave.
- [ ] RED e2e — **Scenario S2**: seed/link two «акварель» services + one «керамика» (via UI or seed helper per existing spec setup conventions) → pick «Акварель» → only акварель rows visible and the list's total counter shows 2; pick «все» → all rows back. **Archived-material check** (spec §5): archive the «Акварель» material (admin archive action or API) → the filter selection still returns the linked services (links survive archive; picker no longer OFFERS it for new links, but an already-selected filter keeps working).
- [ ] GREEN; `npm run test:e2e -- services-materials.spec.ts`, unit suite, `tsc --noEmit` → green.
- [ ] Commit: `feat(#223): services page — material filter (S2)`

### DoD
**E2E test for scenario S2 passes (RED-GREEN-REFACTOR)**.

---

## Task 8: Backend — `used_in_services_count` on materials

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §6 — canonical definition, computed paths, default 0
- `docs/domain-rules/materials.md` — Relationships (counter rule)

### Files
- MODIFY `backend/src/schemas/material.py`, `backend/src/services/material.py`
- TEST `backend/tests/test_api_materials.py`

### Steps
- [ ] `MaterialResponse.used_in_services_count: int = 0` (default — generic mutation paths validate without the helper, spec §6).
- [ ] `MaterialService`: private `_attach_counts(db_session, materials)` — one aggregate: `SELECT material_id, COUNT(*) FROM service_materials JOIN services ON services.id = service_materials.service_id AND services.is_active = 1 GROUP BY material_id`; attach in `list`, `list_all`, `get`, and after `update`/`patch`/`archive`/`restore` returns. `create` returns 0.
- [ ] RED→GREEN tests: two linked active services → count 2; archive one service → count 1 (spec §11: "counter decrements when a linked service is archived"); no links → 0; count identical for `status=active` and `status=archived` list requests (canonical definition).
- [ ] Full backend suite green. Commit: `feat(#223): materials — used_in_services_count`

### DoD
§6 contract fully tested, incl. archive decrement.

---

## Task 9: Admin — materials table usage column (S4)

### Classification: small
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §8
- `docs/design-system.md`

### Files
- MODIFY `frontend/admin/app/(main)/services/components/materialsColumns.tsx` (or `MaterialsTable.tsx` column defs per actual layout)
- TEST extend `frontend/admin/e2e/services-materials.spec.ts`

### Steps
- [ ] Column «Где используется» rendering `material.used_in_services_count` (number; 0 renders as `0`, not dash — it IS information); no drill-down.
- [ ] Unit test for the cell; snapshots updated.
- [ ] RED e2e — **Scenario S4**: link a material to 2 services via the form → materials table shows 2; unlink one (edit service) → shows 1.
- [ ] GREEN; suites green. Commit: `feat(#223): materials table — usage column (S4)`

### DoD
**E2E test for scenario S4 passes (RED-GREEN-REFACTOR)**.

---

## Task 10: Backend — deletion matrix rows for `service_materials`

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §7
- `docs/domain-rules/materials.md` + `docs/domain-rules/services.md` — FK dependency tables (the exact rows to implement)
- `backend/src/domain/deletion.py` — FK_MATRIX/`_COUNTERS`/`CASCADE_HANDLERS` triple (feasibility panel verified :380-398, :680-688)

### Files
- MODIFY `backend/src/domain/deletion.py`
- TEST `backend/tests/test_api_materials.py` (+ service delete test file)

### Steps
- [ ] `FK_MATRIX[Service]` += `FKDependency(entity="service_materials", relation="Материал", nullable=False, action="cascade", auto=True, allowed_actions=["cascade"])` — row shape identical to `service_tags` (:159-162).
- [ ] `FK_MATRIX[Material]` becomes a non-empty list with the same-shaped row (relation label «Услуга»).
- [ ] Register the counter + cascade handler entries for both directions (the triple the panel verified).
- [ ] RED→GREEN tests: DELETE linked material no-body → 409, tree contains `service_materials` count + `allowed_actions: ["cascade"]`; body `{"resolutions": {}}` → 204, service survives with materials gone; DELETE unlinked material → 204 no body (unchanged); DELETE service with material links → existing 409/`{}` flow now lists `service_materials` too, links gone, material survives.
- [ ] Full backend suite green. Commit: `feat(#223): deletion matrix — service_materials auto-cascade both sides`

### DoD
§7 deletion contract fully tested.

---

## Task 11: Admin — materials DeleteDialog 409 flow (S5)

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §7-§8 (the 409 branch becomes live)
- `docs/domain-rules/materials.md` — Archive & delete semantics

### Files
- MODIFY `frontend/admin/app/(main)/services/components/` DeleteDialog usage for materials (verify against the generic DeleteDialog the issue called "defensive dead code")
- TEST extend `frontend/admin/e2e/materials-delete.spec.ts`

### Steps
- [ ] Verify the existing DeleteDialog 409 branch renders the dependency tree for `service_materials` (count of services, cascade confirm). If it was truly dead: add the dependency-tree rendering per the generic pattern used by other entities (mirror an entity that already 409s, e.g. Service delete dialog).
- [ ] RED e2e — **Scenario S5**: material linked to a service → delete → dependency dialog shows «используется в 1 услуге» → confirm → material gone from table; the service row remains, its badges updated, usage counters consistent.
- [ ] GREEN; admin unit + e2e for materials-delete green. Commit: `feat(#223): materials delete — 409 dependency flow (S5)`

### DoD
**E2E test for scenario S5 passes (RED-GREEN-REFACTOR)**.

---

## Task 12: Web client + domain — derive materials from links (S6)

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §9 — the two-field replacement table (THE contract of this task)
- `docs/domain-rules/materials.md` — display rule (note ?? description)
- `packages/domain/src/schedule.ts` — ScheduleDTO

### Files
- MODIFY `packages/domain/src/schedule.ts`, `frontend/web/app/lib/mappers/buildSchedule.ts`, `frontend/web/app/lib/model/dto/schedule.ts`, `frontend/web/app/page.tsx`, `frontend/web/app/ui/ActivityDetail.tsx`, `frontend/web/app/ui/BookingPrivateOverlay.tsx`
- TEST web mapper unit tests + `frontend/web/tests/` e2e

### Steps
- [ ] `buildSchedule.ts` (:81, :90): `materialHint` → joined per-material lines `materials.map(m => m.note ?? m.description).join("\n")` (empty array → `undefined` so the details block is omitted); `material` → `materials[0]?.title ?? ""` (response ordered by title, spec §3.3).
- [ ] `ScheduleDTO` (`packages/domain/src/schedule.ts:20`): replace `materialHint?: string` with `materialDetails?: string` (same optionality); `material: string` stays (derived string, same consumers).
- [ ] `page.tsx` (:57, :69): map the renamed field; `ActivityDetail.tsx` (:127, :149) unchanged contract (chip text + grouping key still compare the derived string); **explicit falsy guard**: today `page.tsx:69` always passes the details field — the consumer must render the materials block ONLY when `materialDetails` is truthy (empty-links service → NO block, spec §9); `BookingPrivateOverlay.tsx` — the editable «Материал» input KEEPS its behavior, prefill now the first title.
- [ ] Unit tests (vitest): fallback (note ?? description), no-note → description, no materials → `''`/`undefined` **and the block-omission guard** (consumer renders nothing for a materials-less service), first-title derivation; update `useSchedule.test.tsx`, `buildSchedule.test.ts`, `integration-schedule.test.ts`.
- [ ] RED e2e (web `tests/`, extend the existing visual/spec set) — **Scenario S6**: service with linked materials (one with note, one without) → card shows first material title as the chip, details show note text for one and catalog description for the other; a service without materials renders NO materials block (assert the block's absence explicitly — the guard is the point); booking form opens with «Материал» prefilled = first title and still editable.
- [ ] GREEN; `npm test` + `npx playwright test` (web) + `npx tsc --noEmit` → green. Web visual snapshots updated.
- [ ] Commit: `feat(#223): web client — materials from links, booking prefill (S6)`

### DoD
**E2E test for scenario S6 passes (RED-GREEN-REFACTOR)**; the §9 replacement table fully implemented.

---

## Task 13: Retire `material_hint` — the single removal task

### Classification: large
### Required Docs
- `docs/specs/2026-09-07-materials-services-link-design.md` §3.2 (the ONE Alembic revision), §10 (full checklist), §11 (regression tests)
- `docs/domain-rules/services.md` + `docs/domain-rules/materials.md` — finalize "(in design)" markers
- `backend/alembic/versions/` — hand-written migration style (e.g. `ce42b37ee405_*`)

### Files
- CREATE the migration; MODIFY backend model/schemas/api sort map; MODIFY `packages/api-client`, `packages/domain` leftovers; MODIFY admin leftovers (`serviceColumns.tsx` hint column, `ServicesTable.tsx:60`, `lib/buildSchedule.ts:66`); MODIFY `backend/src/seed/seed.py`; MODIFY both domain-rules docs
- TESTS: `sort_by=material_hint → 422` regression; seed smoke; fixture updates

### Steps
- [ ] Migration `backend/alembic/versions/<rev>_service_materials_and_drop_material_hint.py` — **up**: `op.create_table("service_materials", Column("service_id", String(36), FK("services.id", ondelete="CASCADE"), primary_key=True), Column("material_id", String(36), FK("materials.id", ondelete="CASCADE"), primary_key=True), Column("note", Text(), nullable=True))`; `op.drop_column("services", "material_hint")`. **down**: `op.add_column("services", sa.Column("material_hint", sa.Text(), nullable=True))`; `op.drop_table("service_materials")`. Down-revision = current head `3450b3c61fa7`. Verify: `alembic upgrade head` then `alembic downgrade -1` then `upgrade head` on a scratch DB.
- [ ] Backend: remove `material_hint` from `models/service.py`, all four schemas, `_SERVICE_SORT_MAP` + `ServiceSortBy` (`api/v1/services.py:36-48`).
- [ ] RED regression test FIRST (before the code removal, assert current behavior flips): `GET /api/v1/services?sort_by=material_hint` → 422 after removal; any fixture using the field updated.
- [ ] `packages/api-client`: remove `material_hint` from `ServiceResponseSchema` (:138) and `ServiceCreateSchema` (:433 — the `.default('')` that made admin send it), fixtures (:76, :106), `schemas.test.ts:231-242`. `npm test` → green.
- [ ] Admin: delete the hint column (`serviceColumns.tsx:63-67`), the row transform (`ServicesTable.tsx:60`), the schedule mapper consumer (`lib/buildSchedule.ts:66`); update their tests + visual snapshots.
- [ ] Seeds (`backend/src/seed/seed.py`): remove the 7 `material_hint` values (:222-246); add `_seed_service_materials` (idiom: `_seed_service_tags` :405-425) linking existing seeded materials to seeded services (≥3 links, at least one with a note). Seed smoke test: re-seeded DB → services have `materials` non-empty.
- [ ] Domain rules: flip every "(in design)" marker in `services.md`/`materials.md` to landed wording referencing this plan; remove the struck-through `material_hint` field row.
- [ ] Full verification: backend `python -m pytest -q`; admin `npm run test:all`; web `npm test` + `npx playwright test`; api-client `npm test`; `npx tsc --noEmit` in all three frontends; `npm run lint` admin.
- [ ] Commit: `chore(#223): retire material_hint — migration, schemas, clients, seeds, docs`

### DoD
`grep -rn "material_hint" backend/src frontend packages docs/domain-rules` returns only historical references (specs/plans/changelogs); every suite green; `alembic upgrade head` produces the spec §3.2 schema.

---

## Final verification (whole plan)

- [ ] All six scenario e2e specs green: `services-materials.spec.ts` (S1-S4), `materials-delete.spec.ts` (S5), web spec (S6).
- [ ] Backend + admin + web + api-client suites green; typecheck + lint clean.
- [ ] Spec §10 checklist fully executed; domain-rules consistent with shipped behavior.
- [ ] Single PR `feat(#223)` → review → merge → close #223.
