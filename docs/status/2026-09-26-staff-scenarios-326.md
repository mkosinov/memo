# GH #326 — Staff-операции в сценарии (каскадный долг 2/3)

- **Date**: 2026-09-26
- **Branch**: `326-staff-scenarios`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `20b710f7` — 5 commits (`17cc91ed..41c0072a`), 19 files, +4072 / −1137
- **Issue**: #326 — staff-операции в сценарии (каскадный долг 2/3)
- **Spec**: `docs/specs/2026-09-21-staff-scenarios-326-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-21-staff-scenarios-326-plan.md` (5 tasks T1–T5)
- **Canon**: `docs/domain-rules/service-layer.md` (rev7 — rule 10 exception «операции сотрудников» снята)

## Goal

Cascade debt 2/3 (#171 was 1/3): the five staff write scenarios (create/update/patch/archive/delete)
move out of the `StaffService` composite into `backend/src/usecases/staff.py` (canonical corridor 2),
persistence ownership splits to the entity owners (`UserService` for users, `MasterService` for
masters), and the last rule-10 exception of `docs/domain-rules/service-layer.md` is retired (rev7).
Behavioral delta for the user: **NONE** — pure backend refactor, HTTP contracts / behavior / event
grids unchanged, frontend untouched.

## Summary of Changes (per task)

- **T1 — UserService (standard):** `UserService` becomes the owner of `users` persistence +
  the new `resolve_account_role` (user→master account-role resolution, ex-composite helper)
  (`17cc91ed`).
- **T2 — MasterService (standard):** `MasterService` becomes the writing owner of `masters`
  (master write ops re-homed out of the staff composite) (`30df7c17`).
- **T3 — scenarios (large):** `usecases/staff.py` — `create_staff` / `update_staff` /
  `patch_staff` / `archive_staff`; the `StaffService` composites are dismantled; the 8
  `mark_changed("masters"/"users")` calls in `services/staff.py` are gone (`b8671856`).
- **T4 — delete scenario (standard):** `delete_staff` scenario built on the shared core
  `_resolve_delete_core` (`f9610d0d`).
- **T5 — canon (small):** rule 10 exception «операции сотрудников» removed from
  `docs/domain-rules/service-layer.md` (rev7) (`41c0072a`, +2/−2).

## Test Results

- **pytest (full backend):** **2511 passed / 15 skipped / 0 failed**.
- **ruff:** 0 new findings on the changed files (repo baseline ~363–366 pre-existing, ratchet untouched).
- **mypy:** 0 new errors on the 6 files of #326 (44 vs 46 baseline — a clean decrease).
- **e2e staff-*.spec.ts:** not run locally — go to PR CI unmodified (`frontend/` untouched, so no
  e2e edits were needed).

## Acceptance Criteria

| Criterion | Status |
|---|---|
| All endpoint contracts / behavior / event grids unchanged | ✅ |
| Contract tests + e2e green WITHOUT contract edits | ✅ (e2e — PR CI, unmodified) |
| The 8 `mark_changed("masters"/"users")` in `services/staff.py` are gone | ✅ pinned by test |
| Canon rule 10 exception removed (rev7) | ✅ T5 (`41c0072a`) |

## Key Files Changed

- `backend/src/services/user.py` — `UserService` owner of users + `resolve_account_role` (T1)
- `backend/src/services/master.py` — `MasterService` writing owner of masters (T2)
- `backend/src/usecases/staff.py` — scenarios create/update/patch/archive/delete (T3/T4)
- `backend/src/services/staff.py` — composites dismantled, foreign `mark_changed` calls gone (T3)
- `backend/src/api/v1/staff.py`, `backend/src/services/generic.py`, `backend/src/events/entities.py` — rebinding (T3)
- Tests: new `backend/tests/usecases/test_staff_create.py` / `_update_patch.py` / `_archive.py` / `_delete.py`, `backend/tests/services/test_user_service.py` (new), `test_master_service.py` (+441), `test_staff_service.py` (−~715 → owner-service scope), `test_events_emit.py` / `test_events_entities.py` / `generic_contract.py` re-bound (T1–T4)
- `docs/domain-rules/service-layer.md` — rev7 (T5)

## Docs Impact

- `PLAN.md` — completion blockquote in the header (this docs commit).
- `CHANGELOG.md` — new entry under `[Unreleased] — 2026-09-26` → `### Changed` (this docs commit).
- Spec/plan pre-existing on main, unchanged by IMPL.

## Behavioral Delta

None — internal refactor; nothing changes for the user.

## References

- **GitHub Issue**: #326
- **Design Spec**: `docs/specs/2026-09-21-staff-scenarios-326-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-21-staff-scenarios-326-plan.md`
- **Canon**: `docs/domain-rules/service-layer.md` (rev7)
- **Related**: #171 (каскадный долг 1/3 — usecases для записей), #217 (corridor 3 / composite reads)
- **PR**: _(to be added after PR creation)_
