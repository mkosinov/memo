# #183: GET /api/v1/tags/{id} + GET /api/v1/visitors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two missing generic-contract endpoints — tags get-by-id and the paginated visitors bare list — plus their api-client methods and contract tests.

**Architecture:** Pure pattern replication. Tags get-by-id copies `get_master`/`get_visitor` (GenericService.get + 404 ErrorDetail). Visitors list copies `list_tags` (paginated GenericService.list, `PaginatedResponse[VisitorResponse]`). Api-client adds `getTag`/`getVisitors` using the existing `paginatedSchema` factory, `ListParams`, and `listQuery()` from #182. No service-layer, schema-model, or DB changes.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Zod + vitest (packages/api-client), pytest with `api_client` fixture (backend tests).

**Spec:** `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` (G1b approved 2026-07-29)

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria:

- **AC1 — tag by id** → Requesting a single tag by its id returns the tag (`{id, tag}`) with 200; a nonexistent id returns 404 with error code `TAG_NOT_FOUND`. Tags are soft-deleted: fetching a deleted tag still returns 200, while the tag disappears from the list — same behavior as every other generic entity.
- **AC2 — visitors list** → `GET /api/v1/visitors` returns a paginated envelope `{items, total, page, per_page}` (defaults page=1, per_page=20, per_page capped at 100). Requesting page 2 returns items disjoint from page 1; a page beyond the data returns empty items with the correct total. Invalid params (`page=0`, `per_page=0`, `per_page=101`) are rejected with 422 — never silently clamped.
- **AC3 — scoped route untouched** → `GET /api/v1/clients/{id}/visitors` behaves exactly as before: a plain JSON array, unpaginated. It remains the production read path for visitors; the new bare list exists only for generic-contract completeness.
- **AC4 — api-client** → The api-client library exports `getTag(id)` and `getVisitors({page?, per_page?})` matching the backend contract.
- **AC5 — green tests** → Backend pytest suite and api-client unit tests all pass; nothing else in the frontend changes.
- **AC6 — docs** → Domain rules for tags and visitors reflect the new endpoints, including that the visitors bare list is contract-only and the scoped route remains the production read path.

## File Structure

| File | Change |
|---|---|
| `backend/src/api/v1/tags.py` | Add `get_tag` handler (after `list_tags`, before `create_tag`) |
| `backend/src/api/v1/visitors.py` | Add imports (`Query`, `PaginatedResponse`) + `list_visitors` handler (before `get_visitor`) |
| `backend/tests/test_api_tags.py` | Add 3 tests to `TestTagsCrud` (200 / 404 / delete-lifecycle) |
| `backend/tests/test_api_visitors.py` | Add `TestVisitorList` class (7 tests) |
| `packages/api-client/src/schemas.ts` | Add `VisitorListResponseSchema` to the paginated-envelope block |
| `packages/api-client/src/endpoints.ts` | Import `VisitorListResponseSchema`; add `getTag` + `getVisitors` |
| `packages/api-client/src/endpoints.test.ts` | Add `describe('getTag')` + `describe('getVisitors')` blocks; extend import |
| `docs/domain-rules/tags.md` | Add GET-by-id endpoint row |
| `docs/domain-rules/visitors.md` | Add bare-list row + replace business-logic note (exact wording in Task 6) |

---

## Task 1: Backend — `GET /api/v1/tags/{id}` endpoint + tests

### Classification: small

### Required Docs
- `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` — §4.1 (endpoint design), §5 (test strategy)
- `docs/domain-rules/tags.md` — entity fields. NOTE: this file's "hard-deleted" invariant is stale; tags are **soft-deleted** (Task 6 corrects the doc). The lifecycle test below encodes the true behavior.
- Skill: `pytest-patterns` — existing contract-test style
- Skill: `test-driven-development` — RED-GREEN-REFACTOR

### Task Description

Add a get-by-id endpoint to the tags router, copying the `get_visitor`/`get_master` pattern exactly, plus three tests in the existing contract style.

**Files:**
- Modify: `backend/src/api/v1/tags.py`
- Modify: `backend/tests/test_api_tags.py`

### Steps

- [ ] **Step 1 — RED: write the failing tests.** Append these three methods to `class TestTagsCrud` in `backend/tests/test_api_tags.py` (after `test_list_tags_after_create`, keeping the class's logical grouping):

```python
    def test_get_tag_by_id(self, api_client) -> None:
        """GET /api/v1/tags/{id} returns the specific tag."""
        create = api_client.post("/api/v1/tags", json={"tag": "VIP"})
        tag_id = create.json()["id"]

        response = api_client.get(f"/api/v1/tags/{tag_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == tag_id
        assert body["tag"] == "VIP"

    def test_get_nonexistent_tag_returns_404(self, api_client) -> None:
        """GET /api/v1/tags/{fake_id} returns 404 with TAG_NOT_FOUND."""
        response = api_client.get("/api/v1/tags/nonexistent-id")
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "TAG_NOT_FOUND"

    def test_get_deleted_tag_returns_200(self, api_client) -> None:
        """Soft-deleted tag stays fetchable by id (200) but is excluded from the list."""
        create = api_client.post("/api/v1/tags", json={"tag": "Ephemeral"})
        tag_id = create.json()["id"]
        delete = api_client.delete(f"/api/v1/tags/{tag_id}")
        assert delete.status_code == 204

        # Soft-delete: row remains fetchable by id (TagResponse has no is_active field)
        response = api_client.get(f"/api/v1/tags/{tag_id}")
        assert response.status_code == 200
        assert response.json()["id"] == tag_id

        # ... but is excluded from the list
        body = api_client.get("/api/v1/tags").json()
        assert not any(t["id"] == tag_id for t in body["items"])
```

- [ ] **Step 2 — Run RED.** `cd backend && uv run pytest tests/test_api_tags.py -x -q` — expected: the 3 new tests FAIL (404→405 or 404 on the new route / wrong behavior); all 9 pre-existing tests pass.
- [ ] **Step 3 — GREEN: implement the handler.** In `backend/src/api/v1/tags.py`, insert this handler immediately after `list_tags` and before `create_tag` (no new imports needed — everything is already imported in this file):

```python
@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Return a single tag by ID."""
    tag = await service.get(db_session=session, id=tag_id)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.TAG_NOT_FOUND,
                message="Tag not found",
            ).model_dump(),
        )
    return tag
```

- [ ] **Step 4 — Run GREEN.** `cd backend && uv run pytest tests/test_api_tags.py -q` — expected: 12 passed.
- [ ] **Step 5 — Regression: full api marker.** `cd backend && uv run pytest -m api -q` — expected: all pass (this adds a GET route to the tags router; confirm no route-shadowing regressions elsewhere).
- [ ] **Step 6 — Commit.** `git add backend/src/api/v1/tags.py backend/tests/test_api_tags.py && git commit -m "feat(backend): add GET /api/v1/tags/{id} endpoint (#183)"`

### DoD
- 3 new tests pass; all pre-existing backend api tests pass.
- Handler matches the code block above exactly (pattern parity with `get_visitor`).

---

## Task 2: Backend — `GET /api/v1/visitors` paginated list endpoint + tests

### Classification: standard

### Required Docs
- `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` — §4.2 (endpoint design incl. no-order-by rationale + soft-delete semantics), §5 (test strategy incl. scoped-route regression guard)
- `docs/domain-rules/visitors.md` — entity fields; soft-delete behavior
- Skill: `pytest-patterns`
- Skill: `test-driven-development`

### Task Description

Add the bare paginated list endpoint to the visitors router — a copy of `list_tags` (no `order_by`, per spec §4.2 rationale: consistency with the 9 endpoints from #182) — plus a new `TestVisitorList` test class covering the envelope contract and a regression guard proving the scoped route is unchanged.

**Files:**
- Modify: `backend/src/api/v1/visitors.py`
- Modify: `backend/tests/test_api_visitors.py`

### Steps

- [ ] **Step 1 — RED: write the failing test class.** Append this class to `backend/tests/test_api_visitors.py` (after `TestVisitorPatch`; reuses the module-level `_create_client` helper):

```python
class TestVisitorList:
    """Tests for GET /api/v1/visitors — paginated bare list (#183)."""

    def _create_visitors(self, api_client, count: int) -> list[str]:
        """Helper: create `count` visitors under one client, return their ids."""
        client_id = _create_client(api_client)
        ids = []
        for i in range(count):
            resp = api_client.post(
                "/api/v1/visitors",
                json={"client_id": client_id, "name": f"Visitor {i}", "age": 20 + i},
            )
            assert resp.status_code == 201
            ids.append(resp.json()["id"])
        return ids

    def test_list_visitors_envelope_shape(self, api_client) -> None:
        """GET /api/v1/visitors returns the pagination envelope with defaults."""
        response = api_client.get("/api/v1/visitors")
        assert response.status_code == 200
        body = response.json()
        assert body["page"] == 1
        assert body["per_page"] == 20
        assert isinstance(body["items"], list)
        assert isinstance(body["total"], int)

    def test_list_visitors_total(self, api_client) -> None:
        """total reflects the number of created visitors."""
        ids = self._create_visitors(api_client, 3)
        response = api_client.get("/api/v1/visitors")
        body = response.json()
        assert body["total"] >= 3
        returned_ids = {v["id"] for v in body["items"]}
        assert set(ids) <= returned_ids

    def test_list_visitors_page2_disjoint_from_page1(self, api_client) -> None:
        """page=2 slice is disjoint from page 1 (set disjointness of ids)."""
        self._create_visitors(api_client, 4)
        page1 = api_client.get("/api/v1/visitors", params={"page": 1, "per_page": 2}).json()
        page2 = api_client.get("/api/v1/visitors", params={"page": 2, "per_page": 2}).json()
        assert page1["total"] == page2["total"]
        ids_p1 = {v["id"] for v in page1["items"]}
        ids_p2 = {v["id"] for v in page2["items"]}
        assert len(ids_p1) == 2
        assert len(ids_p2) == 2
        assert ids_p1.isdisjoint(ids_p2)

    def test_list_visitors_per_page_respected(self, api_client) -> None:
        """per_page=2 returns exactly 2 items."""
        self._create_visitors(api_client, 3)
        body = api_client.get("/api/v1/visitors", params={"per_page": 2}).json()
        assert body["per_page"] == 2
        assert len(body["items"]) == 2

    def test_list_visitors_out_of_range_page_empty(self, api_client) -> None:
        """Out-of-range page returns empty items with correct total."""
        self._create_visitors(api_client, 2)
        body = api_client.get("/api/v1/visitors", params={"page": 99}).json()
        assert body["items"] == []
        assert body["total"] >= 2

    def test_list_visitors_invalid_params_422(self, api_client) -> None:
        """per_page=101, per_page=0, page=0 → explicit 422, no silent clamping."""
        assert api_client.get("/api/v1/visitors", params={"per_page": 101}).status_code == 422
        assert api_client.get("/api/v1/visitors", params={"per_page": 0}).status_code == 422
        assert api_client.get("/api/v1/visitors", params={"page": 0}).status_code == 422

    def test_scoped_client_visitors_route_unchanged(self, api_client) -> None:
        """Regression guard: GET /api/v1/clients/{id}/visitors stays a bare array."""
        client_id = _create_client(api_client)
        api_client.post("/api/v1/visitors", json={"client_id": client_id, "name": "Alice", "age": 28})

        response = api_client.get(f"/api/v1/clients/{client_id}/visitors")
        assert response.status_code == 200
        visitors = response.json()
        assert isinstance(visitors, list)  # NOT the {items, total, ...} envelope
        assert any(v["name"] == "Alice" for v in visitors)
```

- [ ] **Step 2 — Run RED.** `cd backend && uv run pytest tests/test_api_visitors.py -x -q` — expected: the new class fails (route does not exist); pre-existing tests pass.
- [ ] **Step 3 — GREEN: implement the handler.** In `backend/src/api/v1/visitors.py`:
  - Add to the fastapi import: `Query` → `from fastapi import APIRouter, Depends, HTTPException, Query`
  - Add import: `from src.schemas.common import PaginatedResponse`
  - Insert this handler **before** the existing `get_visitor` handler (bare-list before by-id, matching other routers):

```python
@router.get("", response_model=PaginatedResponse[VisitorResponse])
async def list_visitors(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[VisitorResponse]:
    """Return all active visitors, paginated."""
    return await service.list(db_session=session, page=page, per_page=per_page)
```

- [ ] **Step 4 — Run GREEN.** `cd backend && uv run pytest tests/test_api_visitors.py -q` — expected: all pass (10 pre-existing + 7 new).
- [ ] **Step 5 — Regression: full suite.** `cd backend && uv run pytest -q` — expected: all pass.
- [ ] **Step 6 — Commit.** `git add backend/src/api/v1/visitors.py backend/tests/test_api_visitors.py && git commit -m "feat(backend): add paginated GET /api/v1/visitors list endpoint (#183)"`

### DoD
- 7 new tests pass; full backend pytest suite green.
- Handler is a verbatim copy of `list_tags` (no `order_by`); imports added as specified.
- Scoped-route regression guard passes.

---

## Task 3: api-client — `VisitorListResponseSchema` in schemas.ts

### Classification: trivial

### Required Docs
- `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` — §4.3

### Task Description

Add the visitors list envelope schema to the existing paginated-envelope block. One line, no logic.

**Files:**
- Modify: `packages/api-client/src/schemas.ts`

### Steps

- [ ] **Step 1 — Add the schema.** In `packages/api-client/src/schemas.ts`, in the "Paginated list envelopes" block, add this line immediately after `RecordListResponseSchema` (end of the per-entity list):

```typescript
export const VisitorListResponseSchema = paginatedSchema(VisitorResponseSchema);
```

- [ ] **Step 2 — Typecheck + tests.** `pnpm --filter @memo/api-client test` — expected: all existing tests pass (the new export is unused until Task 4).
- [ ] **Step 3 — Commit.** `git add packages/api-client/src/schemas.ts && git commit -m "feat(api-client): add VisitorListResponseSchema (#183)"`

### DoD
- One-line addition; `paginatedSchema(VisitorResponseSchema)` exported; api-client tests green.

---

## Task 4: api-client — `getTag` + `getVisitors` endpoint methods

### Classification: small

### Required Docs
- `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` — §4.3 (exact signatures)
- Skill: `test-driven-development` (tests live in Task 5 — this task is the minimal GREEN for them; run Task 4+5 as one TDD cycle: write Task 5 tests RED first, then implement)

### Task Description

Add the two api-client methods. `getTag` copies the `getMaster` by-id pattern; `getVisitors` copies `getTags` verbatim (same `ListParams` + `listQuery` mechanics).

**Files:**
- Modify: `packages/api-client/src/endpoints.ts`

### Steps

- [ ] **Step 1 — Extend the schemas import.** In `packages/api-client/src/endpoints.ts`, in the big `from './schemas'` import block, add `VisitorListResponseSchema,` immediately after `RecordListResponseSchema,` (before `type PaginatedResponse,`).
- [ ] **Step 2 — Add `getTag`.** In the `// ─── Tags ───` section, immediately after `getTags`:

```typescript
export async function getTag(id: string): Promise<TagResponse> {
  return api(`/api/v1/tags/${id}`, TagResponseSchema);
}
```

- [ ] **Step 3 — Add `getVisitors`.** In the `// ─── Visitors CRUD ───` section, immediately before `createVisitor`:

```typescript
export async function getVisitors(params?: ListParams): Promise<PaginatedResponse<VisitorResponse>> {
  return api(`/api/v1/visitors${listQuery(params)}`, VisitorListResponseSchema);
}
```

- [ ] **Step 4 — Typecheck + tests.** `pnpm --filter @memo/api-client test` — expected: existing tests pass (new methods not yet covered — Task 5 adds their tests; if this task is executed in the same TDD cycle as Task 5, run the combined suite once at the end).
- [ ] **Step 5 — Commit.** `git add packages/api-client/src/endpoints.ts && git commit -m "feat(api-client): add getTag and getVisitors methods (#183)"`

### DoD
- Both methods match the code blocks exactly; `getVisitors` mirrors `getTags` mechanics; api-client tests green.

---

## Task 5: api-client — unit tests for `getTag` + `getVisitors`

### Classification: small

### Required Docs
- `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` — §5 (frontend test strategy)
- Skill: `vitest-playwright-patterns` (vitest mocking style)

### Task Description

Add unit tests in the existing style (mock `api` from `./client`, assert URL + schema arg). If run as one TDD cycle with Task 4: write these tests first (RED — import error / not-a-function), then implement Task 4 (GREEN).

**Files:**
- Modify: `packages/api-client/src/endpoints.test.ts`

### Steps

- [ ] **Step 1 — Extend the endpoints import.** In `packages/api-client/src/endpoints.test.ts`, in the multi-line destructured import from `'./endpoints'` at the top of the file (starts line 3 — the import containing `getMasters, getMaster, ...`), add `getTag` and `getVisitors` near the existing `getTags` entry.
- [ ] **Step 2 — RED: add the test blocks.** Append at the end of `packages/api-client/src/endpoints.test.ts`:

```typescript
describe('getTag', () => {
  it('calls /api/v1/tags/:id with tag schema', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't-1', tag: 'VIP' });
    await getTag('t-1');
    expect(api).toHaveBeenCalledWith('/api/v1/tags/t-1', expect.anything());
  });
});

describe('getVisitors', () => {
  it('calls /api/v1/visitors without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getVisitors();
    expect(api).toHaveBeenCalledWith('/api/v1/visitors', expect.anything());
  });

  it('calls /api/v1/visitors with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getVisitors({ per_page: 100 });
    expect(api).toHaveBeenCalledWith('/api/v1/visitors?per_page=100', expect.anything());
  });
});
```

- [ ] **Step 3 — Run.** `pnpm --filter @memo/api-client test` — expected: all pass (RED first if running TDD cycle with Task 4: 3 failures before the implementation, then green).
- [ ] **Step 4 — Commit.** `git add packages/api-client/src/endpoints.test.ts && git commit -m "test(api-client): cover getTag and getVisitors (#183)"`

### DoD
- 3 new tests pass; full api-client suite green.
- **Note:** spec §5 lists a `VisitorListResponseSchema` parse test in `schemas.test.ts`. That file has **no** list-envelope tests for any of the 8 existing entities — adding one only for visitors would break file conventions. The envelope contract is covered by the backend pytest tests + these endpoint tests. Plan-level decision: skip the schemas.test.ts addition (deviation from spec §5 item 4, documented here).

---

## Task 6: Docs — domain-rules updates

### Classification: small

### Required Docs
- `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` — §4.4 (exact replacement wording, G1b-amended)
- Skill: `domain-rules`

### Task Description

Update the two domain-rules files with the exact wording approved at G1b. No code changes.

**Files:**
- Modify: `docs/domain-rules/tags.md`
- Modify: `docs/domain-rules/visitors.md`

### Steps

- [ ] **Step 1 — tags.md, endpoint table.** In the API Endpoints table, insert a row after the `GET | /api/v1/tags | List all` row:

```markdown
| GET | /api/v1/tags/{id} | Get |
```

- [ ] **Step 2 — tags.md, correct the stale delete invariant.** In `## Invariants`, replace `- Tags are hard-deleted (no is_active flag)` with:

```markdown
- Tags are soft-deleted (is_active flag, SoftDeleteRepository). GET-by-id returns the soft-deleted row (200); the list excludes it. Note: TagResponse does not expose is_active.
```

  And in the API Endpoints table, change the DELETE row description `Hard delete` → `Soft delete`.

- [ ] **Step 3 — visitors.md, endpoint table.** In the API Endpoints table, insert a row **before** the `GET | /api/v1/visitors/{id} | Get` row:

```markdown
| GET | /api/v1/visitors | List all (paginated, contract-only — see Business Logic) |
```

- [ ] **Step 4 — visitors.md, business-logic note.** Replace the bullet `- No standalone list-all endpoint — only by client` with exactly:

```markdown
- **List-all endpoint:** `GET /api/v1/visitors` — paginated generic list, introduced in #183 **for contract completeness with GenericService** so visitors is no longer the only generic entity excluded from generic list contract coverage (#184/#185). It supersedes the previous no-list-all rule. The **production-use read path for visitors remains the scoped `GET /clients/{id}/visitors`** — the bare list is a contract endpoint, not a production consumer-facing read path.
```

(Keep the existing `- **Scoped to Client:** ...` and `- **Auto-created by RecordService** ...` bullets unchanged.)

- [ ] **Step 5 — Commit.** `git add docs/domain-rules/tags.md docs/domain-rules/visitors.md && git commit -m "docs: update tags/visitors domain rules for #183 endpoints"`

### DoD
- Both files match the spec §4.4 wording exactly (including the two G1b-required statements).

---

## Task 7: Final verification

### Classification: trivial

### Required Docs
- `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md` — §6 acceptance criteria

### Task Description

Run both full test suites from a clean state and verify acceptance criteria 1–6.

### Steps

- [ ] **Step 1 — Backend.** `cd backend && uv run pytest -q` — all pass.
- [ ] **Step 2 — api-client.** `pnpm --filter @memo/api-client test` — all pass.
- [ ] **Step 3 — AC walkthrough.** Check AC1–AC6 from the spec against the diff (`git diff --name-only main..HEAD`): only the 9 files listed in File Structure changed.

### DoD
- Both suites green; no files outside the plan's File Structure were modified.

---

## Execution Handoff

Subagent-driven execution (architect dispatches per task, reviews between tasks). Tasks 1 and 2 are independent but run sequentially per protocol. Tasks 4+5 may be dispatched as one TDD cycle to a single implementer.
