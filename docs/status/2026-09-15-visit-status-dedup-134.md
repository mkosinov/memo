# GH #134 — VisitStatus enum dedup (backend): one canonical enum, zero raw status literals

- **Date**: 2026-09-15
- **Branch**: `refactor/visit-status-dedup-134`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `c671f20e` (#261 saving-toast) — 3 commits (`3d885223..adf02ec7`), 7 files, +28 / −29
- **Issue**: #134 — tech-debt: duplicate `VisitStatus` enum in the backend + raw status literals in prod code
- **Spec**: `docs/specs/2026-09-15-visit-status-dedup-design.md` (on main)
- **Plan**: `docs/plans/2026-09-15-visit-status-dedup-plan.md` (on main)

## Summary of Changes

- **Canon + duplicate removal (`3d885223`):** the single definition of `VisitStatus` stays in
  `backend/src/domain/visit_status.py`; the duplicate `class VisitStatus(str, enum.Enum)` is deleted from
  `backend/src/models/enums.py` — no alias, no re-export at the old location. Both schema importers
  (`backend/src/schemas/visit.py`, `backend/src/schemas/record.py`) are re-bound to
  `src.domain.visit_status` with a direct import (not via `record_visits`, per spec §2.1). In
  `schemas/record.py` the `RecordStatusFilter = Literal["waiting","visited","missed","cancelled"]`
  definition is removed and the filter field is annotated with `VisitStatus` directly. Other enums in
  `models/enums.py` (UserRole, RecordStatus, PaymentMethod, Channel, ArchiveStatus) are untouched —
  legacy `RecordStatus.CANCELLED = "cancelled"` intentionally remains (out of scope, spec §2.1/§4).
- **Raw-literal sweep (`0076911a`):** every raw status literal in production `backend/src` (outside enum
  definitions) now references an enum member — `services/client.py` (`Record.status == VisitStatus.MISSED`),
  `services/record.py` (`visit_item.get("status", VisitStatus.WAITING)`), `seed/seed.py` (16 seed-dict
  literals: 6 record + 10 visit). Members are used without `.value` — the `str` mixin keeps them valid
  strings for comparisons, defaults, SQLAlchemy binds and JSON serialization (spec §2.4).
- **Deliberately unchanged:** DB schema (status columns are plain `String(20)`, no SQL-enum, no
  migrations), tests (~200 string literals — wire format/test data, spec §2.2), alembic migration
  `4d5e6f7a8b9c` (executed migration, not edited), frontend `packages/domain/src/visit_status.ts` and
  e2e specs (separate copies, out of scope), `RecordStatus` legacy enum.

## Behavioral Delta

Only one, documented in spec §2.3 and plan «Behavioral Delta»:

- The records-by-status filter now also accepts the **upper-case member name** (`CANCELLED`) in addition
  to the lower-case value (`cancelled`); before the change `Literal` rejected it with **422**. Pydantic v2
  smart-mode `str`-enum validation; comparison happens by value (`VisitStatus.CANCELLED == "cancelled"`),
  the frontend sends lower-case only. One-way, harmless, not a regression.
- Everything else is unchanged: status lists/badges, record-status re-derivation on visit-status change,
  the «missed» counter in the clients list, activity occupancy, status pickers — S1–S7 anchors.

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Re-bind schemas to `src.domain.visit_status` + delete the duplicate enum | small | ✅ (`3d885223`, compliance ✅) |
| T2 | Sweep raw status literals in `backend/src` (services/client, services/record, seed) | small | ✅ (`0076911a`, compliance ✅) |
| T3 | Regression verification (pytest + e2e S1–S6) + CHANGELOG | standard | ✅ (`adf02ec7`, compliance ✅; quality review skipped — 4-line markdown-only diff, spot-checked) |

## User Scenarios (spec §3) — regression anchors, all green

| # | Scenario | Anchor | Status |
|---|----------|--------|--------|
| S1 | Admin sets visit status to «Посетил» → record-status badge is re-derived | `e2e/wave6-record-status-derived.spec.ts` | ✅ 4 passed |
| S2 | Admin sets record status via the picker on a record | `e2e/admin-changes-status.spec.ts` | ✅ 1 passed |
| S3 | Records list filter by status — server-side filtering | `e2e/records.spec.ts` | ✅ 23 passed |
| S4 | Status picker consistent across /records, activity modal, /clients | `e2e/wave6-status-shared.spec.ts` | ✅ 4 passed |
| S5 | Activity occupancy excludes cancelled records | `e2e/occupied-calc.spec.ts` | ✅ 1 passed |
| S6 | Visit status changed outside the UI → server re-derives record status | `e2e/records-view.spec.ts` | ✅ 8 passed |
| S7 | «Missed» counter in the clients list counts only `missed` | API: `backend/tests/test_client_stats.py` | ✅ 103 passed in the T2 run |

## Test Results

- **Full backend pytest:** **1960 passed / 0 failed / 8 skipped** (10m56s).
- **e2e anchors S1–S6:** **41 tests / 0 failed** — wave6-record-status-derived 4, admin-changes-status 1,
  records 23, wave6-status-shared 4, occupied-calc 1, records-view 8.
- **API anchor S7:** `test_client_stats.py` **103 passed / 0 failed** (T2 run).
- **Spec §5 grep criteria:** all four clean —
  `grep "VisitStatus" backend/src/models/enums.py` empty; `RecordStatusFilter` empty;
  `from src.models.enums import VisitStatus` empty; `class VisitStatus` exactly once
  (`backend/src/domain/visit_status.py`).
- **Visual gate:** N/A — backend-only change, no UI diff.
- **Acceptance (spec §5):** all 6 DoD items met — single enum definition, both schema importers re-bound,
  no raw literals in `backend/src` outside the allow-listed files, domain unit tests + full pytest green,
  S1–S6 green, API contract unchanged (existing API tests passed without edits).

## Key Files Changed

- Modified (prod): `backend/src/models/enums.py`, `backend/src/schemas/visit.py`,
  `backend/src/schemas/record.py`, `backend/src/services/client.py`, `backend/src/services/record.py`,
  `backend/src/seed/seed.py`.
- Meta: `CHANGELOG.md` (`adf02ec7`), this status file.
- No test files, no migrations, no frontend changes.

## Docs Impact

- Spec + plan live on main and were not touched on this branch (only impl + meta).
- `CHANGELOG.md` `[Unreleased] — 2026-09-15` entry added in `adf02ec7` (not duplicated here).
- No domain-rules change: visit/record status semantics are identical (refactor only, spec §3).

## Known Non-Blocking Observations

- T3's quality review was skipped by design: the only diff in that commit is a 4-line markdown CHANGELOG
  entry, spot-checked against the file format.
- The `CANCELLED`/`cancelled` acceptance delta is intentional and recorded in spec §2.3 — it is the sole
  outward-facing difference of this refactor.
- The two same-named `VisitItem` classes (`schemas/record.py`, `domain/visit_status.py`) remain a known
  name collision, explicitly out of scope (spec §4).

## References

- **GitHub Issue**: #134
- **Design Spec**: `docs/specs/2026-09-15-visit-status-dedup-design.md` (on main)
- **Plan**: `docs/plans/2026-09-15-visit-status-dedup-plan.md` (on main)
- **PR**: _(to be added after PR creation)_
