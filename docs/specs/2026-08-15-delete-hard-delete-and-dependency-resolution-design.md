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
| `DELETE /{id}` (no body) | Dry-run hard delete. **Zero deps** → 204 (row deleted outright). **Any dep (auto or non-auto)** → 409 Conflict + dependency tree (no rows modified). See §5. |
| `DELETE /{id}` (with body `{"resolutions": {"entity": "nullify"\|"cascade"}}`) | Execute the hard delete with resolutions → 204. Invalid/missing resolution → 422. The same path + verb; **body presence distinguishes the two modes** (FastAPI accepts a Body on DELETE; the api-client is our own fetch — both support it). See §6. |
| `POST /{id}/archive` | Archive (sets `is_active=False`). **New endpoint**, all 5 entities. **Master archive additionally cascades to linked user** (`is_active=False`) — see §4.2. |
| `POST /{id}/restore` | Restore (sets `is_active=True`). **New endpoint**, all 5 entities. **Master restore additionally cascades to linked user** (`is_active=True`) — see §4.2. |
| `?status=active\|archived\|all` | Unchanged — `ArchiveStatus` enum stays (`models/enums.py:47-52`) |

> **Note (Change 1):** The earlier design had a separate `POST /{id}/delete` endpoint. The user approved unifying into a single `DELETE /{id}` endpoint where body absence = dry-run, body presence = execute. This removes one endpoint, keeps the verb semantics (DELETE = destructive), and maps cleanly to `fetch(..., {method:'DELETE', body})` on the frontend.

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

`is_active: bool` → `archived: bool` (**INVERSION: `archived = true` = in archive = `is_active = false`**). The DB column stays `is_active`; the API only ever exposes `archived = not is_active`. Mapper translation lives in the Service/response-builder layer.

**Two mapper paths for Client (not one):**
1. `ClientResponse` — the standard entity response (inverted in the service/mapper).
2. `ClientWithStats` (extends `ClientResponse`, built manually in `list_clients_with_stats` — service builds it and currently passes `is_active=row.is_active` directly). This manual mapper is a **second inversion point** that the ".response schemas" wording would miss and which will break the Pydantic model at compile time once `is_active` leaves the schema. The plan MUST invert it to `archived = not row.is_active` explicitly (it is not reached via the generic path).

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
- `delete()` = **hard** (delegates to `repo.delete` which is now hard — no `is_active` change). For entities with FK deps, `delete(id, resolutions)` runs the dependency resolution (see §6).
- All 5 entity services inherit from `ArchiveService` instead of `SoftDeleteService`.
- **Master-only cascade (Change 3):** `MasterService.archive()` and `restore()` have a **cross-entity cascade side-effect** — beyond patching the master's `is_active`, they ALSO write the linked user's `is_active` (look up `User` where `users.master_id == master.id`, set `is_active` to match the master's new state). Rationale: a Master is a staff profile, the linked User is its login account — archiving a master without disabling the account leaves an orphan login; restoring must reactivate the account too. This is the ONLY archive-cascade case in the matrix (see §4.2) — a special-case override on `MasterService`, NOT a generic `ArchiveService` behavior. See §4.2 for the rule + §12 S5 for the scenario.

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
| Master → **users** (master_id) | nullable | **cascade** (auto) | auto — `["cascade"]` (Change 2) | **Delete master → delete the linked user row automatically.** Rationale: User is the login account, Master is the profile; deleting the profile but keeping the account = orphan. Always cascade-delete the account (auto, like tags — no user choice). Frontend shows it in the preview but doesn't ask. |
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
- **(auto)** = join tables (`*_tags`), unambiguous relations (tariffs, photos-service), AND **Master→users** (the login account always goes with the master per Change 2). Resolved automatically, no user choice. Frontend **shows** them in the preview but does not ask.
- Aggregate cascade (Client → visitors) follows the existing dependency-ordered SQL precedent (see §8): visitor delete cascades to visits → payments → visitor_tags → visitor.

### 4.1 Auto cascade (delete) — Master → users

When `DELETE /masters/{id}` (or `DELETE` with resolutions body) runs on a Master with a linked `users` row, the linked `User` row is **hard-deleted automatically** as part of the same resolution transaction (auto-cascade, like `master_tags`). No user choice. The row is physically removed from `users`. This is the ONLY auto-cascade of a non-join-table in the matrix besides Service→tariffs.

### 4.2 Auto cascade (archive/restore) — Master → users (special case, Change 3)

Archive and restore are reversible lifecycle actions, NOT deletes — but for **Master only**, the archive/restore ACTION cascades to the linked User:

- `MasterService.archive(id)`: patch `master.is_active=False` AND patch `user.is_active=False` (where `user.master_id == master.id`) in ONE transaction. The user can no longer log in.
- `MasterService.restore(id)`: patch `master.is_active=True` AND patch `user.is_active=True` in ONE transaction. The user can log in again.
- Only Master does this. Location/Service/Material/Client archive/restore is a single-row `is_active` flip with no cross-entity write (the other 4 entities' related rows are either dependents that depend on it via cascade-block activities — there is no Master→users-style login-account link).

**Rationale:** a Master is a staff profile, the linked `User` is its login account. Archiving a profile without disabling the login = orphan/dead account that can still authenticate. Restoring must reactivate both. User is technically "implicit soft-delete, out of scope per #194" but we can still WRITE to the `users` table — this is a deliberate, scoped exception, do NOT generalize to other entities.

**Scope note:** This is an archive/restore cascade (sets `is_active`), not a delete cascade. The FK matrix in §4 governs DELETE; §4.2 governs archive/restore. The DELETE cascade for Master→users is §4.1 (hard-delete the user).

---

## 5. 409 Conflict response (dry-run preview — counters + sums)

Returned by `DELETE /{id}` when dependencies exist. No rows modified. Contains **counters and sums only** — no individual row data.

```json
{
  "detail": "has_dependencies",
  "dependencies": [
    {"entity": "activities", "count": 3, "allowed_actions": [], "message": "Remove activities first or archive"},
    {"entity": "visitors", "count": 12, "allowed_actions": ["cascade"],
     "cascade_preview": {"visits": 45}},
    {"entity": "records", "count": 47, "allowed_actions": ["nullify"]},
    {"entity": "client_tags", "count": 5, "allowed_actions": ["cascade"]}
  ]
}
```

Field semantics:
- **204 vs 409:** `DELETE` returns 204 only when the entity has **zero** dependencies of any kind (e.g. Material always; a Master with no users/activities/tags). Any dependency — auto or non-auto — produces a 409 so the user has **informed consent** about what will be deleted/nullified, even when no choice is involved.
- `allowed_actions: []` → **blocked** (the `activities` case). DELETE impossible via either endpoint — only archive.
- `allowed_actions: ["nullify"]` / `["cascade"]` → choice required from the user (non-auto dep).
- `allowed_actions: ["cascade"]` with no entry in the user's `resolutions` body on `DELETE /{id}` (with body — see §6) → 422 (resolution required for all non-auto deps).
- **Auto deps** (`master_tags`, `location_tags`, `service_tags`, `client_tags`, Service tariffs, Service photos, and **Master users per §4.1**) appear in the tree with `allowed_actions` matching the auto-action but are **never** part of the user's `resolutions` body — server resolves them automatically. **Master→users shows `"allowed_actions": ["cascade"]` (auto)** — no user choice.
- `cascade_preview` — downstream aggregates for cascade actions. For Client → visitors cascade: `visits` count (the rows physically deleted when visitors cascade to visits). **Payments are EXCLUDED** — `Payment` is record-scoped (`payments.record_id → records.id`), and Client→records is *nullify* (records survive), so their payments are NOT part of the visitors cascade and survive with the nullified records. Absent for nullify actions (nothing downstream is hard-deleted).
- `message` — human hint, free-form Russian string (shown in the frontend dialog).

---

## 6. DELETE /{id} with resolutions body (Change 1 — unified endpoint)

The same `DELETE /{id}` path, invoked **with a body**:

```json
{"resolutions": {"records": "nullify", "visitors": "cascade", "client_tags": "cascade"}}
```

Server-side rules:
1. **Validate each action against the FK matrix (§4).** An action NOT in `allowed_actions` for that entity → **422** (e.g. `{"activities": "cascade"}` → 422 because activities is blocked; `{"records": "cascade"}` → 422 because records only allows nullify).
2. **Require resolutions for ALL non-auto deps.** Missing a non-auto dep → 422 ("resolution required for entity X"). **Auto deps (incl. Master→users per §4.1) are NOT part of the user's resolutions body** — they're silently omitted/ignored if sent.
3. **Auto deps resolved automatically** — server ignores any resolution the user sends for an auto dep. If **all** deps for an entity are auto (e.g. a Master with users+tags but no activities), the `resolutions` body is `{}` (empty) and the server executes the auto-cascade directly. (Frontend still showed the 409 preview for informed consent.)
4. **Blocked deps (activities, `allowed_actions: []`)** → 422 always. If activities exist, `DELETE /{id}` with body is impossible — only archive. The 409 from the no-body `DELETE` already communicates this; sending a body to the same entity-with-activities returns 422 ("entity has blocking dependencies — archive instead").
5. **Execution order: nullify → cascade → hard delete**, all in **ONE transaction** (rollback on any failure). Nullify first (break FK links before deleting), then cascade (delete dependent rows — incl. Master→users hard delete per §4.1, and Client→visitors via `VisitorService._delete_cascade` per §8), then the entity row itself.
6. Cascade follows the existing precedent (§8): dependency-ordered SQL in a `@transactional` method.

On success → **204**. On 422 → **422** with a `detail` explaining which resolution was invalid/missing. On 404 (entity not found) → **404**. A DELETE with an **empty body** (or no body) is the dry-run per §5 — produces 204 or 409, never executes.

> **OpenAPI note:** FastAPI allows `Body(...)` parameters on DELETE routes without issue; the OpenAPI schema will document the body. Some HTTP clients/proxies discourage DELETE bodies, but our api-client is a direct `fetch` (supports `body` on any method) and there is no proxy in the path. The user explicitly approved this unified-DELETE design at G2 (Change 1).

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
- On confirm → `DELETE /{id}` with body `{resolutions: {...}}` for the non-auto deps. If all deps are auto (the pictured Service has zero activities), the `resolutions` body is `{}`. **Auto deps (incl. Master→users per §4.1) are omitted from the body** — they execute automatically.

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

1. User clicks "Удалить" → frontend calls `DELETE /{id}` (no body) to get the dry-run preview.
2. If 204 → delete already succeeded (no deps); close dialog, refresh list.
3. If 409 → parse `dependencies`. If any `allowed_actions: []` → Mode B. Else → Mode A.
4. Mode A confirm → `DELETE /{id}` **with body** `{resolutions: {...}}` (resolutions only for the non-auto deps; auto deps like Master→users and tags are omitted from the body — the server resolves them).
5. On 204 → close, refresh. On 422 → show inline error (invalid/missing resolution — should not happen if UI built correctly; defensive).

---

## 8. Existing hardcoded-delete precedent (cascade reference)

These already exist (from #194) and are the **reference pattern** for the `DELETE /{id}` (with body) cascade transaction. The Client → visitors cascade in #207 reuses `VisitorService.delete`'s internal ordering rather than reimplementing it.

- `RecordService.delete` — `services/record.py:74-95` (visits → payments → record_tags → record)
- `VisitorService.delete` — `services/visitor.py:37-59` (visits → photos SET NULL → visitor_tags → visitor)
- `ActivityService.delete` — `services/activity.py:126-162` (visits/payments → record_tags → records → photos SET NULL → activity_tags → activity)

All three run dependency-ordered SQL inside one `@transactional` method. `DELETE /{id}` (with body) for Master additionally hard-deletes the linked `users` row (auto-cascade per §4.1) — alongside the `master_tags`. For Master/Location/Service there is no user-choice cascade (only block/nullify/auto-cascade-tags/tariffs/users) so the transaction is simpler. `DELETE /{id}` for Client delegates the visitors cascade to `VisitorService.delete`'s internal ordering so visits cascade automatically. (The Client → visitors cascade IS a user-choice cascade.)

**Atomicity requirement (BLOCKER-class, must be explicit in the plan):** `VisitorService.delete` as written is a **per-visitor** `@transactional` method — calling it in a loop over N visitors is NOT atomic (each `@transactional` commits the session at `services/decorators.py`, so a mid-loop failure leaves the records-nullify and prior visitor deletes committed). The Client→visitors cascade MUST instead call a **non-decorated extracted core** (e.g. `VisitorService._delete_cascade(visitor, session)` operating on the passed session) within the single outer `ClientService.delete` `@transactional` transaction — i.e. extract the per-visitor delete body into a pure-function helper that takes the session, and have both `VisitorService.delete` (decorated, own session) and the Client cascade (decorated once, shared session) call it. The plan MUST schedule this extraction as an explicit step; the AC below asserts it.

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
3. **Prod SQLite currently runs WITHOUT `PRAGMA foreign_keys`** (`database.py` connect listener sets `busy_timeout`+`WAL` only) — DB-level `ondelete` never fires. **This PR closes that gap**: add `PRAGMA foreign_keys=ON` to the connect listener (~3 lines, no migration — the documented SQLite recipe; tests already run FK-on via `conftest.py`). The service-level nullify→cascade→hard-delete transaction (§6) remains the primary mechanism; FK ON adds a DB-level backstop that catches any non-service write path (raw SQL, migrations, backfills, `ON CONFLICT` paths).
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

### S2 — Delete Master with NO activities → auto cascade user (hard-delete) + auto cascade tags
**User:** opens Masters table, clicks "Удалить" on a master that has a linked `users` row and some `master_tags`, but **no activities**.
**Expected:** `DELETE /masters/{id}` (no body) returns 409 with deps: `users` (count 1, `["cascade"]`, **auto** per §4.1 — no user choice), `master_tags` (count N, `["cascade"]`, auto). Dialog Mode A shows: "→ Пользователь: 1 (удалён)" + "→ Теги: N (удалены)" — BOTH auto, no choice. Type-to-confirm enabled (a hard delete is happening). User types the master name, clicks "Удалить" → `DELETE /masters/{id}` **with body** `{"resolutions": {}}` (all deps auto — body is empty). 204 in one transaction → master gone, **linked user row hard-deleted** (cascade auto), tags rows gone.
**E2E:** `e2e/masters-delete-auto-cascade.spec.ts` — seed master+user+tags (no activities), open delete dialog, assert both deps shown as "→ ... (удалён)" with NO choice, type-confirm, assert API 204 + user row gone (DB query `users WHERE master_id = ...` → 0) + master gone.

### S3 — Delete Master WITH activities → blocked, archive instead (Mode B)
**User:** opens Masters table, clicks "Удалить" on a master that has 3 activities.
**Expected:** `DELETE /masters/{id}` (no body) returns 409 with `activities` (count 3, `allowed_actions: []`, message). Dialog Mode B shows: "Нельзя удалить: есть 3 активности." Primary button = "[Архивировать]". "Удалить" not offered. User clicks "Архивировать" → `POST /masters/{id}/archive` → **200** `archived: true` (HTTP 200 with body — so the frontend updates the row without a refetch); row stays in list (or moves to archived view per #195). **Master archive additionally sets the linked user `is_active=False`** (Cascade 3, §4.2). "Восстановить" becomes available.
**E2E:** `e2e/masters-delete-blocked.spec.ts` — seed master+3 activities, click delete, assert Mode B dialog, click archive, assert `archived: true`, assert restore button appears, click restore, assert `archived: false`.

### S4 — Delete Client → resolves records (nullify) + visitors (cascade with downstream) + tags (auto)
**User:** opens Clients table, clicks "Удалить" on a client with 47 records, 12 visitors (across 45 visits), and 5 client_tags, but no activities (records is the booking, not the activity).
**Expected:** `DELETE /clients/{id}` (no body) returns 409 with `records` (47, `["nullify"]`), `visitors` (12, `["cascade"]`, `cascade_preview: {visits: 45}`), `client_tags` (5, `["cascade"]`, auto). Dialog Mode A shows all three + the cascade preview visits total. User types client name, clicks "Удалить" → `DELETE /clients/{id}` **with body** `{"resolutions": {"records": "nullify", "visitors": "cascade"}}` (tags auto — omitted from body). 204 in one transaction. Verify: records survive with `client_id=null` (and their payments survive with them); visitors + visits + client_tags all gone; client row gone. Payments are record-scoped and are NOT deleted by the visitors cascade (records are nullified, not deleted) — assert payments rows still present, attached to the now-anonymous records.
**E2E:** `e2e/clients-delete-cascade.spec.ts` — seed client+records+visitors+visits+payments+tags, open dialog, assert cascade_preview visits count, type-confirm, assert 204 + records.client_id=null + payments still present (record-scoped, survive nullify) + visitors/visits/client_tags absent + client gone.

### S5 — Archive and restore (all 5 entities, + #198 Client parity + Master→user cascade)
**User:** for each of Master, Location, Service, Material, Client: clicks "В архив" → entity leaves the active list (response `archived: true`, HTTP 200); "Восстановить" appears; clicks "Восстановить" → entity returns (response `archived: false`).
**Expected:** `POST /{id}/archive` → **200 with body** `archived: true`; `POST /{id}/restore` → **200 with body** `archived: false`. `?status=archived` lists archived rows; `?status=active` hides them. Client now has restore parity (closes #198). **Master special case (Change 3, §4.2):** archiving a Master additionally sets the linked `users.is_active=False` (cannot log in); restoring a Master sets `users.is_active=True` (can log in). Verify with a DB query: after Master archive, `users WHERE master_id = master.id` has `is_active=False`; after restore, `is_active=True`. The other 4 entities do NOT cascade to any user.
**E2E:** `e2e/archive-restore-parity.spec.ts` — per entity: archive, assert 200 `archived: true` + absent from active list + present in archived list; restore, assert 200 `archived: false` + back in active list. Covers all 5 incl. Client. **Master case additionally** asserts the linked `users.is_active` flipped both ways (via DB query).

### S6 — PUT/PATCH rejects is_active (#178 auto-close)
**User:** sends `PUT /masters/{id}` with `is_active: true` in the body (old behavior that #178 was about).
**Expected:** **422** — `is_active` is no longer an accepted field on Update/Patch schemas. Archive/restore is only via the dedicated endpoints. Same for all 5 entities.
**E2E:** `e2e/update-rejects-is-active.spec.ts` — per entity, PUT with is_active → 422; archive endpoint works instead.

### S7 — Invalid/missing resolution → 422
**User:** calls `DELETE /clients/{id}` **with body** `{"resolutions": {"records": "cascade"}}` (records only allows nullify) OR missing `visitors` entirely.
**Expected:** **422** with `detail` naming the bad/missing resolution. No rows modified. Calling `DELETE /clients/{id}` with the correct body (`{"resolutions": {"records": "nullify", "visitors": "cascade"}}`) then succeeds with 204.
**E2E:** `e2e/clients-delete-invalid-resolution.spec.ts` — assert 422 for wrong action; assert 422 for missing dep; assert 204 with correct resolutions.

---

## 13. Visual Compliance Checks

- [ ] Materials table: "Удалить" on a material succeeds instantly (S1) — no broken dialog state.
- [ ] Master delete dialog Mode A (S2): shows "→ Пользователь: 1 (удалён)" + "→ Теги: N (удалены)" (both auto-cascade — **no choice**), type-to-confirm field, "Удалить" disabled until name typed.
- [ ] Master delete dialog Mode B (S3): shows "Нельзя удалить: есть 3 активности.", primary button is "[Архивировать]", "Удалить" not shown.
- [ ] Client delete dialog (S4): shows records nullify + visitors cascade with `cascade_preview` visits count + tags cascade.
- [ ] "В архив" / "Восстановить" buttons present and working for all 5 entities including Client (S5). **Master archive deactivates the linked user (cascade 3); Master restore reactivates the user.**
- [ ] Archived entity leaves active table view; restored entity returns.
- [ ] DELETE dialogs (Mode A/B) render correctly on mobile (Memo is mobile-first overlay per colourmountains-design skill).

---

## 14. Acceptance Criteria

- [ ] `DELETE /{id}` on all 5 entities: **no body + no deps** → 204 hard delete; **no body + deps** → 409 + dependency tree; **body with resolutions** → executes (204 on success, 422 on invalid/missing). Row physically gone on 204. (Change 1 — unified endpoint.)
- [ ] `DELETE /{id}` with body validates resolutions against FK matrix (§4); unallowed → 422; missing non-auto → 422; auto deps resolved automatically; execution nullify→cascade→hard-delete in ONE transaction; 204 on success.
- [ ] `POST /{id}/archive` + `POST /{id}/restore` exist for all 5 entities; archive sets `is_active=False`, restore sets `is_active=True`; **HTTP 200 with body** exposing `archived: bool` (inverted) so the frontend updates without a refetch.
- [ ] **Master→users delete cascade (§4.1, Change 2):** deleting a Master with a linked `users` row hard-deletes the user row automatically (auto-cascade, no user choice). Verify with a DB query: after Master delete, `users WHERE master_id = master.id` → 0 rows.
- [ ] **Master→users archive/restore cascade (§4.2, Change 3):** archiving a Master sets the linked `users.is_active=False`; restoring sets `users.is_active=True`. ONE transaction. Master-only special case — the other 4 entities do NOT cascade to any user. Verify with a DB query before/after.
- [ ] `activities` always blocks (`allowed_actions: []`); DELETE (no body or with body) impossible while activities exist; 409 (no body) / 422 (with body) communicates "archive instead".
- [ ] Material always deletes (zero deps) — `DELETE /materials/{id}` (no body) → 204 unconditionally.
- [ ] Response schemas (backend Pydantic + api-client Zod) for all 5 entities: `is_active` → `archived` (inverted); `is_active` removed from all Update/Patch request schemas; PUT/PATCH with `is_active` → 422 (#178 auto-closed).
- [ ] `ClientWithStats` manual mapper (second inversion point in `list_clients_with_stats`) inverted to `archived = not is_active` — not just the generic `ClientResponse` path.
- [ ] Dead code removed: `_strip_is_active_none` helper no longer has a caller (is_active gone from PATCH) → deleted; `is_active` entry in `GENERIC_COLUMNS_EXCLUDED` → removed. `test_put_is_active.py` / `test_patch_is_active.py` inverted — they currently assert `is_active` round-trips via PUT/PATCH for Master/Location/Material/Service (and Client via #201); now they assert PUT/PATCH with `is_active` → 422, and archive/restore assertions move to dedicated endpoint tests.
- [ ] Rename: `SoftDeleteRepository` → `ArchiveRepository`, `SoftDeleteService` → `ArchiveService`, `get_soft_delete_repository` → `get_archive_repository`; 5 entity services inherit `ArchiveService`; `ArchiveRepository.delete` inherited hard from `BaseRepository` (no override).
- [ ] `?status=active|archived|all` filter unchanged (`ArchiveStatus` enum reused); archived rows hidden from default active list.
- [ ] Client → visitors cascade follows `VisitorService.delete` precedent (visits → payments → visitor_tags → visitor) via an **extracted non-decorated shared core** run inside the single outer `ClientService.resolve_delete` transaction (NOT a per-visitor `@transactional` loop — see §8 atomicity requirement); Client → records nullify (records survive, `client_id=null`; their payments survive).
- [ ] 409 response contains counters + sums only (`cascade_preview` for Client visitors cascade: `visits` count only — payments excluded as record-scoped, see §5); no individual row data.
- [ ] Frontend: delete dialog Mode A (resolvable, type-to-confirm) + Mode B (blocked → archive); "В архив"/"Восстановить" for all 5 incl. Client (#198 closed); `PATCH {is_active}` replaced by `POST /archive` + `POST /restore`; delete confirm sends `DELETE /{id}` with body (not a separate POST endpoint).
- [ ] `PRAGMA foreign_keys=ON` added to the SQLite connect listener in `database.py` (~3 lines, no migration); prod connections enforce FK constraints as a backstop to the service-level transaction. Verify the existing test suite (which already runs FK-on via `conftest.py`) still green — proves the FK-ON world is correct. If any existing raw write path raises on FK-ON, it MUST be fixed in this PR (none expected given the entity set is unchanged).
- [ ] #184/#185 GenericService contract tests updated: delete = hard, archive/restore contract added; `ServiceService` per-entity delete (conditional on activities) covered.
- [ ] Backend test suite green; api-client tests green; admin vitest + e2e green (incl. the scenarios S1–S7).
- [ ] Domain rules updated: `_overview.md` deletion policy table (soft-delete entities now hard-delete with resolutions + archive endpoints), is_active-semantics section rewritten for archive terminology boundary, Master→users cascade rule (§4.1 + §4.2) documented, per-entity files for the 5 updated.

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

- **FK integrity:** prod SQLite connect listener now enables `PRAGMA foreign_keys=ON` (this PR, §11.3) — DB-level `ondelete` becomes a real backstop. The service-level nullify→cascade→hard-delete transaction (§6) remains the **primary** mechanism (it must still explicitly nullify FKs and delete dependents before the entity row). Never rely on DB-level FK alone, and never rely on app-level alone — both are present.
- **Atomicity:** the resolution transaction (§6) must be one `@transactional` method — do NOT call per-dependent `@transactional` methods in a loop (each commits mid-loop). Perform all deletes/nullifies within the outer transaction, per the ActivityService.delete precedent (§8).
- **#178 break is deliberate:** `PUT {is_active}` previously worked for the 4 #178 entities + Client #201; it now 422s. This is the intended auto-close. Frontend must switch to `POST /archive` + `POST /restore` in the same PR (no transitional shim).
- **`archived` inversion:** `archived = true` means IN archive (= `is_active = false`). This is the opposite polarity of `is_active`. Every mapper must apply `not is_active`. Frontend Zod inversion must match backend Pydantic inversion exactly — a parity test is required.
- Delete on a Master hard-deletes its linked User row automatically (§4.1, Change 2) — this is destructive and intentional (orphan login otherwise). The dialog must show "→ Пользователь: N (удалён)" so the user sees the account going.
- **Master archive/restore cross-entity write (§4.2, Change 3):** `MasterService.archive()`/`restore()` write to the `users` table (set linked `is_active`). This is the only archive-cascade of its kind — keep it as a Master-specific override on `MasterService`, not a generic `ArchiveService` behavior, to avoid drift. The write MUST be in the same transaction as the master's `is_active` patch (atomicity).
- **DELETE-with-body (Change 1):** FastAPI accepts a `Body` on DELETE; the api-client's fetch supports `body` on any method. Some HTTP tools (curl default, some proxies) discourage DELETE bodies — but there is no proxy in our path and the frontend uses fetch directly. The OpenAPI doc will render the body. If a future integration hits a tool that rejects DELETE-with-body, the fallback is to re-introduce `POST /{id}/delete` carrying the same body — but YAGNI now.
- **DELETE of an already-archived entity:** archive does not delete. `DELETE /{id}` (no body) on an archived row still checks deps (activities) and hard-deletes if resolvable (204); or 409 if deps exist. `DELETE` with body resolves + deletes per §6. Archive is a reversible state, not a delete.
- **Auto-dep resolution sent by user:** if the user includes an auto dep (e.g. `master_tags`) in `resolutions`, the server **ignores** it (auto-cascade/nullify runs regardless, no error). Sending a disallowed action for an auto dep (e.g. `{"master_tags": "nullify"}` when tags is auto-cascade) is likewise ignored — auto wins. (Plan may tighten to "reject mismatched auto-action" if cleaner — deferred decision.)