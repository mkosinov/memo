# GH #149 — ge=0 bounds on the six numeric stat filters of `ClientListParams`

- **Date**: 2026-09-17
- **Branch**: `feat/client-filters-ge0`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `eb459d9` (#242 copy-last-week) — 3 commits (`a55099e..316971a`), 3 files, +49 / −6
- **Issue**: #149 — `GET /api/v1/clients` numeric stat filters silently accept negative values (SQL no-op) instead of rejecting them
- **Spec**: `docs/specs/2026-09-17-client-filters-ge0-design.md` (rev2, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-17-client-filters-ge0-plan.md` (3 tasks, on main, unchanged by IMPL)

## Summary of Changes

- **RED (`a55099e`, T1):** parameterized `TestClientListStatFilterBounds` appended to
  `backend/tests/test_api_clients.py` — 6 fields × `-1`/`-42` → 422 (12 cases), 6 fields × `0` → 200,
  plus a custom-422-body shape case (`min_records=-1` → `detail.code` + `detail.message`). RED captured
  against the pre-change schema: **13 failed / 6 passed** — the 12 negative cases and the body-shape case
  failed while the endpoint returned 200 (the silent no-op), the 6 zero cases were green anchors.
- **GREEN (`d90626a`, T2):** the six fields in `ClientListParams` (`backend/src/schemas/client.py`) moved
  from `int | None = None` to `Field(default=None, ge=0)` — `min_records`, `max_records`, `min_paid`,
  `max_paid`, `missed_from`, `missed_to` — with a comment explaining why a model-level validator is
  forbidden here (500-trap, same rationale as the `q`/`phone` comments; schema-level `Field` maps to 422
  for `Depends()` query params). Targeted GREEN 19/19.
- **Regression + CHANGELOG (`316971a`, T3):** full backend `api` group green, targeted clients + stats
  suites green, `[Unreleased]` CHANGELOG bullet added. No production code beyond T2. The plan's
  lint/mypy steps were amended to non-gate by the architect — repo-wide pre-existing debt, identical on
  main and not CI-gated — and logged to the #149 auto-impl comment.

## Behavioral Delta (spec §3)

| # | Scenario | Before | After |
|---|----------|--------|-------|
| S1 | Negative value on any of the six filters (`min_records=-5`, …) | **200** — filter degraded to a silent SQL no-op (`records_count >= -5`) | **422** `{detail: {code, message}}` via the custom validation handler; frontend shows the generic «Проверьте правильность заполнения полей» toast |
| S2 | Zero (`missed_to=0`, …) | 200, filter applied | 200, unchanged (zero stays legal) |
| S3 | Existing positive/combined filters and no-filter requests | 200 | 200, unchanged — no other `/clients` behavior touched |

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | RED — parameterized ge=0 bounds tests | small | ✅ (`a55099e`) |
| T2 | GREEN — `Field(ge=0)` on the six fields | trivial | ✅ (`d90626a`) |
| T3 | Regression + CHANGELOG (lint/mypy amended to non-gate) | small | ✅ (`316971a`) |

## Test Results

- **Full backend `api` group:** **877 passed / 0 failed** (1325 deselected).
- **Targeted suites:** `test_api_clients.py` + `test_client_stats.py` — **164 passed / 0 failed**.
- **TDD RED→GREEN:** 13✗/6✓ RED at `a55099e` → targeted green at `d90626a`.
- **Visual gate:** N/A — backend-only change, no UI diff.
- **Acceptance (spec §8):** DoD checklist fully met; item 4 (lint/mypy clean) amended as above.

## Key Files Changed

- Production: `backend/src/schemas/client.py` (+11 / −6).
- Tests: `backend/tests/test_api_clients.py` (+37).
- Meta: `CHANGELOG.md` (+1), `docs/domain-rules/clients.md` (one-line filter-bounds note),
  `PLAN.md`, this status file.
- No frontend, no `packages/api-client`, no DB schema, no migrations.

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` `[Unreleased]` bullet added in `316971a` (not duplicated here).
- `docs/domain-rules/clients.md` Filters bullet now records the `ge=0` → 422 bound for the six numeric
  stat filters (GH #149).
- `PLAN.md` — completion line + Priorities table row added.

## Known Non-Blocking Observations

- Lint/mypy were intentionally not a gate for this branch: repo-wide pre-existing failures, identical on
  main, not CI-gated (architect decision; recorded on #149).
- The 422 body does not name the offending field (shared custom handler) — accepted trade-off, spec
  §2/§5.

## References

- **GitHub Issue**: #149
- **Design Spec**: `docs/specs/2026-09-17-client-filters-ge0-design.md` (on main)
- **Plan**: `docs/plans/2026-09-17-client-filters-ge0-plan.md` (on main)
- **PR**: _(to be added after PR creation)_
