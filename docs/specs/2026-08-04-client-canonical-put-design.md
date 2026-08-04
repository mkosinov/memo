# Design: GH #201 — Client: canonical PUT/PATCH (required-nullable fields, is_active, ClientUpdateSchema)

- **Issue:** GH #201
- **Type:** Cross-layer contract fix (backend Pydantic schema, api-client zod schema + endpoint typing, frontend admin payload typing + '' → null conversion, test semantics flip, unskip of all `#201`-referenced skips)
- **Date:** 2026-08-04
- **Concept:** approved at G1a 2026-08-04 (do not re-brainstorm)
- **Refs:** #178 / PR #202 (canonical PUT/PATCH for Master/Service/Location/Material — removed the `SoftDeleteService.update` stored-value injection and left the ACCEPTED Client regression window this issue closes), #184 / PR #199 (sticky `is_active`, PATCH half stays intact), #185 / PR #200 (generic HTTP CRUD contract)
- **Domain references:** `docs/domain-rules/_overview.md` ("is_active semantics on get/update/patch" — Client exception removed) + `docs/domain-rules/clients.md` — **these rules change with this feature; markdown updates land in the feature branch** (§3.5)

---

## 1. Problem

#178 made PUT a canonical full-replace for 4 soft-delete entities but explicitly excluded Client, leaving an **accepted regression window**: `ClientUpdate.is_active` is still `bool | None = None` while the sticky-preserve injection in `SoftDeleteService.update` is gone — so a Client PUT omitting `is_active` writes NULL to the NOT NULL column → IntegrityError → **500**. The admin Client edit flow (`ClientCardModal` → `ClientsContext` → `updateClient`) sends exactly such a payload (`{name, phone, email, channel}` only), so **client editing is broken in the window** (e2e `clients.spec.ts` test 6 skipped, commit 2d42fb8).

Beyond closing the window, Client PUT semantics are non-canonical in their own right:

1. **Backend** (`backend/src/schemas/client.py:25-32`): `ClientUpdate` inherits `ClientBase` where all 4 editable fields default to `None`. A partial PUT body is silently accepted and the omitted fields are written as NULL (repository full-`model_dump()` write, `repositories/generic.py:61-72`) — i.e. `PUT {}` wipes every personal field. No distinction between "field omitted" and "field deliberately cleared".
2. **api-client** (`packages/api-client/src/endpoints.ts:296-301`): `updateClient(id, data: ClientCreate)` — typed with the **Create** schema (all fields optional, no `is_active`). A type bug: the update path cannot express `is_active` and gives no completeness guarantee. No `ClientUpdateSchema` exists.
3. **Frontend admin** (`ClientInfoTab.tsx:58-61`): PUT payload is `{name, phone, email, channel}` with channel «Не указан» represented as `''` — not a valid `Channel` enum value (would 422 under a strict update schema), and no `is_active` is sent.

**Data-wipe semantics (recorded in #178/#201 discussions):** deliberate erasure of personal data = PUT with explicit `null` in the 4 fields (never `'xxxxx'` strings — null renders as "не указан" in UI and doesn't match phone search). Stats (`records_count`, `total_paid`, …) are computed by `client_id` joins — wiping personal fields leaves payments/stats **intact**.

## 2. Target contract (behavior AFTER this change)

| Layer | Before | After |
|---|---|---|
| Backend `ClientUpdate` (`schemas/client.py:25-32`) | inherits `ClientBase`: all 4 fields optional (`= None`) + `is_active: bool \| None = None` | **Standalone 5-field required schema:** `name: str \| None`, `phone: str \| None`, `email: str \| None`, `channel: Channel \| None` (required-nullable, **no defaults** — key must be present; explicit `null` = deliberate clear) + `is_active: bool` (required). Omitted key → **422** |
| Backend `ClientPatch` / `ClientCreate` | all optional; sticky `is_active` on PATCH | **unchanged** — PATCH sticky contract from #184 intact; Create stays all-optional (booking auto-create flow, §3.1 note) |
| Backend service layer | `ClientService` = bare `SoftDeleteService` subclass (`services/client.py:28-29`, no overrides) | **unchanged** — injection branch already removed in #178; required schema yields 422 before the service. No DB migration (columns already nullable, `channel String(50)`, no DB enum) |
| api-client | no `ClientUpdateSchema`; `updateClient(id, data: ClientCreate)` (type bug) | **NEW `ClientUpdateSchema`**: `name/phone/email: z.string().nullable()`, `channel: z.enum(['telegram','whatsapp','max']).nullable()`, `is_active: z.boolean()` — **all keys required**. `updateClient(id, data: ClientUpdate)` |
| api-client `ClientCreateSchema`, `patchClient` | free-string channel, all-optional create; PATCH via inline `Partial<Pick<ClientResponse,…>>` | **unchanged** (patchClient is dead code — zero production callers, verified; first real caller arrives with #198 archive buttons) |
| Frontend admin PUT payload (`ClientInfoTab.tsx:58-61`) | `{name, phone, email, channel}` untyped (`Partial<ClientWithStats>`), channel `''` for «Не указан», no `is_active` | Payload explicitly typed **`ClientUpdate`**: all 4 fields + `is_active: client.is_active`; empty strings convert `'' → null` for name/phone/email/channel; unknown/legacy channel values normalize to null (§3.3) |
| `ClientsContext.tsx` update path (:61, :115-118, :138-143) | `updateClient(id, data: ClientCreateData)` (local type, `name` required string) | `updateClient(id, data: ClientUpdate)` — api-client type; `ClientCreateData` stays for the create path only. `ClientCardModal.tsx:193` `(data: any)` → `(data: ClientUpdate)` |

**Uniformity note:** with this change, **all 5 soft-delete entities share the canonical PUT contract** — full representation + required `is_active` (omission → 422). The `_overview.md` Client exception is removed.

**Legacy channel values (decision, §5):** the DB `channel` column is `String(50)` with no DB enum; values from before the enum was tightened (`'instagram'`, `'vk'`, `'website'`) may exist in real DBs and are returned raw by GET (pinned by `TestClientChannelTolerance`, `test_api_clients.py:359-390` — read tolerance **stays**). Under the strict update schema such a value in a PUT payload → 422, which would make editing any field of a legacy client impossible. **Chosen:** the admin UI normalizes unknown channel → null on edit (documented one-way wash-out on next save). Rejected: backend accepts free string (weakens the write contract, makes the enum pointless); render legacy value as extra select option (preserves invalid data indefinitely, UI complexity). Verified: seeds/conftest contain only valid enum values — wash-out touches only genuine legacy rows.

## 3. Design

### 3.1 Backend (`backend/src/schemas/client.py`, tests)

1. `ClientUpdate` becomes a standalone schema (no longer inherits `ClientBase` defaults):
   ```python
   class ClientUpdate(BaseModel):
       """Full-replace PUT schema: all keys required; explicit null = deliberate clear."""

       name: str | None
       phone: str | None
       email: str | None
       channel: Channel | None
       is_active: bool
   ```
   (Exact construct — standalone vs field redeclaration — decided at plan; target shape is fixed: 5 required keys, zero defaults.) The interim `#201` wart comment at :26-31 is removed.
2. `ClientBase` / `ClientCreate` (:10-22): **no change**. Note (verified): the booking auto-create flow (`services/record.py:169-187`) creates Clients with `phone` + `name` + `channel="whatsapp"` via the ORM directly, not via `ClientCreate` validation — unaffected either way.
3. `ClientPatch` (:35-42): **no change** (all optional, sticky `is_active`; `null` → preserve on PATCH is the deliberate RFC-7386 deviation documented in `_overview.md`).
4. Service layer: **no change** — verified `ClientService` is a bare `SoftDeleteService` subclass with no `update`/`patch` overrides (`services/client.py:28-29`). With `is_active: bool` required, Pydantic rejects incomplete PUTs with 422 before the service runs — the 500 window closes. Explicit `null` in the 4 personal fields flows through the repository full-`model_dump()` write and lands as NULL (verified `repositories/generic.py:61-72`).
5. No DB migration. `Channel` enum (`models/enums.py:41-44`): **NOT extended** (vk/sms/instagram explicitly rejected by user — 3 values only).

### 3.2 api-client (`packages/api-client/src/schemas.ts`, `endpoints.ts`)

1. NEW near `ClientCreateSchema` (:269-276):
   ```ts
   export const ClientUpdateSchema = z.object({
     name: z.string().nullable(),
     phone: z.string().nullable(),
     email: z.string().nullable(),
     channel: z.enum(['telegram', 'whatsapp', 'max']).nullable(),
     is_active: z.boolean(),
   });
   export type ClientUpdate = z.infer<typeof ClientUpdateSchema>;
   ```
   All keys required (zod object default). **Intentional asymmetry with Create** (free-string optional channel): the create path stays lenient (booking auto-create, external flows); the update path is the strict canonical contract. Response schemas (`ClientResponseSchema.channel: z.string().nullable()`) unchanged — GET tolerance for legacy values preserved.
2. `endpoints.ts:296-301` — `updateClient(id: string, data: ClientUpdate)` (fixes the `ClientCreate` type bug); import `ClientUpdateSchema`/type. Request bodies are TS-typed only (no runtime zod parse of requests — `api()` validates responses); the enum gives compile-time safety at the single production call site.
3. `ClientCreateSchema`, `patchClient` (:303-311): **no change**.

### 3.3 Frontend admin

1. `ClientInfoTab.tsx` (`app/(main)/clients/components/`):
   - Channel state init (:28): `client?.channel || ''` → normalize: values outside `{telegram, whatsapp, max}` become `''` (select then honestly shows «Не указан» for legacy rows instead of a blank uncontrolled-looking select).
   - `onSave` prop type (:16): `Partial<ClientWithStats>` → `ClientUpdate`.
   - `handleSave` (:58-61): build an explicitly typed `ClientUpdate` literal — `{ name: name || null, phone: phone || null, email: email || null, channel: channel === '' ? null : channel, is_active: client.is_active }` (every field listed; compile-time completeness guarantee).
2. `ClientsContext.tsx`: update path retyped to imported `ClientUpdate` (:61 interface, :115-118 mutation, :138-143 callback). `ClientCreateData` stays for create only. `patchClient` (:120-124, :145-150) untouched (dead code, #198 will give it its first caller).
3. `ClientCardModal.tsx:193`: `async (data: any)` → `async (data: ClientUpdate)`.
4. **No diff helper** — client edit stays PUT full-payload (user decision).
5. **No visual delta.** Behavioral delta (both documented, both accepted): (a) empty string fields now persist as `null` instead of `''` — display unchanged («Не указан»/«Дорогой гость» fallbacks already handle null); (b) legacy channel values wash out to null on next edit-save (§2).

### 3.4 Tests (close the window — unskip/flip everything `#201`-referenced)

Verified inventory of `#201` references: `test_generic_service_contract.py:827,828,871,873,882` (comments + runtime skip), `test_api_clients.py:221` (docstring), `test_generic_api_contract.py:55` (comment), `e2e/clients.spec.ts:172` (skip). Baseline (post-#178): backend 999p/6s; api-client 150p/4f (4 = known #188); admin 1239p/0f, tsc clean.

**Backend:**

| File:lines | Change |
|---|---|
| `tests/services/test_generic_service_contract.py` `TestGenericServiceIsActiveContract.test_update_without_is_active_raises_validation_error` (:862-889) | The Client skip is **data-driven and self-lifting** (`if not field.is_required(): pytest.skip("GH #201…")`) — it lifts automatically once `ClientUpdate.is_active` is required. Remove the now-dead guard + stale `#201` comments (:826-829, :871-873, :882); **verify the Client param runs green** (skip count drops 6 → 5) |
| same file, `TestGenericServiceUpdateContract.test_update_omitted_optional_field_reverts_to_default` | **Research discovery (concept gap):** this test runs for Client with `nullable_field="name"` and expects omission → default reversion. Post-#201 `ClientUpdate` has **zero defaulted fields** — omitting `name` raises `ValidationError`. Flip the Client expectation **data-driven** (`update_schema.model_fields[field].is_required()` → expect ValidationError, same pattern as the #178 `is_active` flip) — this pins "missing single field → error" at service level (scenario 4 sibling). Alternative considered: drop the Client param — rejected (loses the pin). Other params (defaulted-field reversion for the 4 #178 entities) unchanged |
| `tests/test_api_clients.py` `test_put_minimal_body_sets_others_to_null` (:219-228) | **Replaced** by explicit 422 cases (HTTP canaries for scenarios 2+4): `PUT {}` → 422; `PUT {is_active only}` → 422 (missing personal fields); `PUT` full-minus-`is_active` → 422. The old semantics (partial body wipes omitted fields) is exactly what this feature removes |
| `tests/test_api_clients.py` `test_put_sets_all_nullable_to_null` (:190-206) | **Stays 200, promoted from edge case to canonical pin** (scenario 3): full body with explicit `null` in all 4 fields + `is_active` → fields become NULL, stats/relations intact. Docstring updated accordingly |
| `tests/test_api_clients.py` `test_put_invalid_channel_returns_422` (:209), `TestClientChannelTolerance` (:359-390), PATCH cases (:173-181) | **unchanged, stay green** — enum still rejects invalid channel on write; GET read tolerance for legacy values preserved; PATCH contract untouched |
| `tests/test_generic_api_contract.py:50-58` | comment cleanup only (window note stale — payload injection helper itself is data-driven and keeps working) |
| `tests/test_put_is_active.py` | **unchanged, verify green** (parametrizes Master/Location/Material/Service only). Adding a Client param considered — rejected as redundant (Client explicit-`is_active` PUT is already pinned by the generic API + service contracts) |

**api-client** (suite 150p/4f — 4 known #188 failures):

| File | Change |
|---|---|
| `schemas.test.ts` | **ADD `ClientUpdateSchema` group**: full-payload accept (values + nulls); reject missing `is_active`; reject missing each personal field; accept all-null clear + `is_active`; reject invalid channel string |
| `endpoints.test.ts` | **ADD `updateClient` tests** (gap — none exist today): PUT method + URL + full typed body round-trip. `patchClient` tests (:310-336) unchanged |

**Frontend admin** (vitest 1239p/0f):

| File:lines | Change |
|---|---|
| `__tests__/ClientInfoTab.test.tsx` :138-153, :294-314 | expected `onSave` payloads → full `ClientUpdate` shape: `is_active` added; `'' → null` conversions applied (e.g. `email: ''` → `email: null`) |
| `__tests__/ClientCardModal.test.tsx` :291-297 | `updateClient` assertion `('c1', { name: 'updated' })` → new full shape (all 5 keys) |
| `__tests__/ClientsIntegration.test.tsx` :307-323 | same payload-shape update |
| `__tests__/ClientsContext.test.tsx` | no update-payload assertions today; adjust mocks only if the retyped context signature requires it |
| `e2e/clients.spec.ts:172` test 6 ("Edit client name and save") | **unskip** (remove the `test.skip(true, 'GH #201…')` marker) — edit-save flow restored; must pass in CI e2e shard |

`npm run test:all` + `tsc` must pass; backend suite green with **zero** `#201`-referenced skips remaining (grep-verified at finishing).

**Estimated delta:** backend ≈ +2-3 cases (new 422s), −1 skip (self-lifted) → ~1002p/5s; api-client ≈ +8 cases; admin vitest ±0 (in-place assertion updates); e2e −1 skip.

### 3.5 Domain rules (lands in the feature branch)

- `docs/domain-rules/_overview.md` :79 — PUT bullet: Client joins the canonical list (all 5 soft entities: full representation + required `is_active`, omission → 422). **Delete the Client exception / #178→#201 window note.**
- `docs/domain-rules/clients.md`:
  - :78 "Archive semantics on write" — rewrite: window note replaced by the new canon — `ClientUpdate` = 4 required-nullable fields + required `is_active`; explicit `null` = deliberate clear (data-wipe semantics: personal fields erased, payments/stats by `client_id` joins intact); PATCH sticky unchanged.
  - "Business Logic → Frontend" — channel select normalizes unknown/legacy values to «Не указан»; save persists `''`/unknown as `null`; legacy channel wash-out on next edit-save documented.
  - Parity Notes table — update: update path now enforces the `Channel` enum (zod + Pydantic); create path stays lenient (intentional asymmetry, §3.2).
  - :33 Restore note — unchanged in substance (PATCH path), retarget the stale "window" cross-reference if needed.

## 4. User Scenarios

1. **Admin edits client in modal** → full typed PUT incl. `is_active` — archive state preserved type-safely; save succeeds (the currently broken flow, e2e test 6, restored).
2. **`PUT /clients/{id} {}`** → 422 — silent wipe of all personal fields is impossible.
3. **Client asks to delete personal data** → PUT with explicit `null` in the 4 fields → data wiped, payments/stats **intact** (joins by client id).
4. **PUT without `is_active`** → 422 — the #178→#201 regression window closes.
5. **PATCH single field** (e.g. phone only) → works as before (sticky `is_active` intact, #184 contract).

## 5. Recorded decisions

- **Enum NOT extended** (vk/sms/instagram) — current 3 values (`telegram`, `whatsapp`, `max`) only; extension later when actually needed (user's call).
- **Legacy channel values: UI normalizes unknown → null** (documented wash-out on next save). Alternatives rejected: backend accepts free string (weakens write contract); extra select option for legacy value (preserves invalid data, UI complexity). GET read tolerance (`TestClientChannelTolerance`) stays.
- **Data wipe semantics = explicit `null`** (never `'xxxxx'` strings).
- **No generic diff helper** — PUT full payload; PATCH arrives with #198 archive buttons.
- **`patchClient` dead code left alone** (verified zero production callers; first real caller = #198).
- **Repository read-modify-write patch kept** (justified: 404 + response + `updated_at`; YAGNI on bulk UPDATE).
- **`ClientCreate` untouched** — booking auto-create (`record.py:169-187`, phone+name+channel via ORM) unaffected; create path intentionally lenient.
- **Service layer untouched** — required schema yields 422 before the service; verified `ClientService` needs no override.
- **`test_update_omitted_optional_field_reverts_to_default` Client expectation flipped data-driven** (research discovery; pins required-nullable at service level) — dropping the Client param rejected.
- **422 for missing required field** is the FastAPI/Pydantic default — no custom error shape (consistent with #178).

## 6. Acceptance Criteria

- [ ] AC1: `ClientUpdate` = standalone 5-key required schema (`name`/`phone`/`email`/`channel` required-nullable, `is_active: bool` required, zero defaults); `ClientCreate`/`ClientPatch` byte-identical in behavior; no service-layer or DB changes.
- [ ] AC2: `ClientUpdateSchema` exists in api-client with the exact shape of §3.2; `updateClient(id, data: ClientUpdate)`; `ClientCreateSchema`/`patchClient` untouched.
- [ ] AC3: `ClientInfoTab` handleSave builds an explicitly typed `ClientUpdate` (all 5 keys; `'' → null`; unknown channel → null; `is_active: client.is_active`); `ClientsContext` update path + `ClientCardModal` onSave typed `ClientUpdate`; `tsc` clean.
- [ ] AC4: All `#201`-referenced skips/markers removed or self-lifted-and-cleaned (backend ×3 spots, e2e ×1); `grep -r "#201" backend/tests frontend/admin` returns only historical docstrings **updated to past tense** or nothing; e2e test 6 passes.
- [ ] AC5: Backend suite green incl.: `PUT {} → 422`, `PUT` minus `is_active` → 422, `PUT` minus one personal field → 422 (HTTP + service-level pins), explicit-null wipe → 200 with NULLed fields, invalid channel → 422, legacy-channel GET tolerance, PATCH sticky cases.
- [ ] AC6: api-client suite green (± known #188) with new `ClientUpdateSchema` + `updateClient` tests; admin vitest green with updated payload assertions; `npm run test:all` + `tsc` pass.
- [ ] AC7: Domain rules updated (`_overview.md` Client exception removed; `clients.md` new canon + legacy wash-out + parity table).
- [ ] AC8: CI 15/15 green incl. both e2e shards (test 6 unskipped).

## 7. Visual Compliance Checks

No visual delta intended (type-level + payload-shape change; channel-select normalization only affects legacy rows' display from blank → «Не указан»). Gate runs autonomously as the standing smoke process to catch payload-construction regressions in the edit flow:

- [ ] Admin "Клиенты" table renders with rows
- [ ] Client card modal opens on row click; "Сохранить" after editing name succeeds (PUT 200, updated name visible after reload — mirrors e2e test 6)
- [ ] Channel select shows «Не указан» for a client without channel; selecting a value and saving succeeds

## 8. Risks & notes

- **Suite-count arithmetic:** changes are mostly in-place flips/assertion edits + one replaced test + ~10 new cases (§3.4). Baseline counts re-verified at worktree step.
- **Self-lifting skip:** the service-contract Client skip lifts automatically the moment `ClientUpdate.is_active` becomes required — the plan must order "verify skip lifted" after the schema change and clean the dead guard + comments in the same task.
- **`test_update_omitted_optional_field_reverts_to_default`** Client flip is the one genuinely new test-design element not present in the approved concept (research discovery) — flagged for G1b attention.
- **Legacy-channel wash-out is one-way** — a legacy row saved once loses its channel value forever (to null). Accepted per §5; GET tolerance means untouched legacy rows keep displaying raw values.
- **Create/update asymmetry** (lenient Create vs strict Update) is intentional and documented in domain rules; tightening Create is out of scope.
- **External PUT consumers** (scripts, e2e helpers) sending partial/`is_active`-less Client payloads start getting 422 — in-repo set fully enumerated in §3.4 (e2e helpers use createTestClient → POST, unaffected); plan step greps once more before implementation.
- **Follow-up context (unchanged, out of scope):** #198 archive buttons will give `patchClient` its first caller; #188 known api-client failures (4) are pre-existing.
