# GH #223 — Materials ↔ Services: link with per-service note, service filter, retire `material_hint`

- **Issue:** #223 `Materials: link entity to services — without a link the Material entity is meaningless`
- **Status:** DESIGN phase, G1a passed 2026-09-07 (concept approved with one revision round); panel review folded (G1b revision 1, same day — 5 reviewers: 2 NEEDS_REVISION, 2 SOUND_WITH_CONCERNS, 1 SOUND; all folded below)
- **Scope:** backend (`service_materials` association + note, services filter, materials usage counter, drop `material_hint`) + `packages/api-client` (shared Zod schemas, fixtures, list params) + `packages/domain` (ScheduleDTO) + `frontend/admin` (ServiceModal multi-select with notes, services filter + badges, materials usage column) + `frontend/web` (client screens derive materials from links; booking form prefill). Tags mechanics untouched.
- **Grounding:** host recon 2026-09-07 (scout fact sheet; file:line facts reflect the live tree at commit `e8aad80`); all six issue claims confirmed against the tree (§1.2).

---

## 1. Context & Problem

### 1.1 Current state (live-tree facts)

- **Material is a standalone island.** `backend/src/models/material.py:9-13` — only `title` (String 200) + `description` (Text), soft-delete base. Zero relationships, no FK. Full CRUD + archive/restore in `backend/src/api/v1/materials.py` (list :66, `/all` :101, get :123, POST :142, PUT :152, PATCH :172, DELETE :192, archive :244, restore :269). Deletion matrix entry is literally `Material: []` (`backend/src/domain/deletion.py:196`).
- **Service carries materials as free text.** `backend/src/models/service.py:26` — `material_hint: Text nullable`: «что взять с собой», hand-typed per service. Existing links of Service: `tariffs` (1-N cascade, :28) and `tags` (M2M via `service_tags`, :31-33).
- **`material_hint` consumers (complete map, panel-verified):**
  - `frontend/admin`: form field `serviceFields.tsx:90`, table column `serviceColumns.tsx:63-67`, row transform `ServicesTable.tsx:60`, schedule mapper `lib/buildSchedule.ts:66`;
  - `frontend/web` (client app): `lib/mappers/buildSchedule.ts:81` (`materialHint`) AND `:90` — derived single string `material = material_hint.split(',')[0]` flowing into `page.tsx:57,69` (card label + details), `ui/ActivityDetail.tsx:127,149` (chip text + grouping key), and `BookingPrivateOverlay.tsx:91,181-182` — an **editable «Материал» booking-form field prefilled from it**; plus `lib/model/dto/schedule.ts` tests;
  - **shared packages:** `packages/api-client/src/schemas.ts:138` (ServiceResponse), `:433` (ServiceCreate `.default('')` — admin sends `material_hint: ''` on every create), `:442` (Update = strict derivative), fixtures `__fixtures__/backend-responses.json:76,106`, `schemas.test.ts:231-242`; `packages/domain/src/schedule.ts:20` (ScheduleDTO.materialHint). Also `endpoints.ts:86-108` — fixed `ListParams` (a new `?material_id=` cannot be sent without extending it).
  - Backend: sort whitelist `_SERVICE_SORT_MAP` key `material_hint` (`backend/src/api/v1/services.py:40`), documented in `docs/domain-rules/services.md:62`.
- **No reference-based service filtering exists.** `GET /api/v1/services` supports only `status`, `q` (substring), sort, pagination (`backend/src/api/v1/services.py:76-100`). Tags are write-side + nested response only — no tag filter on read. This spec adds the first reference-based filter.
- **Reusable idiom exists.** Junction tables: plain `Table(...)` with composite String(36) PKs (`backend/src/models/tag.py:16-68`). Write shape: `tag_ids: list[str]` on create/update, `tag_ids: list[str] | None = None` on PATCH (absent = preserve; sent = hard-replace) — `backend/src/schemas/service.py:55,69,96`, replace loop `backend/src/services/service.py:142-178`. NOTE: tag linking does **no pre-validation** of ids — an unknown `tag_id` surfaces as a DB FK violation on flush.
- **Migrations:** hand-written Alembic, 13 revisions in `backend/alembic/versions/`; recent column-change example `ce42b37ee405_make_client_fields_nullable.py`. Seed example for join inserts: `_seed_service_tags` (`backend/src/seed/seed.py:405-425`).
- **Domain rules already anticipate the link**: `docs/domain-rules/materials.md:47` — "Service → has many Materials (via service_materials join)".

### 1.2 Issue claims vs reality (recon-verified)

| # | Issue claim | Verdict |
|---|---|---|
| 1 | Material has zero relations, only title+description | CONFIRMED (`models/material.py:9-13`) |
| 2 | `services.material_hint` is free text, not a reference | CONFIRMED (`models/service.py:26`) |
| 3 | No `service_materials` join exists | CONFIRMED (only `*_tags` in `models/tag.py`) |
| 4 | `FK_MATRIX: Material: []` | CONFIRMED (`domain/deletion.py:196`) |
| 5 | Materials DeleteDialog 409 branch is defensive dead code | CONFIRMED as a consequence of the always-204 delete (`domain-rules/materials.md:35,58`): the branch is unreachable today — **becomes live code with this spec** (§7) |
| 6 | Mirror `service_tags` pattern | VALID — adopted (§3-§5), with two deliberate deviations (link note; explicit id pre-validation) |

### 1.3 Problem

Materials (акварель / акрил / масло / керамика — artistic mediums) form a vocabulary with **no connection to services**, so they cannot do their only job: filter services by medium («все услуги по акварели»). Meanwhile `material_hint` — a hand-typed per-service text about materials — will become a second, diverging source of truth about "which materials this service uses" once real links exist.

## 2. Locked decisions (G1a user-approved 2026-09-07)

1. **Materials are a classification dimension of services** (not consumables): link many-to-many via a `service_materials` join table, built on the `service_tags` idiom.
2. **The primary user job is filtering**: `GET /api/v1/services?material_id=<uuid>` — the first real filter on the services page. Admin UI: filter control + material badges on service rows.
3. **Per-link note with material-description fallback.** Each link may carry a note («как этот материал используется в этой услуге»). Display rule everywhere: show link note if present, else the material's `description` from the catalog. One source of truth: catalog describes globally, the link overrides per service.
4. **`material_hint` is retired** (user-approved extension beyond the issue text): column, schemas, sort key, admin form/table column, web DTO/mappers — all removed. The client service screen renders the materials block **from links** instead. Existing hint text is NOT auto-migrated (links don't exist yet; a text blob cannot be split per material) — content is re-entered by hand.
5. **Materials table gets a usage counter** — «where used» as a count of services, no clickable drill-down.
6. **Deletion follows the generic FK matrix** (GH #207 mechanics): `service_materials` is an auto-cascade dep for both endpoints (§7). No special-casing.

## 3. Data model & migration

### 3.1 `service_materials` association (association-object pattern)

**Panel finding (feasibility + best-practices, folded): a payload column (`note`) on the join is NOT reachable through a plain `secondary=` relationship** — SQLAlchemy secondary relationships load only target entities (SA 2.0 docs: association-object pattern). Therefore the link is a mapped association class, not a bare join `Table`:

`ServiceMaterial` (table `service_materials`):

| Column | Type | Constraints |
|---|---|---|
| `service_id` | String(36) | PK, FK → services.id ON DELETE CASCADE |
| `material_id` | String(36) | PK, FK → materials.id ON DELETE CASCADE |
| `note` | Text NULL | per-service override text; NULL = use material.description |

- Composite PK (`service_id`, `material_id`) — same column shape as `service_tags` (`models/tag.py:22-28`); no timestamps (join idiom). `note` is the single deliberate structural addition to the idiom, justified by decision 3 (§2).
- Relationships: `ServiceMaterial.material` (many-to-one to Material); `Service.service_materials` (one-to-many over the association, cascade delete-orphan). `ServiceResponse.materials` is built from association rows `{material.id, material.title, material.description, note}`. No inverse `Material.services` relationship — the usage counter is a plain aggregate query (§6); YAGNI.
- Eager loading: `selectinload(Service.service_materials).joinedload(ServiceMaterial.material)` added next to `tariffs`/`tags` eager-loads everywhere they exist today (`services/service.py:86,101,109` pattern; `get()` :126-136, options :133).
- **Third deliberate deviation from the tag idiom** (in addition to `note` and id pre-validation): both FKs declare `ON DELETE CASCADE` at the **model and migration level** — tag joins declare no `ondelete` (`models/tag.py:24-25`). Rationale: DB-level safety so `create_all`-based test schemas match Alembic DDL; the app-side cascade executor (GH #207) remains the functional owner.

### 3.2 Migration (one Alembic revision, hand-written)

- **Up:** create table `service_materials` (columns above); drop column `services.material_hint`.
- **Down:** `op.drop_table('service_materials')`; recreate `services.material_hint` (Text, NULL). Column DATA is lost on downgrade — accepted: the field is retired by design; link rows are also lost (they belong to the new feature).
- Chain is linear, head `3450b3c61fa7`; batch-altering `services` has repo precedent (`275ba490cab8`). No data backfill in either direction.

### 3.3 Deterministic order of nested materials

`ServiceResponse.materials` is ordered `material title ASC, material id ASC` (deterministic payload; matches the repo's default-order philosophy `title ASC, id ASC`) — achieved via the ordered loader (`selectinload(...).order_by(Material.title, Material.id)`) or an equivalent post-load sort; a bare unordered `selectinload` is non-deterministic and would make visual snapshots flaky. The plan pins the mechanism.

## 4. API contract — writing links on services

New schema `ServiceMaterialLinkIn`: `{ material_id: str (UUID), note: str | None = None }`.

| Endpoint | Field | Semantics |
|---|---|---|
| `POST /api/v1/services` | `materials: list[ServiceMaterialLinkIn] = []` | create links on service create |
| `PUT /api/v1/services/{id}` | `materials: list[ServiceMaterialLinkIn] = []` | hard-replace (delete all + insert), same as `tag_ids`/`tariffs` |
| `PATCH /api/v1/services/{id}` | `materials: list[ServiceMaterialLinkIn] \| None = None` | absent/null → **preserve** existing links; sent (incl. `[]`) → hard-replace; `[]` clears all |

Validation (Pydantic + service layer):

- **PUT with `materials: []` clears all links** — the same hard-replace semantics as `tag_ids`/`tariffs` on PUT; POST with `[]` (the default) simply creates an unlinked service. This mirrors `schemas/service.py:55,69` exactly; no third semantic.
- **Unknown `material_id` → 422 VALIDATION_ERROR.** Deliberate deviation from tags (which rely on a DB FK violation surfacing as 500-flavored error). Explicit pre-check in the service layer: all ids must exist before any write. Note: archived materials **are valid link targets** (archive is a lifecycle flag, not existence).
- **Duplicate `material_id` within one list → 422** (the composite PK would reject it anyway; fail fast with a clearer message).
- **Note normalization (server-side, on write):** whitespace-only `note` is stored as NULL (fallback semantics stay unambiguous). Max length: none beyond Text — the `material_hint` precedent (no cap) and `Material.description` (Text) are the established norms; a cap would be a new rule nobody asked for.
- Clearing a note while keeping the link = send `{material_id, note: null}` (or omit `note`) in a replacing list.

Read shape on `ServiceResponse.materials`: `[{ id, title, description, note }]` — the material's `description` travels with the link so clients render the fallback without extra fetches. `description` here is a snapshot taken at serialization time (live join, not a copy).

## 5. API contract — reading and filtering services

- `GET /api/v1/services` and `GET /api/v1/services/{id}` include `materials: [{id, title, description, note}]` (ordered per §3.3). `GET /api/v1/services/all` (bare array) likewise.
- **New filter param**: `GET /api/v1/services?material_id=<uuid>`
  - Returns services linked to that material; composable with `status`, `q`, `sort_by`, `sort_order`, pagination. `total` reflects the filtered set (the predicate lands before COUNT, same as `q` — `domain-rules/services.md:65` mechanics).
  - Invalid UUID → 422 VALIDATION_ERROR (param type validation).
  - Valid-but-unknown material id → **200 with `{"items": [], "total": 0}`** (filter semantics, mirrors `q`-no-match; not an error; the client cannot and need not distinguish "no such material" from "no services use it"). This asymmetry vs write-side 422 is intentional: write creates a data dependency, read is a query.
  - An archived material id is accepted the same way (links to archived materials still exist, §7).
  - Single material per query. Multi-select filter is deliberately not built (§ Out of scope).
  - **Implementation note (panel-verified):** the generic repo `filters` dict applies column-equality only (`repositories/generic.py:259-261`) — the join/EXISTS predicate needs a dedicated capability in the query path, the same way `q` got one. Plan-level work, called out here so it is not discovered late.

## 6. API contract — materials read: usage counter

`MaterialResponse` gains `used_in_services_count: int` — the number of **non-archived** services linked to the material. One canonical definition regardless of the request's `status` param (the counter describes the material, not the requested slice; an archived material shows the same counter as in the active list).

- Computed paths: `GET /materials` (list), `GET /materials/all`, `GET /materials/{id}`, and also the mutation returns `PUT/PATCH/POST /{id}/archive|restore` — `MaterialService` recomputes via one shared helper (a single aggregate: LEFT JOIN + COUNT ... WHERE service is not archived, GROUP BY material_id; no N+1). `POST /materials` (create) returns 0 by definition.
- The field carries a Pydantic default (`= 0`) so any `GenericService` path that does not run the helper still validates (panel finding: create/update/patch/archive/restore all return `MaterialResponse` via the generic layer).
- Archived services don't count (the counter answers "where is it used NOW"); archiving a service decrements it.

## 7. Deletion & archive semantics

Follows the generic FK-dependency matrix (GH #207); no special cases:

- **FK_MATRIX additions:**
  - `Service` gains `service_materials` (join, NOT NULL PK) → **cascade (auto)** — identical row to `service_tags` (`deletion.py:160`).
  - `Material` gains `service_materials` (join, NOT NULL PK) → **cascade (auto)**.
- **`DELETE /api/v1/materials/{id}`** — behavior CHANGES from "always 204":
  - not linked → 204 as today;
  - linked → **409 + dependency tree** (entity `service_materials`, count, `allowed_actions: ["cascade"]`), body `{"resolutions": {}}` → auto-cascade links + hard-delete in one transaction → 204.
  - This makes the existing Materials DeleteDialog 409 branch **live code** (issue claim #5) — the dialog already renders the generic dependency tree.
  - `docs/domain-rules/materials.md` "always 204 / zero FK dependencies" statements (:16, :35, :58) are updated together with this spec.
- **`DELETE /api/v1/services/{id}`** — unchanged mechanics: `service_materials` becomes one more auto-cascade dep in the 409 tree; resolutions `{}` path handles it automatically.
- **Archive interplay** (explicit rules, no surprises):
  - Archiving a material does NOT touch its links. A service linked to an archived material keeps the link; `ServiceResponse.materials` still includes the archived material (it is service content). The admin picker for NEW links lists **active** materials only (`GET /materials?status=active` default already).
  - Archiving a service does not touch links; it stops counting toward `used_in_services_count` (§6).
  - The materials-block rendering rule (§9) applies to archived materials identically — archived ≠ hidden.

## 8. Admin UI (`frontend/admin`)

- **ServiceModal** (`services/components/`): multi-select of materials replacing the `material_hint` text field (`serviceFields.tsx:90`). Picker source: `GET /api/v1/materials/all?status=active` (bare array via the existing `getAllMaterials`; archived materials are not offered for NEW links). For each selected material an optional note input. Saving maps to `materials: [{material_id, note}]` (PUT/PATCH per existing form flow). Implementation note: `SERVICE_FIELDS` is a closed config-driven union of 4 field types rendered in a generic loop (`serviceFields.tsx:3-40`, `ServiceModal.tsx:345`) — the multi-select-with-notes lands as a new field type (or a bespoke section); plan decides, no other form fields change shape.
- **Services table** (`serviceColumns.tsx`): the `material_hint` column (:63-67) is replaced by a **materials badges column** (compact chips with material titles only — the `note ?? description` display rule does NOT apply to badges, it governs the web materials text block §9).
- **Services page filter**: a control «материал: все | <title>…» feeding `?material_id=` into the server-paginated list (`ServicesContext`). Default = no filter. Requires the shared api-client `ListParams` extension (§10).
- **Materials table** (`MaterialsTable.tsx`): new column «Где используется» rendering `used_in_services_count` (plain number, no drill-down).
- **DeleteDialog (materials)**: the 409 branch becomes reachable — confirm the generic dependency UX works for `service_materials` (count of services, cascade confirm, 204). Existing component; tests extended.

## 9. Web client (`frontend/web`) + shared packages

**Client screens derive everything from links** (`ServiceResponse.materials`). The current `material_hint` plumbing has TWO derived fields in `buildSchedule.ts` — both get a defined replacement (panel finding: the naive "just drop the field" plan would break the booking form):

| Today (`material_hint`) | After #223 |
|---|---|
| `materialHint` (:81) → `materialDetails` card details (`page.tsx:69`, `ActivityDetail.tsx:127`) | joined per-material text: each linked material renders `note ?? description` (§2 rule), lines joined with `\n` (or equivalent list rendering — plan's call); no materials → the details block is omitted |
| `material` (:90, first comma-segment) → card chip text (`ActivityDetail.tsx:127`), grouping key (:149), **prefill of the editable «Материал» input in the private booking form** (`BookingPrivateOverlay.tsx:91,181-182`) | derived string = first linked material's `title` (materials ordered per §3.3), `''` when no materials. The booking-form field itself is CLIENT input (a booking preference) and **stays editable as-is** — only its prefill source changes. Grouping key keeps comparing the derived string. |

- A service with zero linked materials renders **no materials block** (content shift vs today — accepted at G1a).
- DTO chain updates: `frontend/web` mappers (`buildSchedule.ts`), `lib/model/dto/schedule.ts`; **`packages/domain/src/schedule.ts:20`** (`ScheduleDTO.materialHint` → removed; a `materials` payload or the two derived strings enter the DTO — plan pins which shape, the derivation rule above is the contract).
- **Rejected alternative** (best-practices panel): a server-computed `display` field. The API ships data (`note` + `description`); the rendering rule lives once in the domain docs and both clients apply the same one-expression fallback. Computed display strings in the API would bake presentation into the contract.
- No other client-app changes: filtering and link editing are admin-only.

## 10. `material_hint` removal checklist (breaking changes)

| Layer | Change |
|---|---|
| DB | column `services.material_hint` dropped (§3.2) |
| Backend schemas | `material_hint` removed from Service Create/Update/Patch/Response |
| Sort whitelist | key `material_hint` removed from `_SERVICE_SORT_MAP` (`api/v1/services.py:40`) and `ServiceSortBy` Literal → **`sort_by=material_hint` now 422** (known breaking change; admin UI is updated in the same release and stops sending it) |
| **`packages/api-client`** | `schemas.ts:138` (ServiceResponse) and `:433` (ServiceCreate `.default('')`; Update = strict derivative :442) — **critical**: without this, admin keeps sending `material_hint: ''` while backend `ServiceUpdate` has `extra="forbid"` → 422 on every service save. Add `materials` to Create/Update/Response schemas; extend `endpoints.ts:86-108` `ListParams` with `material_id`; update fixtures (`backend-responses.json:76,106`) and `schemas.test.ts:231-242` |
| **`packages/domain`** | `schedule.ts:20` `ScheduleDTO.materialHint` removed; replacement per §9 |
| Admin | form field (`serviceFields.tsx:90`), table column (`serviceColumns.tsx:63-67`), row transform (`ServicesTable.tsx:60`), schedule mapper `lib/buildSchedule.ts:66`, mutation tests |
| Web | mappers + DTO + tests (§9) |
| Seeds | `backend/src/seed/seed.py`: 7 service seeds stop setting `material_hint` (:222-246); **new**: seed `service_materials` links (example idiom: `_seed_service_tags` :405-425) so dev/demo data exercises the feature |
| Docs | `docs/domain-rules/services.md` (field row, sort whitelist, relationships, PATCH row, FK table, auto-deps bullet), `docs/domain-rules/materials.md` (deletion semantics + relationships) — updated with this spec, same commit |
| Tests | existing specs asserting `material_hint` (API, schemas, admin, web, e2e, visual snapshots) are updated alongside |

## 11. Testing strategy

- **Backend unit/service tests:** link hard-replace on PUT; PATCH absent→preserve / sent→replace / `[]`→clear; unknown id → 422; duplicate id → 422; whitespace note → NULL; filter predicate + `total`; counter counts non-archived services only; **counter decrements when a linked service is archived**; materials order deterministic.
- **Backend API tests (test_api_services / test_api_materials):** full contract incl. 409-with-tree + resolutions-{} path for linked material delete; `?material_id=` valid / invalid-UUID-422 / **unknown-id → 200 `{"items": [], "total": 0}`**; nested `materials` in all read endpoints incl. `/all`; **regression: `sort_by=material_hint` → 422** (the whitelist removal).
- **Seeds:** smoke assertion that seeded services produce non-empty `service_materials` rows (§10 seeds).
- **Admin e2e + unit:** scenarios S1-S5 (below); visual snapshots updated for the new badges column, filter control and usage column.
- **Web e2e/unit:** scenario S6; mapper tests for `note ?? description` fallback, derived-`material` string (first title) and empty-links case.

## User Scenarios (each maps to an E2E test)

| # | Scenario (admin unless stated) | E2E |
|---|---|---|
| S1 | Link materials to a service (create/edit ServiceModal, optional per-material note) → badges appear in the services table row | admin services spec (create + edit flows) |
| S2 | Filter services by material («акварель») → only linked services listed, counter `total` matches | admin services spec (filter flow) |
| S3 | Change a service's material set (remove one; keep others); saving WITHOUT touching materials keeps links intact | admin services spec (edit flow) |
| S4 | Materials table shows how many services use each material; count updates after linking/unlinking | admin materials spec |
| S5 | Delete a linked material → 409 dialog shows dependency count → confirm → material gone, service alive, badges/counters updated | admin materials-delete spec (existing file, extended) |
| S6 | Client app (web): service screen shows materials — link note when present, else material description; no materials → no block | web client spec (existing tests dir) |

## 12. Out of scope (deliberately NOT built)

- Quantities per material / consumption / cost calculation (себестоимость) — the link carries no amount; extensible later without rework.
- Multi-material filter (AND/OR), tag-based filtering for services.
- Clickable drill-down from the usage counter to the list of services.
- Auto-migration of `material_hint` text into link notes (impossible: links don't exist yet; re-entered by hand).
- Any change to tags mechanics (incl. adding the same id pre-validation to tags).
- `Material.services` inverse relationship / materials page filtering by service.
