# Client Canonical PUT/PATCH Implementation Plan (GH #201)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Client PUT canonical: standalone 5-key required `ClientUpdate` (4 required-nullable personal fields + required `is_active`), `ClientUpdateSchema` in the api-client, typed admin edit payload with `'' → null` + save-time channel guard, all `#201` skips removed.

**Architecture:** Contract flip at the Pydantic schema (422 before the service — no service/DB changes), mirrored by a zod schema in the api-client (compile-time only, no runtime request parsing), one typed payload literal in the admin. Test-first: green-preserving test-data prep lands BEFORE the schema flip; the flip task carries its own RED tests.

**Tech Stack:** FastAPI + Pydantic v2 (backend), pnpm monorepo `@memo/api-client` (zod), Next.js admin (React + vitest), Playwright e2e.

**Spec:** `docs/specs/2026-08-04-client-canonical-put-design.md` (rev 2, G1b-approved with panel fixes) — the spec is normative; this plan is its executable form.

**Baseline (re-verify at worktree step):** backend 999p/6s; api-client 150p/4f (4 = known #188); admin vitest 1239p/0f, `tsc` clean; e2e `clients.spec.ts` test 6 skipped.

---

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria:

- **AC1 (backend schema)** → `PUT /clients/{id}` with a missing field now returns **422** instead of silently wiping omitted fields or 500ing. `POST` (create) and `PATCH` behave exactly as before.
- **AC2 (api-client)** → Type-safe `updateClient`: TypeScript refuses to compile an update payload missing any of the 5 keys. No runtime behavior change.
- **AC3 (admin edit form)** → Editing a client sends the full record including its current archive state — **client editing works again** (it is broken on main today). Empty name/phone/email now save as "not set" (null) instead of empty strings; display unchanged («Не указан»/«Дорогой гость»). A client with a legacy channel value (e.g. `instagram` from before the enum) saves with channel cleared instead of erroring — documented one-way wash-out.
- **AC4 (skips)** → All `#201` skip markers gone; the previously skipped e2e "Edit client name and save" test runs and passes in CI.
- **AC5/AC6 (suites)** → Backend, api-client, admin suites green with new pins: 422 canaries, explicit-null data-wipe (personal data erased, payments/stats provably intact), schema contract tests.
- **AC7 (domain rules)** → `clients.md`/`_overview.md` document the new canon incl. that PATCH is plain `application/json` (not merge-patch) and `null` means **clear on PUT, preserve on PATCH**.
- **AC8 (CI)** → 15/15 green incl. both e2e shards.

User-visible delta: **client editing in the admin works again**; everything else is contract/typing hardening invisible in normal use.

---

## Task 1: Backend test-data prep (green-preserving)

### Classification: small

### Required Docs
- `docs/specs/2026-08-04-client-canonical-put-design.md` §3.4 backend table (B1/m3/m4 rows)
- Skill `pytest-patterns` — fixtures/factory usage
- `backend/tests/conftest.py` — `create_record` factory (:315-344)

### Context
All changes in this task pass BOTH before and after the schema flip (Task 2) — the suite must stay at **999p/6s** after this task. This is the safety net that lets Task 2 flip the schema without collateral red.

### Files
- Modify: `backend/tests/generic_contract.py` (Client `EntityConfig`, :185-202)
- Modify: `backend/tests/services/test_generic_service_contract.py` (`test_update_omitted_optional_field_reverts_to_default`, :781-811)
- Modify: `backend/tests/test_api_clients.py` (:190-218)

### Steps

- [ ] **1.1 — Enrich Client contract config (B1 fix).** In `backend/tests/generic_contract.py:185-202`, change the Client entry's two data dicts:
  ```python
  create_data={"name": "Ivan", "phone": "+79000000000", "email": "ivan@example.com", "channel": "telegram"},
  ```
  and
  ```python
  update_data={"name": "Petr", "phone": "+79111111111", "email": "petr@example.com", "channel": "whatsapp"},
  ```
  Nothing else in the entry changes. Rationale (record in the commit message): post-#201 all 4 personal keys are required on PUT; the shared `_update_payload`/`_update_kwargs` helpers build bodies from `create_data`+`update_data` — without `email`/`channel` ≥5 Client-param contract tests would 422/ValidationError after the flip.

- [ ] **1.2 — Data-driven flip in `test_update_omitted_optional_field_reverts_to_default`** (`test_generic_service_contract.py:781-811`). After the line `payload.pop(cfg.nullable_field, None)  # explicit pop`, insert:
  ```python
          # GH #201: a required-nullable Update field (Client post-#201) makes
          # omission a ValidationError, not a default reversion — flip the
          # expectation data-driven, same pattern as the #178 is_active guard.
          if cfg.update_schema.model_fields[cfg.nullable_field].is_required():
              with pytest.raises(ValidationError):
                  cfg.update_schema(**payload)
              return
  ```
  (`ValidationError` is already imported in this file — used at :889.) Also update the test docstring: append `" Client post-#201: nullable_field is required → omission raises ValidationError (data-driven branch)."`. Pre-flip this branch is inert (`name` not required) — green both worlds.

- [ ] **1.3 — Fix the invalid-channel pin (m3).** In `test_api_clients.py:209-218`, add `is_active` to the payload so the test 422s on the channel, not on a missing `is_active`:
  ```python
        resp = api_client.put(f"/api/v1/clients/{client_id}", json={
            **CLIENT_PAYLOAD,
            "channel": "invalid_channel",
            "is_active": True,
        })
  ```

- [ ] **1.4 — Seed stats into the explicit-null wipe test (m4).** Rewrite `test_api_clients.py:190-207` (`test_put_sets_all_nullable_to_null`):
  ```python
    def test_put_sets_all_nullable_to_null(self, api_client, create_record) -> None:
        """PUT with explicit null in all 4 fields = deliberate data wipe (GH #201
        canonical pin): personal fields become NULL; payments/stats by client_id
        joins stay intact."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        record = create_record(client_id=client_id)
        api_client.post("/api/v1/payments", json={
            "record_id": record["id"], "amount": 1500, "method": "cash",
        })
        stats_before = _client_stats(api_client, client_id)

        resp = api_client.put(f"/api/v1/clients/{client_id}", json={
            "is_active": True,
            "name": None,
            "phone": None,
            "email": None,
            "channel": None,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] is None
        assert body["phone"] is None
        assert body["email"] is None
        assert body["channel"] is None
        # stats intact: records_count/total_paid unchanged after the wipe
        assert _client_stats(api_client, client_id) == stats_before
  ```
  with a local helper (module-level in `test_api_clients.py`, next to `CLIENT_PAYLOAD`):
  ```python
  def _client_stats(api_client, client_id: str) -> tuple:
      """(records_count, total_paid) for one client from the stats list endpoint."""
      items = api_client.get("/api/v1/clients").json()["items"]
      row = next(c for c in items if c["id"] == client_id)
      return row["records_count"], row["total_paid"]
  ```
  IMPLEMENTER NOTE: the stats list endpoint is `GET /api/v1/clients` (there is **no** `/with-stats` route — plan-review verified against `src/api/v1/clients.py:60-66`); copy the exact response-key/pagination idiom from `test_client_stats.py` if it differs from `"items"` above. Two details matter: (a) locate the row **by `client_id`**, never by `search=` — search is ILIKE on name/phone, both nulled by the wipe, so a search-based fetch would miss the row post-wipe (and could 404-identically → vacuous pass, silently restoring the m4 gap); (b) assert equality of the `(records_count, total_paid)` tuple before/after. The `create_record` factory (conftest :315-344) creates activity+client+record+visit; the `client_id` override re-targets it to our client. This test passes pre-flip too (explicit-null PUT is already legal today).

- [ ] **1.5 — Verify suite unchanged:** `cd backend && python -m pytest -q` → **999 passed, 6 skipped** (identical to baseline). Commit: `test: #201 prep — enrich Client contract data, data-driven omit flip, pin payloads (GH #201)`.

---

## Task 2: ClientUpdate standalone schema + backend test flip (RED→GREEN)

### Classification: standard

### Required Docs
- `docs/specs/2026-08-04-client-canonical-put-design.md` §3.1, §3.4
- `docs/domain-rules/clients.md` — entity field semantics
- Skill `pytest-patterns`

### Context
Task 1 made the shared helpers and pins flip-proof. This task writes the RED tests (schema-level + HTTP canaries), flips the schema (GREEN), then cleans the self-lifted skip and every `#201` marker in backend tests.

### Files
- Modify: `backend/src/schemas/client.py` (:25-32 — `ClientUpdate`)
- Modify: `backend/tests/test_schemas_client.py` (`TestClientUpdateNullableFields`, :76-90)
- Modify: `backend/tests/test_api_clients.py` (`test_put_minimal_body_sets_others_to_null`, :220-229 → 3 canaries)
- Modify: `backend/tests/services/test_generic_service_contract.py` (:814-837 block comment, :862-889 docstring + guard)
- Modify: `backend/tests/test_generic_api_contract.py` (:54-55 comment)

### Steps

- [ ] **2.1 — RED: rewrite `TestClientUpdateNullableFields`** (`test_schemas_client.py:76-90`):
  ```python
  class TestClientUpdateNullableFields:
      """ClientUpdate (GH #201): standalone 5-key required schema — 4
      required-nullable personal fields (explicit null = deliberate clear) +
      required is_active. Omitted key → ValidationError."""

      @pytest.mark.pure_unit
      def test_update_with_all_fields(self):
          """Full 5-key payload is valid."""
          cu = ClientUpdate(
              name="Updated", phone="+79990001111", email="u@example.com",
              channel=Channel.MAX, is_active=True,
          )
          assert cu.name == "Updated"
          assert cu.is_active is True

      @pytest.mark.pure_unit
      def test_update_with_all_nulls_valid(self):
          """Explicit null in all personal fields = deliberate wipe — valid."""
          cu = ClientUpdate(
              name=None, phone=None, email=None, channel=None, is_active=False,
          )
          assert cu.name is None
          assert cu.is_active is False

      @pytest.mark.pure_unit
      @pytest.mark.parametrize("missing", ["name", "phone", "email", "channel", "is_active"])
      def test_update_missing_required_field_raises(self, missing):
          """Omitting any of the 5 required keys → ValidationError."""
          payload = {
              "name": "X", "phone": "+79990001111", "email": None,
              "channel": None, "is_active": True,
          }
          payload.pop(missing)
          with pytest.raises(ValidationError):
              ClientUpdate(**payload)

      @pytest.mark.pure_unit
      def test_update_with_no_fields_raises(self):
          """Empty payload → ValidationError (no more silent full-wipe accept)."""
          with pytest.raises(ValidationError):
              ClientUpdate()
  ```
  Check imports at file top: `ValidationError` (pydantic) and `Channel` — add if absent. Run: `cd backend && python -m pytest tests/test_schemas_client.py -q` → the 3 new/rewritten raise-tests FAIL (old schema accepts omissions) = RED confirmed. NOTE: also grep this file for other `ClientUpdate(` usages (`grep -n "ClientUpdate(" tests/test_schemas_client.py`) — if any exist beyond :76-90, fix their payloads to the 5-key shape in the same step.

- [ ] **2.2 — RED: replace `test_put_minimal_body_sets_others_to_null`** (`test_api_clients.py:220-229`) with three 422 canaries:
  ```python
    def test_put_empty_body_returns_422(self, api_client) -> None:
        """PUT {} → 422 (GH #201): all 5 keys required — silent full-wipe is impossible."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        resp = api_client.put(f"/api/v1/clients/{client_id}", json={})
        assert resp.status_code == 422

    def test_put_is_active_only_returns_422(self, api_client) -> None:
        """PUT {is_active} only → 422: personal keys are required (required-nullable)."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        resp = api_client.put(f"/api/v1/clients/{client_id}", json={"is_active": True})
        assert resp.status_code == 422

    def test_put_missing_is_active_returns_422(self, api_client) -> None:
        """PUT full personal payload minus is_active → 422 (closes the #178→#201 500 window)."""
        create_resp = api_client.post("/api/v1/clients", json=CLIENT_PAYLOAD)
        client_id = create_resp.json()["id"]
        resp = api_client.put(f"/api/v1/clients/{client_id}", json=CLIENT_PAYLOAD)
        assert resp.status_code == 422
  ```
  Run: `python -m pytest tests/test_api_clients.py -q -k "empty_body or is_active_only or missing_is_active"` → all 3 FAIL (old schema returns 200/500) = RED confirmed.

- [ ] **2.3 — GREEN: flip the schema.** Replace `ClientUpdate` in `backend/src/schemas/client.py:25-32` (removing the interim `#201` wart comment):
  ```python
  class ClientUpdate(BaseModel):
      """Full-replace PUT schema (GH #201): all 5 keys required; explicit null =
      deliberate clear. Omitted key → 422. `ClientCreate`/`ClientPatch` unchanged."""

      name: str | None
      phone: str | None
      email: str | None
      channel: Channel | None
      is_active: bool
  ```
  `ClientBase`/`ClientCreate` (:10-22) and `ClientPatch` (:35-42) stay byte-identical. Run 2.1+2.2 tests → GREEN.

- [ ] **2.4 — Clean the self-lifted skip + `#201` markers.**
  a. `test_generic_service_contract.py:814-837` block comment: rewrite the `#201` forward-references to past tense ("Client required `is_active` optionally until GH #201; now all 5 soft entities share the required-`is_active` PUT contract"). Keep the rest.
  b. Same file, `test_update_without_is_active_raises_validation_error` (:862-889): update the docstring (drop "Entities whose Update schema still treats is_active as optional (Client — until GH #201)…" → "All 5 soft entities required post-#178+#201"); **delete the now-dead `is_required()` machinery wholesale (:876-884)** — the `field = cfg.update_schema.model_fields.get("is_active")` retrieval, the `assert field is not None` line, and the `if not field.is_required(): pytest.skip("GH #201…")` guard (`field` feeds only the guard — plan-review verified). The Client param now runs for real.
  c. `test_generic_api_contract.py:54-55`: delete the stale window comment ("Client included — omitting it now 500s until #201") — keep the `is_active` setdefault logic untouched.
  Run the two contract files: `python -m pytest tests/services/test_generic_service_contract.py tests/test_generic_api_contract.py -q` → green; skip count drops **6 → 5** (Client param of the is_active test no longer skips).

- [ ] **2.5 — Verify + grep gate:** `cd backend && python -m pytest -q` → ≈ **1007 passed, 5 skipped** (+8 net: schema class 2→8 pytest cases — the missing-field test is parametrized ×5 — plus canaries 1→3 = +2; re-verify actual count here). Then `grep -rn "GH #201\|#201" tests/ src/` → only past-tense historical references allowed; fix any leftover forward-refs. Commit: `feat: ClientUpdate standalone 5-key required schema — closes PUT window (GH #201)`.

---

## Task 3: api-client — ClientUpdateSchema + updateClient retype

### Classification: small

### Required Docs
- `docs/specs/2026-08-04-client-canonical-put-design.md` §3.2
- Skill `vitest-playwright-patterns`

### Files
- Modify: `packages/api-client/src/schemas.ts` (new schema near `ClientCreateSchema`, :269-276)
- Modify: `packages/api-client/src/endpoints.ts` (`updateClient`, :296-301)
- Modify: `packages/api-client/src/schemas.test.ts` (new describe group after `ClientResponseSchema`, ~:440)
- Modify: `packages/api-client/src/endpoints.test.ts` (new `updateClient` describe; exemplar: `updateService`, :631-658)

### Steps

- [ ] **3.1 — RED: schema tests.** Add to `src/schemas.test.ts` (house pattern: `MasterUpdateSchema` group :793-817):
  ```ts
  // ─── ClientUpdateSchema (GH #201) ─────────────────────────────────────────

  describe('ClientUpdateSchema', () => {
    it('accepts a full canonical update payload', () => {
      const result = ClientUpdateSchema.parse({
        name: 'Иван', phone: '+79991234567', email: null,
        channel: 'telegram', is_active: true,
      });
      expect(result.is_active).toBe(true);
    });

    it('accepts all-null personal fields (deliberate wipe) + is_active', () => {
      const result = ClientUpdateSchema.parse({
        name: null, phone: null, email: null, channel: null, is_active: false,
      });
      expect(result.channel).toBeNull();
    });

    it('rejects missing is_active', () => {
      expect(() =>
        ClientUpdateSchema.parse({
          name: 'Иван', phone: null, email: null, channel: null,
        }),
      ).toThrow();
    });

    it('rejects a missing personal field (required keys)', () => {
      expect(() =>
        ClientUpdateSchema.parse({
          name: 'Иван', phone: null, channel: null, is_active: true,
        } as never),
      ).toThrow();
    });

    it('rejects an invalid channel string', () => {
      expect(() =>
        ClientUpdateSchema.parse({
          name: null, phone: null, email: null,
          channel: 'instagram', is_active: true,
        }),
      ).toThrow();
    });
  });
  ```
  (Import `ClientUpdateSchema` — will not exist yet → RED.) Run `pnpm --filter @memo/api-client test` → fail = RED.

- [ ] **3.2 — GREEN: add the schema** in `src/schemas.ts` right after `ClientCreateSchema` (:276). NOTE the intentional asymmetry (spec §3.2): Create stays lenient (free-string optional channel); Update is the strict canon. Do NOT use the `CreateSchema.extend(...)` house shortcut here — Create's fields are optional, Update needs required-nullable:
  ```ts
  // ─── ClientUpdate (request body, GH #201 — canonical full-replace PUT) ────
  // All keys required: 4 required-nullable personal fields (explicit null =
  // deliberate clear) + required is_active. Intentionally NOT Create.extend() —
  // Create is lenient (booking auto-create), Update is the strict contract.

  export const ClientUpdateSchema = z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    channel: z.enum(['telegram', 'whatsapp', 'max']).nullable(),
    is_active: z.boolean(),
  });

  export type ClientUpdate = z.infer<typeof ClientUpdateSchema>;
  ```
  Run schema tests → GREEN. (`index.ts` uses `export *` — no export registration needed.)

- [ ] **3.3 — RED: endpoint test.** Add to `src/endpoints.test.ts` (exemplar `updateService` :631-658):
  ```ts
  describe('updateClient', () => {
    it('calls PUT /api/v1/clients/:id with full typed body', async () => {
      vi.mocked(api).mockResolvedValue({ id: 'c-1' });
      const payload: ClientUpdate = {
        name: 'Updated', phone: null, email: null,
        channel: 'whatsapp', is_active: true,
      };
      await updateClient('c-1', payload);
      expect(api).toHaveBeenCalledWith(
        '/api/v1/clients/c-1',
        expect.anything(),
        expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) }),
      );
    });
  });
  ```
  (Import `ClientUpdate` type.) Compile fails on `ClientUpdate` vs current `ClientCreate` signature mismatch → RED.

- [ ] **3.4 — GREEN: retype `updateClient`** (`src/endpoints.ts:296-301`):
  ```ts
  export async function updateClient(id: string, data: ClientUpdate): Promise<ClientResponse> {
    return api(`/api/v1/clients/${id}`, ClientResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  ```
  Update the file's type import from `./schemas` to include `ClientUpdate`. `ClientCreateSchema`, `patchClient` (:303-311): **no change** (dead code, first caller = #198).

- [ ] **3.5 — Verify:** `pnpm --filter @memo/api-client test` → **156 passed, 4 failed** (4 = known #188; +6 new). Commit: `feat: ClientUpdateSchema + updateClient(id, ClientUpdate) — fix Create-typing bug (GH #201)`.

---

## Task 4: Admin — typed PUT payload with '' → null + save-time channel guard

### Classification: standard

### Required Docs
- `docs/specs/2026-08-04-client-canonical-put-design.md` §3.3, §5 (B2/M2 decisions)
- `docs/domain-rules/clients.md` — Frontend section
- Skill `vitest-playwright-patterns`

### Files
- Modify: `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx` (:13-19 props, :25-28 state, :58-61 handleSave, :63-72 deps)
- Modify: `frontend/admin/contexts/ClientsContext.tsx` (:61, :115-118, :138-143 + import)
- Modify: `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx` (:184-200)
- Modify: `frontend/admin/__tests__/ClientInfoTab.test.tsx` (:138-153, :294-314)
- Modify: `frontend/admin/__tests__/ClientCardModal.test.tsx` (:291-297 + the info-save test-double payload)
- Modify: `frontend/admin/__tests__/ClientsIntegration.test.tsx` (:307-323)

### Steps

- [ ] **4.1 — RED: update test expectations to the full `ClientUpdate` shape.**
  a. `ClientInfoTab.test.tsx:146-151` →
  ```ts
      expect(onSave).toHaveBeenCalledWith({
        name: 'Новое Имя',
        phone: '+7 (900) 123-45-67',
        email: null,
        channel: 'telegram',
        is_active: true,   // = the fixture client's is_active (shared mock sets true; use its value if different)
      });
  ```
  b. `ClientInfoTab.test.tsx:307-312` → same 5-key shape: `{ name: 'Новое Имя', phone: '+7 (000) 000-00-00', email: 'new@test.com', channel: 'whatsapp', is_active: true }`.
  c. `ClientsIntegration.test.tsx:316-321` → `{ name: 'Новое Имя', phone: '+7 (000) 000-00-00', email: null, channel: 'telegram', is_active: mockClient.is_active }` (use the mock's actual field reference if in scope, else its literal value).
  d. `ClientCardModal.test.tsx:291-297` — the mocked ClientInfoTab double fires `info-save` → onSave payload must become a full `ClientUpdate`: update BOTH the double's `onSave(...)` call payload and the assertion to `('c1', { name: 'updated', phone: null, email: null, channel: null, is_active: true })`.
  Run `cd frontend/admin && npm test` → 4 tests FAIL (payload shape mismatch) = RED.

- [ ] **4.2 — GREEN: `ClientInfoTab.tsx`.** Add near the top (after imports):
  ```ts
  const CHANNEL_VALUES = ['telegram', 'whatsapp', 'max'] as const;
  type ChannelValue = (typeof CHANNEL_VALUES)[number];
  const isKnownChannel = (v: string): v is ChannelValue =>
    (CHANNEL_VALUES as readonly string[]).includes(v);
  ```
  Then:
  - Props (:16): `onSave: (data: ClientUpdate) => Promise<void>;` (+ `import type { ClientUpdate } from '@memo/api-client';` — follow the file's existing ClientWithStats import source).
  - State init (:28): `const [channel, setChannel] = useState(client?.channel && isKnownChannel(client.channel) ? client.channel : '');` — display normalization for legacy values (spec §3.3: init only; the :42 effect/:67 cancel stay raw, save-time guard below is the single correctness point).
  - `handleSave` (:58-61):
  ```ts
  const handleSave = useCallback(async () => {
    await onSave({
      name: name || null,
      phone: phone || null,
      email: email || null,
      channel: isKnownChannel(channel) ? channel : null,
      is_active: client?.is_active ?? true,
    });
    setHasChanges(false);
  }, [name, phone, email, channel, client?.is_active, onSave]);
  ```
  (`is_active: client?.is_active ?? true` — create mode routes the same `save()` ref with `client={null}`; the create path ignores `is_active`. Spec §5 B2.)

- [ ] **4.3 — GREEN: `ClientsContext.tsx`.** Import `type { ClientUpdate }` from `@memo/api-client`; change exactly three signatures — interface (:61) `updateClient: (id: string, data: ClientUpdate) => Promise<void>;`, mutation (:116) `mutationFn: ({ id, data }: { id: string; data: ClientUpdate }) => apiUpdateClient(id, data)`, callback (:139) `async (id: string, data: ClientUpdate) => {`. `ClientCreateData` (:60, :68, :110-113, :131-136) and `patchClient` (:62, :120-124, :145-150) untouched.

- [ ] **4.4 — GREEN: `ClientCardModal.tsx` (:184-200).** Retype the onSave branches (data now inferred `ClientUpdate`; drop the `as any` on the create-path payload at :187; keep the response-side `as any` at :188 — out of scope):
  ```tsx
                onSave={mode === 'create'
                  ? async (data) => {
                      try {
                        const newClient = await createClient({
                          name: data.name ?? '',
                          phone: data.phone ?? undefined,
                          email: data.email ?? undefined,
                          channel: data.channel ?? undefined,
                        });
                        onClientCreated?.(newClient as any);
                      } catch (err) {
                        showToast(parseApiError(err).message, 'error');
                      }
                    }
                  : async (data) => {
                      try {
                        await updateClient(client!.id, data);
                      } catch (err) {
                        showToast(parseApiError(err).message, 'error');
                      }
                    }
                }
  ```

- [ ] **4.5 — Verify:** `cd frontend/admin && npm test` → **1239 passed / 0 failed** (in-place updates, ±0); `npm run type-check` → clean. Confirm the create-mode guard test passes unchanged: `npm test -- -t "handles duplicate phone"` (ClientsIntegration :796-836 — exercises `save()` with `client={null}`). Commit: `feat: typed ClientUpdate edit payload — '' → null, save-time channel guard, is_active (GH #201)`.

---

## Task 5: Unskip e2e test 6

### Classification: small

### Required Docs
- `docs/specs/2026-08-04-client-canonical-put-design.md` §3.4, §7
- Skill `vitest-playwright-patterns` (e2e section)

### Files
- Modify: `frontend/admin/e2e/clients.spec.ts` (:172)

### Steps

- [ ] **5.1 — Delete the skip marker** at `e2e/clients.spec.ts:172` (the whole `test.skip(true, 'GH #201: …')` line). No other change — the flow (POST `createTestClient` → UI edit → save → reload assert) is unaffected by the contract change.
- [ ] **5.2 — Run the shard:** per `dev-workflow` skill (dev server already running or `npm run test:e2e -- e2e/clients.spec.ts` from `frontend/admin`) → test 6 **passes**. If the local e2e harness needs the full stack, follow the repo's `dev.sh`/CI e2e path — do NOT weaken the test to make it pass.
- [ ] **5.3 — Commit:** `test: unskip e2e clients edit-save — window closed (GH #201)`.

---

## Task 6: Domain rules update

### Classification: small

### Required Docs
- `docs/specs/2026-08-04-client-canonical-put-design.md` §3.5 (normative wording incl. M3)
- Skill `domain-rules`

### Files
- Modify: `docs/domain-rules/_overview.md` (:79-83)
- Modify: `docs/domain-rules/clients.md` (:25-40 Frontend section, :69-78 Parity Notes + Archive semantics)

### Steps

- [ ] **6.1 — `_overview.md` PUT bullet (:79-83):** extend "requires an explicit `is_active` boolean for Master, Location, Material, Service (GH #178…)" → all 5 soft-delete entities (Client joins via GH #201); note Client additionally requires its 4 nullable personal keys (required-nullable, explicit null = deliberate clear). **Delete the Client exception / window sentence** ("Client exception until GH #201: … accepted window …").
- [ ] **6.2 — `clients.md` "Archive semantics on write" (:76-78):** replace the window note with the new canon per spec §3.5: `ClientUpdate` = 4 required-nullable fields + required `is_active` (omitted key → 422); explicit `null` = deliberate clear (personal fields erased; payments/stats by `client_id` joins intact); PATCH sticky unchanged. **Include both M3 sentences verbatim:** the PATCH media type is plain `application/json`, **not** `application/merge-patch+json` (sticky `null` → preserve deviates from RFC 7396); the same JSON `null` means **clear on PUT, preserve on PATCH**.
- [ ] **6.3 — `clients.md` Frontend section (:35-39):** channel select normalizes unknown/legacy values to «Не указан» display; save persists `''`/unknown as `null`; legacy channel wash-out on next edit-save is one-way and documented.
- [ ] **6.4 — `clients.md` Parity Notes table (:69-74):** update — the update path now enforces the `Channel` enum (zod `ClientUpdateSchema` + Pydantic `ClientUpdate`); the create path stays lenient (intentional asymmetry, spec §3.2). Retarget the :33 Restore note's stale window cross-reference if present.
- [ ] **6.5 — Commit:** `docs: domain rules — Client canonical PUT canon, null-semantics divergence note (GH #201)`.

---

## Finishing gate (all tasks)

- [ ] Backend `python -m pytest -q` green, 5 skips, zero `#201` forward-refs (`grep -rn "#201" backend/tests frontend/admin` → past-tense only or empty)
- [ ] `pnpm --filter @memo/api-client test` 156p/4f (4 = #188); admin `npm run test:all` green; `tsc` clean
- [ ] Spec §7 Visual Compliance smoke (admin Клиенты table, edit-save modal, channel select) via `scripts/visual-compliance-check.sh`
- [ ] CI 15/15 incl. both e2e shards (AC8)

## Self-review record

- Spec coverage: AC1→T2, AC2→T3, AC3→T4, AC4→T2+T5, AC5→T1+T2, AC6→T3+T4, AC7→T6, AC8→finishing. Panel fixes: B1→T1.1, B2→T4.2/T4.4, M1→T2.1, M2→T4.2, M3→T6.2, m1→T6.1, m3→T1.3, m4→T1.4, m5→T2.4b, m6→T3.1.
- No placeholders; all task steps carry exact code/commands; expected counts per task.
- Type consistency: `ClientUpdate` (zod) mirrors `ClientUpdate` (Pydantic) — 5 required keys; admin literal identical shape.
- Required Docs present on every task.
