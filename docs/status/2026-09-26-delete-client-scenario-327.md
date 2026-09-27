# GH #327 — Каскадный долг 3/3: удаление клиента в сценарии delete_client

- **Date**: 2026-09-26
- **Branch**: `327-delete-client-scenario`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `4f08ff74` — 5 commits (`3604bd4a..ea52de9e`), 15 files, +1391 / −113
- **Issue**: #327 — каскадный долг 3/3: удаление клиента в сценарии
- **Spec**: `docs/specs/2026-09-26-delete-client-scenario-327-design.md`
- **Plan**: `docs/plans/2026-09-26-delete-client-scenario-327-plan.md` (5 задач T1–T5)
- **Canon**: `docs/domain-rules/service-layer.md` (rev8 — rule 10, строка клиентского каскада снята)

## Goal

Cascade debt 3/3 (#171 was 1/3, #326 was 2/3): client deletion moves out of the `ClientService`
composite into `backend/src/usecases/clients.py::delete_client` (canonical corridor 2),
persistence ownership splits to the entity owners — visitor visits are bulk-destroyed by their
owner (`VisitService.delete_visits_by_visitor` via set-based `VisitRepository.delete_by_visitor_id`),
`VisitorService._delete_cascade` becomes own-edge (tags + row), and the client gets its own
repository (`ClientRepository.delete_tags_by_client_id`) with the own-edge brick
`ClientService.delete_row_with_tags`. The last cascade line of rule 10 in
`docs/domain-rules/service-layer.md` is retired (rev8). Behavioral delta for the user:
**NONE** — byte-for-byte parity of the HTTP contract, DB effects, SSE event grid, and atomicity;
frontend untouched.

## Summary of Changes (per task)

- **T1 — пачковые кирпичи визитов (small):** `VisitRepository.delete_by_visitor_id`
  (set-based bulk delete) + `VisitService.delete_visits_by_visitor` — the visits owner
  destroys its rows in one statement (`3604bd4a`).
- **T2 — own-edge VisitorService (small):** `VisitorService._delete_cascade` narrowed to the
  own edge (visitor_tags + the visitor row); standalone visitor delete composites the visits
  brick before its core — parity of DB effects and event grid (`1b7fcd34`). Statement-level RED
  anchor — architect-approved: FK `ON DELETE CASCADE` makes a row-level pre-check unsatisfiable.
- **T3 — own-edge клиента (small):** new `ClientRepository` with `delete_tags_by_client_id`;
  own-edge brick `ClientService.delete_row_with_tags` (undecorated, no audit labels); service
  factory re-bound onto the specialized repository (`bc7b8e10`).
- **T4 — сценарий + роут + чистка реестров (standard):** `usecases/clients.py::delete_client` —
  selfless `@transactional`, executor-phase layout (resolve → owner bricks → client row)
  byte-parity to the old composite; the `DELETE /clients/{id}` execute branch rides the
  scenario; client CASCADE_HANDLERS in `domain/deletion.py` and the DI `_visitor_service`
  injection are dismantled (`f7a4104f`, two-stage review).
- **T5 — канон + полный прогон (small):** rule 10 client-cascade line removed from
  `docs/domain-rules/service-layer.md` (rev8) (`ea52de9e`).

## Gate C — Decision Record

`test_client_cascade_delete_leaves_visitors_silent` (`backend/tests/test_audit_explicit.py`)
called the service-level `resolve_delete` directly. With the cascade logic dismantled into the
scenario + owners, the test was migrated (~5 lines) to the scenario entry point — **sanctioned
by the user at Gate C**. Intent preserved: the audit journal stays silent for cascade children
(«одно действие — одна строка»). This is the single parity exception; all other contract/effect
tests pass without edits.

## Review Pipeline Outcomes

- **Spec:** panel 6/6 (rev2 — clients event-grid blocker contributed), plan-reviewer
  APPROVED_WITH_MINORS, обе правки внесены (`77646f5e`).
- **T4:** two-stage review (`f7a4104f`).
- **T2:** statement-level RED anchor — architect-approved deviation (FK `ON DELETE CASCADE`
  makes a row-level check unsatisfiable before the delete fires).
- **Lint/mypy:** no new findings vs baseline.

## Test Results

- **pytest (full backend):** **2721 passed / 15 skipped / 0 failed** (T5, detached run, EXIT:0).
- **Targeted T4 sweeps:** 730/0, 247/0, 96/0.
- **ruff / mypy:** 0 new findings vs baseline.
- **e2e:** CI-phase (PR) — `frontend/` untouched, no e2e edits needed.

## Acceptance Criteria

| Criterion | Status |
|---|---|
| Client deletion lives in `usecases/clients.py::delete_client`; route execute branch on the scenario | ✅ (T4) |
| Visits destroyed by their owner via a bulk set-based method | ✅ (T1) |
| `VisitorService` / `ClientService` own-edge only; client CASCADE_HANDLERS + DI `_visitor_service` gone | ✅ (T2/T3/T4) |
| Byte-for-byte parity: HTTP contract, DB effects, SSE grid, atomicity | ✅ (single sanctioned audit-test migration at Gate C) |
| Canon rule 10 client-cascade line removed (rev8) | ✅ T5 (`ea52de9e`) |

## Key Files Changed

- `backend/src/usecases/clients.py` — new `delete_client` scenario (T4)
- `backend/src/repositories/client.py` — new `ClientRepository.delete_tags_by_client_id` (T3)
- `backend/src/repositories/visit.py` — `delete_by_visitor_id` (T1)
- `backend/src/services/visit.py` — `VisitService.delete_visits_by_visitor` (T1)
- `backend/src/services/visitor.py` — own-edge `_delete_cascade` (T2)
- `backend/src/services/client.py` — `delete_row_with_tags` brick, factory rebind (T3)
- `backend/src/api/v1/clients.py` — execute branch on the scenario (T4)
- `backend/src/domain/deletion.py` — client CASCADE_HANDLERS dismantled (T4)
- Tests: new `backend/tests/usecases/test_clients_delete.py`; updated `test_client_service.py`,
  `test_visit_service.py`, `test_visitor_service.py`, `test_repository_bulk_commands.py`,
  `test_audit_explicit.py` (sanctioned migration)
- `docs/domain-rules/service-layer.md` — rev8 (T5)

## Docs Impact

- `PLAN.md` — completion blockquote in the header (this docs commit).
- `CHANGELOG.md` — new entry under `[Unreleased] — 2026-09-26` → `### Changed` (this docs commit).
- Spec/plan pre-existing on main, unchanged by IMPL.

## Behavioral Delta

None — internal refactor; nothing changes for the user.

## Follow-ups

- #375, #378 — start after merge (out of scope for #327).

## References

- **GitHub Issue**: #327
- **Design Spec**: `docs/specs/2026-09-26-delete-client-scenario-327-design.md`
- **Plan**: `docs/plans/2026-09-26-delete-client-scenario-327-plan.md`
- **Canon**: `docs/domain-rules/service-layer.md` (rev8)
- **Related**: #171 (каскадный долг 1/3 — usecases для записей), #326 (2/3 — staff-операции)
- **PR**: _(to be added after PR creation)_
