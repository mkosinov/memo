# GH #232 — Clients deep-link: machine id-filter (`?clientId=` → `GET /api/v1/clients?id=…&id=…`)

- **Date**: 2026-09-22
- **Branch**: `232-clients-deeplink-id-param`
- **Status**: Completed (merge-ready; in-branch docs commit)
- **Base**: `e74181d6` (main) — 10 commits, 38 files, +2406 / −220
- **Issue**: #232 — deep-link client narrowing must use a machine id-filter, not a UUID in the search box
- **Spec**: `docs/specs/2026-09-21-clients-deeplink-id-param-232-design.md` (rev5)
- **Plan**: `docs/plans/2026-09-21-clients-deeplink-id-param-232-plan.md` (6 tasks)

## Goal

Replace the deep-link transport «UUID in the search field» with a machine filter over a set of
identifiers: the page URL is the single source of narrowing; closing the card mutates nothing;
the card auto-opens only at exactly one id; `id` (repeatable) is a shared list-endpoint filter
(300–500 range) applied through the universal list path and the view builders. Chip offers a
one-click un-narrow that removes all `clientId` params while preserving other query keys.

## Summary of Changes (per task)

- **T1 — `PaginationParams.id` + contract (small, `362dba62`):** `backend/src/schemas/pagination.py`
  — `id: list[UUID] | None`, `MAX_LIST_IDS = 100`, `BeforeValidator` dedup, uniform 422 for
  garbage/overflow. *Accepted deviation:* `max_length=` instead of the plan's `le=` (pydantic 2.13
  raises `TypeError` for `le` on lists → 500); clients endpoint converted to
  `Annotated[ClientListParams, Query()]` (FastAPI 0.141 `Depends()`-models silently drop list
  fields).
- **T2 — IN-predicate application (standard, `be542477`, `690c51d5`, `7a34645a`):**
  `ids_in_predicate` helper (`backend/src/repositories/search.py`); universal `_list_stmt` applies
  the predicate bypassing the `**filters` bag; wired into view builders (clients-with-stats,
  records list+view, photos, masters); scope-before-filter and D3 masking preserved.
- **T3 — api-client `ids` (trivial, `7d5a0710`):** `getClientsWithStats(ids?: string[])` emits
  repeated `id` keys, keys assembled explicitly.
- **T4 — `ClientFilters.clientIds` + URL sync (standard, `ffd82333`, `a52d806e`):** machine field
  outside the search box; address→filter sync (single writer = address); auto-open at exactly one
  valid id; #216 latch; modal-lifecycle cleanup; hidden address mutations removed.
- **T5 — `ClientDeepLinkChip` (small, `97c9ee68`):** «Открыт по ссылке» / «Открыто по ссылке: N»;
  cross removes all `clientId` params preserving others; `resetFilters` cleans the address.
- **T6 — e2e rewrite (standard, `2580b235`, `6aac3c21`):** US-1…US-7 on the machine filter + 3
  old-schema specs updated; shared helpers (`expectDeepLinkChip`, `expectClientSearchEmpty`,
  `clientSearchInput`, exported `resolveRecordDate`).

## Test Results

- **backend pytest (full, xdist):** **2422 passed / 15 skipped**.
- **admin vitest (full):** **2447 passed / 2447** (149 files).
- **e2e clients-page set:** **54/54**; **41/41** on changed specs after the T6 refactor.
- **Type check:** `tsc --noEmit` — 0 errors.
- **Lint:** 0 errors.

## Acceptance Criteria (spec §2 scenarios)

| Scenario | Status |
|---|---|
| US-1…US-7 — machine narrowing, chip, auto-open at 1 id, un-narrow, latch, masked/empty states | ✅ (T4–T6 e2e) |
| US-8 — master scope + D3 masking under `?id=` | ✅ (T2 pytest) |

Visual gate: covered by e2e visual assertions (chip labels/placement) — no separate screenshot run
(project has no visual-compliance script; the spec has no Visual Compliance Checks section).

## Review Trail

- T1: compliance ✅ (deviation accepted). T2: compliance ✅. T3: compliance ✅.
- T4: compliance ✅ + quality ✅. T5: compliance ✅. T6: compliance ✅ + quality ✅.

## Key Files Changed

- `backend/src/schemas/pagination.py`, `backend/src/repositories/search.py`,
  `backend/src/services/generic.py` (+ clients/records/photos/masters view builders)
- `packages/api-client/src/endpoints.ts` (+ tests)
- `frontend/admin/lib/client-id-param.ts`, `contexts/ClientFilters*`, `app/(main)/clients/page.tsx`,
  chip component
- `frontend/admin/e2e/clients.spec.ts` + related specs (US-1…US-7)

## Known Environment Note

Full backend suite must run under `xdist` in this env; a serial run hangs (pre-existing quirk).

## Follow-ups

- (a) Convert remaining `Depends()`-shaped list routers to `Annotated[..., Query()]` so `?id=` is
  enforced uniformly — blocked by FastAPI #12481 (scalar mixing); today only clients/records/
  photos/masters honour `?id=`, others ignore it.
- (b) Rename `list_clients_with_stats` → `list_clients_view` when #217 lands (main already merged
  #217 — verify naming at rebase).
- Live URL synchronization of clients filters (rule of three) — #349.

## References

- **GitHub Issue**: #232
- **Design Spec**: `docs/specs/2026-09-21-clients-deeplink-id-param-232-design.md` (rev5)
- **Plan**: `docs/plans/2026-09-21-clients-deeplink-id-param-232-plan.md`
- **PR**: _(to be added after PR creation)_
