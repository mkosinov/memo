# Design Spec — GH #207: DELETE = real hard delete + granular dependency resolutions

**Date:** 2026-08-15
**Issue:** GH #207. **Refs:** #194 (prior deletion policy — soft-delete layer this revises), #178 (is_active in Update schemas — auto-closed), #184/#185 (GenericService contract tests — updated), #189 (tags drift — absorbed), #195 (status filter — compatible), #198 (restore buttons — complemented)
**Source of truth:** issue #207 body + approved design concept (G1a passed 2026-08-15). Do NOT re-brainstorm — this spec is written verbatim from the approved concept.

---

## 1. Background — what this revises

GH #194 (merged 2026-08-01) split entities into soft-delete (Master, Location, Service, Material, Client) and hard-delete (Tag, Photo, Visitor, Activity, Record, UserSettings). The 5 soft-delete entities kept `is_active` and a `SoftDeleteService`/`SoftDeleteRepository` whose `delete()` set `is_active=False`.

**This issue revises the soft-delete side:** `DELETE` becomes a real hard delete for the 5 entities (with a dependency-resolution mechanism for FK blockers), and archive/restore moves to dedicated `POST /archive` + `POST /restore` endpoints. The hard-delete entities from #194 already have real hard delete and dependency-ordered cascades (ActivityService.delete, RecordService.delete, VisitorService.delete) — they are **out of scope** for #207 and continue as-is.

**Scope:** the 5 soft-delete entities only — Master, Location, Service, Material, Client.

---

## 2. New API surface

| Endpoint | Action |
|---|---|
| `DELETE /{id}` | Hard delete. **Zero deps** → 204 (row deleted outright). **Any dep (auto or non-auto)** → 409 Conflict + dependency tree (no rows modified). See §5. |
| `POST /{id}/delete` | Hard delete with resolutions. Body: `{"resolutions": {"entity": "nullify"\|"cascade"}}` → 204. Unallowed action → 422. |
| `POST /{id}/archive` | Archive (sets `is_active=False`). **New endpoint**, all 5 entities. |
| `POST /{id}/restore` | Restore (sets `is_active=True`). **New endpoint**, all 5 entities. |
| `?status=active\|archived\|all` | Unchanged — `ArchiveStatus` enum stays (`models/enums.py:47-52`) |

Applies to: `masters`, `locations`, `services`, `materials`, `clients` API modules.

**Removed behavior:** `PUT/PATCH` no longer accept `is_active` (see §3 — auto-closes #178). Archive/restore is exclusively via the two new POST endpoints.

---

## 3. Terminology boundary — transition at Service layer (HARD RULE)

One layer = one vocabulary. The `is_active` ↔ `archived` translation happens in exactly ONE layer: **Service**.

```
Frontend → archived: bool, "В архив"/"Восстановить", POST /archive + /restore
API      → archived: bool (Response schema), POST /archive, POST /restore, ?status=
─────────── Service: archive()→is_active=False, restore()→is_active=True ───────────
Repo     → is_active (filter, patch), delete = hard. NO archive()/restore() methods here.
Model/DB → is_active: bool column (UNCHANGED — no migration, no rename)
```

### 3.1 Response schema (all 5 entities)

`is_active: bool` → `archived: bool` (**INVERSION: `true` = in archive**). The DB column stays `is_active`; the API only ever exposes `archived = not is_active`. Mapper translation lives in the Service/response-builder layer.

### 3.2 PUT/PATCH schemas (all 5 entities)

`is_active` field **REMOVED** from all Update (PUT) and Patch schemas. Archive/restore only via `POST /archive` + `POST /restore`. This **auto-closes #178** (the 4 #178 entities + Client #201).

Consequence: `PUT /masters/{id}` with a body containing `is_active` → 422 (extra field, same as any unknown field in a strict schema). Document this as the deliberate break — #178 entities previously had `is_active` accepted/required on PUT; it is now rejected.

### 3.3 Repository

- `SoftDeleteRepository` → `ArchiveRepository` (rename).
- `delete` = **hard** (inherited from `BaseRepository`, **no override** — previously `SoftDeleteRepository` overrode it to set `is_active=False`).
- `list` with `?status=` filter **stays** (uses `is_active` column — unchanged).
- **NO `archive()`/`restore()` methods** here — those are Service-level (repo just exposes `patch`).

### 3.4 Service

- `SoftDeleteService` → `ArchiveService` (rename).
- **Adds** `archive(id)` → `repo.patch(id, {is_active: False})`; `restore(id)` → `repo.patch(id, {is_active: True})`. Both return the updated entity (mapped to `archived` in the response).
- `delete()` = **hard** (delegates to `repo.delete` which is now hard — no `is_active` change). For entities with FK deps, `delete()` runs the dependency resolution (see §6).
- All 5 entity services inherit from `ArchiveService` instead of `SoftDeleteService`.

### 3.5 api-client (frontend)

- Zod response schemas: `is_active: boolean` → `archived: boolean` (inverted semantics — `true` = archived).
- `is_active` **removed** from all `Update*` / `Patch*` request types.
- Add `archive(id)` + `restore(id)` methods to each of the 5 entity API modules (POST endpoints).
- Keep `?status=` list param (unchanged).

---

## 4. FK dependency matrix (final — user-approved at G1a)

| Entity → Relation | Nullable? | Action | User choice? | Notes |
|---|---|---|---|---|
| **Material** | (no FK deps) | — | — | Zero DB dependencies. Hard delete always succeeds. |
| Master → **activities** (master_id) | NOT NULL | **block** | N/A — `allowed_actions: []` | Activity has no `is_active` (cannot archive). User must remove activities manually first, OR archive the master. |
| Master → **users** (master_id) | nullable | **nullify** | choice: `["nullify"]` | Unlink user from master (user survives). |
| Master → **master_tags** (join) | NOT NULL PK | **cascade** (auto) | auto — no choice | Join table rows deleted automatically. |
| Location → **activities** (location_id) | NOT NULL | **block** | N/A — `allowed_actions: []` | Same as Master. |
| Location → **location_tags** (join) | NOT NULL PK | **cascade** (auto) | auto | Join table. |
| Service → **activities** (service_id) | NOT NULL | **block** | N/A — `allowed_actions: []` | Same as Master. |
| Service → **tariffs** (service_id) | NOT NULL | **cascade** (auto) | auto | Config of the service — unambiguous. |
| Service → **photos** (service_id) | nullable | **nullify** (auto) | auto | Photo becomes unlinked (survives). Photo is a general resource (per #194 SET NULL policy). |
| Service → **service_tags** (join) | NOT NULL PK | **cascade** (auto) | auto | Join table. |
| Client → **records** (client_id) | nullable | **nullify** | choice: `["nullify"]` | Record becomes anonymous (survives). |
| Client → **visitors** (client_id) | NOT NULL | **cascade** | choice: `["cascade"]` | Visitors deleted. Cascade **follows through**: visits → payments (per existing `VisitorService.delete` precedent). |
| Client → **client_tags** (join) | NOT NULL PK | **cascade** (auto) | auto | Join table. |

**Key rules:**
- **activities = always block** (`allowed_actions: []`). `activities.master_id`/`location_id`/`service_id` are NOT NULL, and `Activity` has no `is_active` (extends `AbstractModel`, not `AbstractModelSoftDelete` — per #194) so it cannot be archived. DELETE is impossible while activities exist — the only option is archive.
- **(auto)** = join tables (`*_tags`) and unambiguous relations (tariffs, photos-service). Resolved automatically, no user choice. Frontend **shows** them in the preview but does not ask.
- Aggregate cascade (Client → visitors) follows the existing dependency-ordered SQL precedent (see §8): visitor delete cascades to visits → payments → visitor_tags → visitor.

---

## 5. 409 Conflict response (dry-run preview — counters + sums)

Returned by `DELETE /{id}` when dependencies exist. No rows modified. Contains **counters and sums only** — no individual row data.

```json
{
  "detail": "has_dependencies",
  "dependencies": [
    {"entity": "activities", "count": 3, "allowed_actions": [], "message": "Remove activities first or archive"},
    {"entity": "visitors", "count": 12, "allowed_actions": ["cascade"],
     "cascade_preview": {"visits": 45, "payments": {"count": 30, "total": 15000}}},
    {"entity": "records", "count": 47, "allowed_actions": ["nullify"]},
    {"entity": "client_tags", "count": 5, "allowed_actions": ["cascade"]}
  ]
}
```

Field semantics:
- **204 vs 409:** `DELETE` returns 204 only when the entity has **zero** dependencies of any kind (e.g. Material always; a Master with no users/activities/tags). Any dependency — auto or non-auto — produces a 409 so the user has **informed consent** about what will be deleted/nullified, even when no choice is involved.
- `allowed_actions: []` → **blocked** (the `activities` case). DELETE impossible via either endpoint — only archive.
- `allowed_actions: ["nullify"]` / `["cascade"]` → choice required from the user (non-auto dep).
- `allowed_actions: ["cascade"]` with no entry in the user's `resolutions` body on `POST /{id}/delete` → 422 (resolution required for all non-auto deps).
- Auto deps (`*_tags`, tariffs, photos-service) appear in the tree with `allowed_actions` matching the auto-action but are **never** part of the user's `resolutions` body — server resolves them automatically.
- `cascade_preview` — downstream aggregates for cascade actions. For Client → visitors cascade: `visits` count, `payments` count + `total` sum. Absent for nullify actions (nothing downstream is hard-deleted).
- `message` — human hint, free-form Russian string (shown in the frontend dialog).

---

## 6. POST /{id}/delete with resolutions

```json
{"resolutions": {"records": "nullify", "visitors": "cascade", "client_tags": "cascade"}}
```

Server-side rules:
1. **Validate each action against the FK matrix (§4).** An action NOT in `allowed_actions` for that entity → **422** (e.g. `{"activities": "cascade"}` → 422 because activities is blocked; `{"records": "cascade"}` → 422 because records only allows nullify).
2. **Require resolutions for ALL non-auto deps.** Missing a non-auto dep → 422 ("resolution required for entity X").
3. **Auto deps resolved automatically** — server ignores any resolution the user sends for an auto dep. If **all** deps for an entity are auto (e.g. a Service with zero activities, only tariffs/photos/tags), the `resolutions` body is `{}` (empty) and the server executes the auto-cascade/nullify directly. (Frontend still showed the 409 preview for informed consent.)
4. **Blocked deps (activities, `allowed_actions: []`)** → 422 always. If activities exist, `POST /{id}/delete` is impossible — only archive. The 409 from `DELETE` already communicates this; a POST to the same entity returns 422 ("entity has blocking dependencies — archive instead").
5. **Execution order: nullify → cascade → hard delete**, all in **ONE transaction** (rollback on any failure). Nullify first (break FK links before deleting), then cascade (delete dependent rows), then the entity row itself.
6. Cascade follows the existing precedent (§8): dependency-ordered SQL in a `@transactional` method.

On success → **204**. On 422 → **422** with a `detail` explaining which resolution was invalid/missing. On 404 (entity not found) → **404**.

---

## 7. Frontend — deletion dialog (two modes)

Triggered when the user clicks "Удалить" on an entity row.

### 7.1 Mode A — No blocking deps (only resolvable + auto)

```
Удаление «услуги Маникюр»
Будет выполнено:
  → Тарифы: 3 (удалены)
  ○ Фото: 12 (отвязаны от услуги)
  → Теги: 5 (удалены)
[Введите название для подтверждения] [Удалить] [Отмена]
```

- `→` = will be deleted (cascade), `○` = will be unlinked (nullify).
- Auto deps shown (tariffs, tags, photos) but not asked — they execute automatically regardless of user input.
- Type-to-confirm enabled (matches existing Memo destructive-action pattern — the user types the entity name to unlock "Удалить"). Required whenever anything will be hard-deleted (cascade), even all-auto.
- On confirm → `POST /{id}/delete` with `resolutions` for the non-auto deps. If all deps are auto (the pictured Service has zero activities), the `resolutions` body is `{}`.

### 7.2 Mode B — Blocking deps (activities present)

```
Удаление «мастера Анна»
Нельзя удалить: есть 3 активности.
Сначала удалите активности вручную или архивируйте мастера.
[Архивировать] [Отмена]
```

- When `allowed_actions: []` appears for any dep (= activities present), the DELETE path is closed.
- Dialog shows the block message + the count.
- Primary action switches to **"[Архивировать]"** → `POST /{id}/archive`. Delete is not offered.
- "Отмена" closes with no action.

### 7.3 Fetch flow

1. User clicks "Удалить" → frontend calls `DELETE /{id}` to get the dry-run preview.
2. If 204 → delete already succeeded (no deps); close dialog, refresh list.
3. If 409 → parse `dependencies`. If any `allowed_actions: []` → Mode B. Else → Mode A.
4. Mode A confirm → `POST /{id}/delete` with resolutions.
5. On 204 → close, refresh. On 422 → show inline error (invalid/missing resolution — should not happen if UI built correctly; defensive).

---

## 8. Existing hardcoded-delete precedent (cascade reference)

These already exist (from #194) and are the **reference pattern** for the `POST /{id}/delete` cascade transaction. The Client → visitors cascade in #207 reuses `VisitorService.delete`'s internal ordering rather than reimplementing it.

- `RecordService.delete` — `services/record.py:74-95` (visits → payments → record_tags → record)
- `VisitorService.delete` — `services/visitor.py:37-59` (visits → photos SET NULL → visitor_tags → visitor)
- `ActivityService.delete` — `services/activity.py:126-162` (visits/payments → record_tags → records → photos SET NULL → activity_tags → activity)

All three run dependency-ordered SQL inside one `@transactional` method. `POST /{id}/delete` for Client delegates the visitors cascade to `VisitorService.delete` (or its shared core) so visits → payments cascade automatically. For Master/Location/Service there is no cascade (only block/nullify/auto-cascade-tags/tariffs) so the transaction is simpler.

---

## 9. Rename (mechanical, low-risk)

| Old | New | Scope |
|---|---|---|
| `SoftDeleteRepository` | `ArchiveRepository` | `repositories/generic.py` + all imports |
| `SoftDeleteService` | `ArchiveService` | `services/generic.py` + all 5 entity services + imports |
| `get_soft_delete_repository()` | `get_archive_repository()` | DI factory + usages |
| 5 entity services inherit `SoftDeleteService` | inherit `ArchiveService` | `services/{master,location,service,material,client}.py` |

No DB column rename, no Alembic migration — `is_active` stays in the DB. The rename is code-only.

---

## 10. Reconciliation with existing issues

| Issue | Status | Action |
|---|---|---|
| **#184 / #185** (GenericService/GenericAPI CRUD contract tests) | Updated | Contract tests currently fixate `delete = soft` → **UPDATE** to `delete = hard` + add `archive`/`restore` contract. `ServiceService` is in `GENERIC_CONTRACT_EXCEPTIONS` — its `delete` is covered per-entity (Service has FK deps activities=block, so delete is conditional). |
| **#178** (is_active in Update/Patch schemas) | **Auto-closed** | `is_active` removed from all PUT/PATCH schemas for the 5 entities. Archive/restore only via dedicated endpoints. |
| **#189** (tags drift) | **Absorbed** | Tags (`*_tags` join tables) also get hard delete via the auto-cascade in the resolution transaction. |
| **#195** (include_inactive + archive filters) | Compatible | Independent. `?status=` filter unchanged. No conflict. |
| **#198** (restore buttons — Client lacks) | **Complemented** | Archive/restore now first-class via `POST /archive` + `POST /restore`. Client gets restore button parity with the other 4 entities. |
| **#205** (FILED 2026-08-08) | Unrelated | Out of scope. |

---

## 11. Context facts (from codebase research — frozen at G1a)

1. **Activity model has no `is_active`** — extends `AbstractModel`, not `AbstractModelSoftDelete` (per #194). Activities cannot be archived, only deleted. This is why `activities` is always a **block** in the FK matrix.
2. **Material has zero FK dependencies** — `DELETE /materials/{id}` always returns 204 (no deps to check). Simplest case.
3. **Prod SQLite runs WITHOUT `PRAGMA foreign_keys`** — DB-level `ondelete` never fires. Service-level resolution (the nullify→cascade→hard-delete transaction) is **mandatory** and is the primary mechanism. ORM/FK config is a backstop only.
4. **`ArchiveStatus` enum already exists** — `models/enums.py:47-52` (`ACTIVE`/`ARCHIVED`/`ALL`). Unchanged, reused.
5. **Frontend already uses "В архив"/"Восстановить" buttons** for 4 of 5 entities (Master, Location, Service, Material); Client lacks the restore button (= #198). This PR adds restore parity for Client and switches all 5 from `PATCH {is_active}` to `POST /archive` + `POST /restore`.
6. **Frontend currently sends `PATCH {is_active}` for archive toggle** — this changes to the two dedicated POST endpoints.

---

## 12. User Scenarios

Each scenario maps 1:1 to an E2E test (Playwright, `frontend/admin/e2e/`).

### S1 — Delete Material (no deps) → instant hard delete
**User:** opens Materials table, clicks "Удалить" on a material with no dependencies.
**Expected:** `DELETE /materials/{id}` returns 204 immediately (Material has zero FK deps). Row vanishes from the table. A subsequent GET → 404. No dialog (or dialog closes instantly). DB row physically gone.
**E2E:** `e2e/materials-delete.spec.ts` — create material, delete, assert row absent + API 404.

### S2 — Delete Master with NO activities → resolves user (nullify) + tags (auto cascade)
**User:** opens Masters table, clicks "Удалить" on a master that has a linked `users` row and some `master_tags`, but **no activities**.
**Expected:** `DELETE /masters/{id}` returns 409 with deps: `users` (count 1, `["nullify"]`), `master_tags` (count N, `["cascade"]`, auto). Dialog Mode A shows: "○ Пользователь: 1 (отвязан)" + "→ Теги: N (удалены)". User types the master name, clicks "Удалить" → `POST /masters/{id}/delete` with `{"resolutions": {"users": "nullify"}}` (tags auto). 204 → master gone, user survives (master_id nulled), tags rows gone.
**E2E:** `e2e/masters-delete-nullify.spec.ts` — seed master+user+tags (no activities), open dialog, assert preview, type-confirm, assert API 204 + user master_id=null + master row gone.

### S3 — Delete Master WITH activities → blocked, archive instead (Mode B)
**User:** opens Masters table, clicks "Удалить" on a master that has 3 activities.
**Expected:** `DELETE /masters/{id}` returns 409 with `activities` (count 3, `allowed_actions: []`, message). Dialog Mode B shows: "Нельзя удалить: есть 3 активности." Primary button = "[Архивировать]". "Удалить" not offered. User clicks "Архивировать" → `POST /masters/{id}/archive` → 204, master `archived: true` in response, row stays in list (or moves to archived view per #195). "Восстановить" becomes available.
**E2E:** `e2e/masters-delete-blocked.spec.ts` — seed master+3 activities, click delete, assert Mode B dialog, click archive, assert `archived: true`, assert restore button appears, click restore, assert `archived: false`.

### S4 — Delete Client → resolves records (nullify) + visitors (cascade with downstream) + tags (auto)
**User:** opens Clients table, clicks "Удалить" on a client with 47 records, 12 visitors (across 45 visits, 30 payments totaling 15000), and 5 client_tags, but no activities (records is the booking, not the activity).
**Expected:** `DELETE /clients/{id}` returns 409 with `records` (47, `["nullify"]`), `visitors` (12, `["cascade"]`, `cascade_preview: {visits: 45, payments: {count: 30, total: 15000}}`), `client_tags` (5, `["cascade"]`, auto). Dialog Mode A shows all three + the cascade preview totals. User types client name, clicks "Удалить" → `POST /clients/{id}/delete` with `{"resolutions": {"records": "nullify", "visitors": "cascade"}}` (tags auto). 204 in one transaction. Verify: records survive with `client_id=null`; visitors+visits+payments+client_tags all gone; client row gone.
**E2E:** `e2e/clients-delete-cascade.spec.ts` — seed client+records+visitors+visits+payments+tags, open dialog, assert cascade_preview numbers, type-confirm, assert 204 + records.client_id=null + visitors/visits/payments absent + client gone.

### S5 — Archive and restore (all 5 entities, + #198 Client parity)
**User:** for each of Master, Location, Service, Material, Client: clicks "В архив" → entity leaves the active list, "Восстановить" appears; clicks "Восстановить" → entity returns.
**Expected:** `POST /{id}/archive` → 204, response `archived: true`; `POST /{id}/restore` → 204, response `archived: false`. `?status=archived` lists archived rows; `?status=active` hides them. Client now has restore parity (closes #198).
**E2E:** `e2e/archive-restore-parity.spec.ts` — per entity: archive, assert absent from active list + present in archived list; restore, assert back in active list. Covers all 5 incl. Client.

### S6 — PUT/PATCH rejects is_active (#178 auto-close)
**User:** sends `PUT /masters/{id}` with `is_active: true` in the body (old behavior that #178 was about).
**Expected:** **422** — `is_active` is no longer an accepted field on Update/Patch schemas. Archive/restore is only via the dedicated endpoints. Same for all 5 entities.
**E2E:** `e2e/update-rejects-is-active.spec.ts` — per entity, PUT with is_active → 422; archive endpoint works instead.

### S7 — Invalid/missing resolution → 422
**User:** calls `POST /clients/{id}/delete` with `{"resolutions": {"records": "cascade"}}` (records only allows nullify) OR missing `visitors` entirely.
**Expected:** **422** with `detail` naming the bad/missing resolution. No rows modified. Clienting the correct resolutions (`{"records": "nullify", "visitors": "cascade"}`) then succeeds with 204.
**E2E:** `e2e/clients-delete-invalid-resolution.spec.ts` — assert 422 for wrong action; assert 422 for missing dep; assert 204 with correct resolutions.

---

## 13. Visual Compliance Checks

- [ ] Materials table: "Удалить" on a material succeeds instantly (S1) — no broken dialog state.
- [ ] Master delete dialog Mode A (S2): shows "○ Пользователь: 1 (отвязан)" + "→ Теги: N (удалены)", type-to-confirm field, "Удалить" disabled until name typed.
- [ ] Master delete dialog Mode B (S3): shows "Нельзя удалить: есть 3 активности.", primary button is "[Архивировать]", "Удалить" not shown.
- [ ] Client delete dialog (S4): shows records nullify + visitors cascade with preview totals (visits 45, payments 30 / 15000) + tags cascade.
- [ ] "В архив" / "Восстановить" buttons present and working for all 5 entities including Client (S5).
- [ ] Archived entity leaves active table view; restored entity returns.
- [ ] DELETE/POST-delete dialogs render correctly on mobile (Memo is mobile-first overlay per colourmountains-design skill).

---

## 14. Acceptance Criteria

- [ ] `DELETE /{id}` on all 5 entities: no deps → 204 hard delete; deps → 409 + dependency tree; row physically gone on 204.
- [ ] `POST /{id}/delete` validates resolutions against FK matrix (§4); unallowed → 422; missing non-auto → 422; auto deps resolved automatically; execution nullify→cascade→hard-delete in ONE transaction; 204 on success.
- [ ] `POST /{id}/archive` + `POST /{id}/restore` exist for all 5 entities; archive sets `is_active=False`, restore sets `is_active=True`; response exposes `archived: bool` (inverted).
- [ ] `activities` always blocks (`allowed_actions: []`); DELETE/POST-delete impossible while activities exist; 409/422 communicates "archive instead".
- [ ] Material always deletes (zero deps) — `DELETE /materials/{id}` → 204 unconditionally.
- [ ] Response schemas (backend Pydantic + api-client Zod) for all 5 entities: `is_active` → `archived` (inverted); `is_active` removed from all Update/Patch request schemas; PUT/PATCH with `is_active` → 422 (#178 auto-closed).
- [ ] Rename: `SoftDeleteRepository` → `ArchiveRepository`, `SoftDeleteService` → `ArchiveService`, `get_soft_delete_repository` → `get_archive_repository`; 5 entity services inherit `ArchiveService`; `ArchiveRepository.delete` inherited hard from `BaseRepository` (no override).
- [ ] `?status=active|archived|all` filter unchanged (`ArchiveStatus` enum reused); archived rows hidden from default active list.
- [ ] Client → visitors cascade follows `VisitorService.delete` precedent (visits → payments → visitor_tags → visitor); Client → records nullify (records survive, `client_id=null`).
- [ ] 409 response contains counters + sums only (`cascade_preview` for Client visitors cascade: visits count, payments count + total); no individual row data.
- [ ] Frontend: delete dialog Mode A (resolvable, type-to-confirm) + Mode B (blocked → archive); "В архив"/"Восстановить" for all 5 incl. Client (#198 closed); `PATCH {is_active}` replaced by `POST /archive` + `POST /restore`.
- [ ] #184/#185 GenericService contract tests updated: delete = hard, archive/restore contract added; `ServiceService` per-entity delete (conditional on activities) covered.
- [ ] Backend test suite green; api-client tests green; admin vitest + e2e green (incl. the 7 scenarios S1–S7).
- [ ] Domain rules updated: `_overview.md` deletion policy table (soft-delete entities now hard-delete with resolutions + archive endpoints), is_active-semantics section rewritten for archive terminology boundary, per-entity files for the 5 updated.

---

## 15. Out of Scope

- The 6 hard-delete entities from #194 (Tag, Photo, Visitor, Activity, Record, UserSettings) — untouched, they already have real hard delete.
- Payment, Visit — already hard-delete, untouched.
- User, Tariff — stay implicit soft-delete (out of scope, per #194).
- `?status=` filter for the 6 hard-delete entities — they have no `is_active`, no filter.
- Any DB migration / Alembic — `is_active` column stays; rename is code-only.
- Population of the `cascade_preview` for non-Client cascades — no other entity has a user-choice cascade (only Client → visitors). Master/Location/Service cascades are all auto (tags/tariffs) and have no meaningful downstream preview.
- Refactor of the frontend list/archive-view UX beyond the delete dialog + archive/restore buttons (#195 handles the archived view; this PR just wires the endpoints + buttons).

---

## 16. Risks & Notes

- **FK integrity:** prod SQLite runs without `PRAGMA foreign_keys`; the service-level nullify→cascade→hard-delete transaction (§6) is the **primary** mechanism. Never rely on DB-level FK. The transaction must explicitly nullify FKs and delete dependents before the entity row.
- **Atomicity:** the resolution transaction (§6) must be one `@transactional` method — do NOT call per-dependent `@transactional` methods in a loop (each commits mid-loop). Perform all deletes/nullifies within the outer transaction, per the ActivityService.delete precedent (§8).
- **#178 break is deliberate:** `PUT {is_active}` previously worked for the 4 #178 entities + Client #201; it now 422s. This is the intended auto-close. Frontend must switch to `POST /archive` + `POST /restore` in the same PR (no transitional shim).
- **`archived` inversion:** `archived = true` means IN archive (= `is_active = false`). This is the opposite polarity of `is_active`. Every mapper must apply `not is_active`. Frontend Zod inversion must match backend Pydantic inversion exactly — a parity test is required.
- **DELETE of an already-archived entity:** archive does not delete. `DELETE /{id}` on an archived row still checks deps (activities) and hard-deletes if resolvable. Archive is a reversible state, not a delete.
- **Auto-dep resolution sent by user:** if the user includes an auto dep (e.g. `master_tags`) in `resolutions`, the server **ignores** it (auto-cascade/nullify runs regardless, no error). Sending a disallowed action for an auto dep (e.g. `{"master_tags": "nullify"}` when tags is auto-cascade) is likewise ignored — auto wins. (Plan may tighten to "reject mismatched auto-action" if cleaner — deferred decision.)