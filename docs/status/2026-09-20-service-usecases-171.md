# GH #171 — Service Layer Usecases Refactor («оркестратор вместо трактора»)

- **Date**: 2026-09-20
- **Branch**: `171-service-usecases`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `8e949899` — 14 commits (`8e949899..c050aa5b`), 25 files
- **Issue**: #171 — Рефактор сервисного слоя: оркестратор вместо трактора
- **Spec**: `docs/specs/2026-09-18-service-usecases-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-19-service-usecases-plan.md` (8 tasks; status section appended)

## Summary of Changes

Zero user-visible behavior change. The four cross-entity record write scenarios moved out of
`RecordService` into the new `backend/src/usecases/` layer (canonical corridor 2 of
`docs/domain-rules/service-layer.md`):

- `backend/src/usecases/__init__.py`, `backend/src/usecases/records.py` (new) — four public
  `@transactional` scenarios (one transaction + one #239 event batch each), composed only of
  service/domain calls:
  - `create_record` — find-or-create client/visitor → record row → visit batch insert →
    recomputes → cache marks;
  - `update_record` / `patch_record` — visit replacement strictly in today's order:
    wipe → place recompute → capacity check → batch insert (interleaving mandatory);
  - `delete_record` — dependency collection, `expected`/`resolutions` snapshot check,
    cascade (visits → payments → `record_tags` → record row), `resolve_delete`;
    #285 deferred-delete contract untouched; new `StaleDependenciesError` in
    `domain/deletion.py` (pins: stale branch does not publish events).
- Repositories of owners got named bulk commands: `delete_by_record_id` for payments and
  visits, own-edge `record_tags` wipe in the records repository.
- Non-transactional service methods for scenarios: `PaymentService.delete_by_record`, visit
  wipe/insert helpers, `ClientService`/`VisitorService` find-or-create (behavior-preserving
  transfer, incl. the default channel).
- `RecordService` narrowed: reads (list/view/get/scope) + record-row ops only; foreign-ORM
  imports removed; service unit tests rebound to the scenarios.
- API routes call the scenarios; transport (422/409 codes, response shape) unchanged.

Tests: new `backend/tests/usecases/` package (4 modules — create, update/patch, delete,
atomicity); 4 atomicity tests pin that a mid-scenario step failure leaves no partial state.

Docs: `docs/domain-rules/service-layer.md` rev4 — canon marked implemented, live spec example
(corridors 1 and 2).

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Bulk commands in payment/visit/record repositories | standard | ✅ (`cb3ab90e`) |
| T2 | Non-transactional service methods | standard | ✅ (`c052ec18`) |
| T3 | usecases package + `create_record` | standard | ✅ (`8ad08e37`, `be9e897b`) — compliance ✅ |
| T4 | `update_record` / `patch_record` | standard | ✅ (`3bca48e6`, `123e6e1b`, `1223b22f`, `8d0291c2`) — compliance ✅ + quality minor closed (`1223b22f` conditional event-grid visits mark) |
| T5 | `delete_record` scenario | standard | ✅ (`e7809d72`, `b974f0f2`) — compliance ✅ + 2 quality minors closed (`b974f0f2` stale no-publish pin; dead-code checklist consumed by T6) |
| T6 | RecordService narrowing + test rebinding | small | ✅ (`f00a4147`) — compliance ✅ |
| T7 | Atomicity tests (4) | small | ✅ (`f34050c2`, `a60ce2e9`) — compliance ✅ + quality minor closed (`a60ce2e9` tautology fix) |
| T8 | Full regression + lint | trivial | ✅ (`c050aa5b`) |

## Test Results

- **Full backend suite:** **2324 passed / 0 failed / 15 skipped** (green run 2320p at
  `f00a4147` + verified narrow deltas: atomicity tests 4/4, lint-fix scoped scopes green).
- **API suites:** green WITHOUT test modifications — incl. the #285 deferred-delete set
  (expected / stale_dependencies / undo-window) — behavioral parity proven.
- **Lint:** ruff 365 findings vs main baseline 379 — **0 new findings** (`c050aa5b`).
- Atomicity: 4/4 green.

## Acceptance Criteria

| Plan DoD | Status |
|---|---|
| T1 — commands live in owner persistence, called only by own service | ✅ |
| T2 — no `@transactional` on scenario helpers; find-or-create unit tests green at new home | ✅ |
| T3 — US1: record-create API tests green unmodified; cache marks identical; `master_key` passed by route | ✅ |
| T4 — US2/US3: update/patch API sets green unmodified; `test_record_capacity_recheck.py` green | ✅ |
| T5 — US4: deferred-delete set green unmodified; #285 contract intact | ✅ |
| T6 — no foreign ORM imports in `services/record.py`; service tests green | ✅ |
| T7 — 4 atomicity tests green; mid-failure leaves base state | ✅ |
| T8 — all existing suites green unmodified; lint clean (0 new) | ✅ |

## Known Non-Blocking Observations

- Known exceptions from the canon remain documented debt (rule 10 of
  `docs/domain-rules/service-layer.md`): activity-delete cascade, staff operations, client
  delete visitor-cascade — out of #171 scope by design.

## Docs Impact

- `docs/plans/2026-09-19-service-usecases-plan.md` — `## Статус` section (8/8, commit map).
- `docs/domain-rules/service-layer.md` — rev4 header (implemented; scenarios live).
- `PLAN.md` — completion blockquote added.
- `CHANGELOG.md` — `[Unreleased] — 2026-09-20` entry added.

## References

- **GitHub Issue**: #171
- **Design Spec**: `docs/specs/2026-09-18-service-usecases-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-19-service-usecases-plan.md`
- **PR**: _(to be added after PR creation)_
