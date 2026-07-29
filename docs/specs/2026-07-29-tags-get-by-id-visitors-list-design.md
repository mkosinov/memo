# Endpoints: GET /api/v1/tags/{id} + GET /api/v1/visitors — Design

- Date: 2026-07-29
- GitHub issue: #183 (depends on #182 — merged PR #187, commit f755b26)
- Status: pending G1b
- Predecessor spec: `docs/specs/2026-07-28-list-pagination-migration-design.md` (defines the paginated form, `per_page` cap=100, 422 policy, contract-test style)
- Domain rules: `docs/domain-rules/tags.md`, `docs/domain-rules/visitors.md` (both need endpoint-table updates on completion)

### G1a rationale (binding context)

- **Visitors bare list vs. the old domain rule.** `docs/domain-rules/visitors.md` states "No standalone list-all endpoint — only by client". That rule is **superseded by this spec** (user-approved at G1a): visitors is a generic entity, and without a bare list it is the only generic entity excluded from the generic contract coverage that #184/#185 will build. Endpoint cost is trivial since #182 built the template. §4.4 defines the domain-rules amendment.
- **Why visitors was excluded from #182:** it had no bare list at all — #182 only paginated existing endpoints. #183 creates the endpoint, deliberately adopting the #182 form from day one.

## 1. Background & Problem

Two gaps in the generic-entity contract:

1. **Tags is the only generic entity without GET-by-id.** Every other generic entity exposes `GET /api/v1/<entity>/{id}` (e.g. `GET /api/v1/visitors/{id}`, `GET /api/v1/masters/{id}`). The tags router (`backend/src/api/v1/tags.py`) has list, create, PUT, PATCH, DELETE — no get-by-id.
2. **Visitors is the only generic entity without a bare list endpoint.** #182 paginated all 9 bare-list endpoints; visitors was explicitly excluded because it had no bare list at all (only `GET /visitors/{id}` and the scoped `GET /clients/{id}/visitors`). Without it, visitors is the only generic entity excluded from the generic contract coverage that #184/#185 will build.

Both additions follow templates already in the codebase, so endpoint cost is trivial.

## 2. Goals

1. `GET /api/v1/tags/{id}` → `200 TagResponse` on hit / `404` with `TAG_NOT_FOUND` on miss.
2. `GET /api/v1/visitors` → paginated `PaginatedResponse[VisitorResponse]` `{items, total, page, per_page}` — the exact form from #182.
3. api-client: `getTag(id)` and `getVisitors({page?, per_page?})` methods + unit tests.
4. Backend contract tests in the existing style (cf. #182/#181).

## 3. Non-Goals

- UI consumer migration (no admin frontend call site uses these methods yet; #184/#185 and later work will consume them).
- Any change to the scoped `GET /api/v1/clients/{id}/visitors` — it stays a standalone route, unpaginated, untouched.
- #184 (service-level CRUD contract) and #185 (HTTP CRUD contract + test dedup).
- No pagination UI.

## 4. Design

### 4.1 Backend: `GET /api/v1/tags/{id}`

Pattern: copy of `get_master` (`backend/src/api/v1/masters.py:54-70`) / `get_visitor` (`backend/src/api/v1/visitors.py:25-41`).

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

- `ErrorCode.TAG_NOT_FOUND` already exists (`backend/src/errors.py`) and is used by PUT/PATCH/DELETE tag handlers — same 404 body shape `{detail: {code, message}}`.
- Route placement: after the bare `GET ""` list handler, before `PUT "/{tag_id}"` — FastAPI matches `GET /{tag_id}` only against GET, no conflict with the list route.
- Uses existing `GenericService.get()` — no service-layer changes.

### 4.2 Backend: `GET /api/v1/visitors`

Pattern: copy of `list_tags` (`backend/src/api/v1/tags.py:26-34`).

```python
@router.get("", response_model=PaginatedResponse[VisitorResponse])
async def list_visitors(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> PaginatedResponse[VisitorResponse]:
    """Return all active visitors, paginated."""
    return await service.list(
        db_session=session, page=page, per_page=per_page,
        order_by=[asc(Visitor.created_at), asc(Visitor.id)],
    )
```

- `PaginatedResponse` (`backend/src/schemas/common.py:10-16`) and the paginated `GenericService.list()` (`backend/src/services/generic.py:51-74`) already exist from #182 — reuse as-is.
- `VisitorService` extends `GenericService[VisitorCreate, VisitorUpdate, VisitorResponse]`, so `service.list()` is already available.
- **Explicit `order_by` is required** (unlike the tags list): pagination without ORDER BY is non-deterministic — rows can shift between pages, breaking slice-disjointness. `created_at, id` gives a stable total order; `asc` / `Visitor` imports follow the masters.py precedent.
- Pagination policy (from #182 G1b, binding): `page >= 1`, `per_page` 1..100 hard cap; out-of-bounds params → explicit **422** validation error, never silent clamping.
- **Soft-delete semantics:** `GenericService.list()` filters `is_active` — soft-deleted visitors are excluded from this list (docstring "Return all active visitors" reflects this). Note the pre-existing asymmetry: `GET /visitors/{id}` uses `GenericService.get()`, which does NOT filter `is_active`, so a soft-deleted visitor remains fetchable by id. That asymmetry exists across all generic entities and is **out of scope** here (candidate for #184).
- Route placement: **before** `GET "/{visitor_id}"` in `backend/src/api/v1/visitors.py`, matching how other routers order bare-list vs by-id (FastAPI resolves `GET ""` exactly, so ordering is defensive style-consistency, not a correctness requirement).
- **Scoped route unchanged:** `GET /api/v1/clients/{id}/visitors` (in `clients.py`, standalone service path) is NOT touched — no pagination, same response shape.

### 4.3 Frontend: api-client

`packages/api-client/src/endpoints.ts`:

```typescript
export async function getTag(id: string): Promise<TagResponse> {
  return api(`/api/v1/tags/${id}`, TagResponseSchema);
}

export async function getVisitors(params?: ListParams): Promise<PaginatedResponse<VisitorResponse>> {
  return api(`/api/v1/visitors${listQuery(params)}`, VisitorListResponseSchema);
}
```

- `TagResponseSchema` already exists (`schemas.ts:104-109`).
- Add `VisitorListResponseSchema = paginatedSchema(VisitorResponseSchema)` in `schemas.ts` next to the other per-entity list schemas (lines 519-526); export the matching type via the existing `PaginatedResponse<T>` interface.
- `ListParams` (`{page?: number; per_page?: number}`) and the `listQuery()` helper already exist from #182 (`endpoints.ts:82-85`).

### 4.4 Domain-rules docs update

On completion, update domain rules (implementation task, part of the docs commit):

- `docs/domain-rules/tags.md`: add `GET | /api/v1/tags/{id} | Get` row to the API Endpoints table.
- `docs/domain-rules/visitors.md`:
  - Add `GET | /api/v1/visitors | List all (paginated)` row to the API Endpoints table.
  - Replace the business-logic note "**No standalone list-all endpoint — only by client**" with: "**List-all endpoint:** `GET /api/v1/visitors` — paginated generic list (added in #183; supersedes the previous no-list-all rule)".

## 5. Test Strategy

### Backend (pytest, existing contract-test style — `pytestmark = pytest.mark.api`, `api_client` fixture, create-via-POST)

**Tags — `backend/tests/test_api_tags.py`:**
1. `GET /tags/{id}` after POST → 200, payload matches the created tag (`id`, `tag`).
2. `GET /tags/nonexistent-id` → 404, `detail.code == "TAG_NOT_FOUND"`.
3. Lifecycle: POST a tag → DELETE it → `GET /tags/{id}` → 404 (tags are hard-deleted; deleted id is truly gone).

**Visitors — `backend/tests/test_api_visitors.py`:**
1. Envelope shape: `items/total/page/per_page` keys; defaults `page=1, per_page=20`.
2. `total` correctness with N created visitors (via client + N visitor POSTs).
3. `page=2&per_page=k` slice is disjoint from page 1 (deterministic under the mandated `created_at, id` ordering).
4. `per_page` respected (e.g. `per_page=2` returns exactly 2 items).
5. Out-of-range page → empty `items`, correct `total`.
6. 422 on `per_page=101`, `per_page=0`, `page=0`.

**Scoped-route regression guard (acceptance criterion 3) — `backend/tests/test_api_visitors.py`:**
7. `GET /api/v1/clients/{id}/visitors` still returns a **bare JSON array** (not the envelope) with exactly the created visitors — guards against accidental migration of the scoped route.

### Frontend (vitest, existing api-client test style — mock `api`, assert URL + schema)

**`packages/api-client/src/endpoints.test.ts`:**
1. `getTag('t-1')` calls `/api/v1/tags/t-1` with a schema.
2. `getVisitors()` calls `/api/v1/visitors`.
3. `getVisitors({per_page: 100})` calls `/api/v1/visitors?per_page=100` (mirrors existing `getTags` pagination-param test).

**`packages/api-client/src/schemas.test.ts`:**
4. `VisitorListResponseSchema` parses a valid envelope.

## 6. Acceptance Criteria

1. `GET /api/v1/tags/{id}` returns 200 + `TagResponse` for an existing tag; 404 with `TAG_NOT_FOUND` otherwise.
2. `GET /api/v1/visitors` returns `{items, total, page, per_page}` with `page >= 1`, `per_page` 1..100; violations → 422; out-of-range page → empty items + correct total; items ordered deterministically by `created_at, id`.
3. `GET /api/v1/clients/{id}/visitors` behavior byte-identical to before (scoped, unpaginated).
4. api-client exports `getTag` and `getVisitors` with the signatures in §4.3.
5. Backend `pytest` green; api-client unit tests green; no other frontend changes.
6. Domain-rules endpoint tables updated for tags and visitors.

## 7. User Scenarios → Test Mapping

| Scenario | Test |
|---|---|
| Fetch tag by id | backend tags 200 test |
| 404 on missing tag | backend tags 404 test |
| Fetch first page of visitors | envelope shape + defaults test |
| Fetch second page disjoint from first | page=2 slice test |
| 422 on invalid pagination params | 422 tests (`per_page=101`, `per_page=0`, `page=0`) |

## 8. Visual Compliance Checks

N/A — no user-visible UI. Backend endpoints + api-client library only; no admin frontend call site consumes the new methods in this feature. Verification is via backend pytest and api-client unit tests.
