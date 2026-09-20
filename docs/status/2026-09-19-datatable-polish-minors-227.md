# GH #227 — DataTable polish minors: screen-reader guard announcement + full file=export naming convention

- **Date**: 2026-09-20 (work dated 2026-09-19)
- **Branch**: `227-datatable-polish-minors`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `8b18b548` (main) — 3 commits (`7507fc9c..5aa7156f`), 9 files, +85 / −22
- **Issue**: #227 — отложенные миноры ревью #139: page-clamp, конвенция нейминга `*Columns.tsx`, озвучка гарда пикера
- **Spec**: `docs/specs/2026-09-19-datatable-polish-minors-227-design.md` (rev2, Gate B decisions recorded; on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-datatable-polish-minors-227-plan.md` (4 tasks, on main, unchanged by IMPL)

## Summary of Changes

Frontend-only (`frontend/admin`; backend, migrations, api-client, e2e untouched — zero visible
behavior change by design):

- `frontend/admin/app/components/shared/ColumnPicker.tsx`: the last-visible-column guard is now
  announced to screen readers — each item renders as a `<Fragment>` (label unchanged; when the
  guard is active, `disabled = checked && visibleKeys.length === 1`) followed by an sr-only span
  «Последняя видимая колонка — скрыть нельзя», and the guarded checkbox gets
  `aria-describedby` pointing at it (`useId()` + column key → unique across two tables on a
  page). Accessible name untouched — the #139 §6.5 decision (no `disabled`/`aria-disabled`,
  tags-crud e2e stays unedited) remains in force; unguarded items get no attribute and no span.
- `frontend/admin/app/(main)/services/components/materialsColumns.tsx` → `materialColumns.tsx`
  (`git mv`, export `materialColumns` unchanged); prod importer `MaterialsTable.tsx` updated.
- `frontend/admin/app/(main)/records/components/recordsColumns.tsx` → `recordColumns.tsx`
  (`git mv`, export `recordColumns` unchanged); prod importer `RecordsTable.tsx` + test
  importers `recordsColumns.test.tsx` and `recordsTimeParity.test.ts` updated — import lines
  only.
- `frontend/admin/__tests__/materialsColumns.test.tsx`: import line fixed beyond the plan
  (plan listed only the two records test importers; this file imports `materialColumns` too —
  plan gap, minimal necessary edit).

Tests: `ColumnPicker.test.tsx` +2 cases (§5.3): guard active (one visible column) — the guarded
checkbox has `aria-describedby`, the element by that id carries the exact guard text, unguarded
items have no attribute, control check `getByRole('checkbox', { name })` finds the clean column
name; guard inactive (two+ visible) — no `aria-describedby`, no sr-only spans in the DOM.

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | ColumnPicker guard announcement (aria-describedby + sr-only) + 2 unit cases | small | ✅ (`7507fc9c`) |
| T2 | Rename materialsColumns → materialColumns (+ MaterialsTable import) | trivial | ✅ (`fac02577`) |
| T3 | Rename recordsColumns → recordColumns (+ RecordsTable + 3 test import lines) | trivial | ✅ (`5aa7156f`) |
| T4 | Final verification (vitest/lint/tsc/build + tags-crud e2e) | trivial | ✅ |

## Test Results

- **admin vitest full suite:** **2193 passed / 0 failed** (139 files; baseline 2181 + 2 new
  ColumnPicker cases, suite otherwise unmodified).
- **lint:** 0 errors / 37 pre-existing warnings (gate `--max-warnings 38`).
- **tsc --noEmit** clean, **next build** OK (15/15 pages).
- **e2e:** `tags-crud.spec.ts` — **11/11 green** standalone (anchor of the guard regression);
  full e2e run = PR CI (authoritative).
- **Visual gate:** skipped by design — sr-only is `position:absolute` (out of layout, zero
  visible delta); the visual-regression suite on PR CI is the authoritative check, snapshot
  regeneration protocol = spec S2 if drift appears.

## Acceptance Criteria

| Plan DoD | Level | Status |
|---|---|---|
| T1 — new unit cases green, existing suite green **unmodified** (incl. `DataTable.test.tsx` `getByLabelText('Тег')`) | unit | ✅ |
| T2 — file=export convention holds for the services folder; materials units green unedited; build green | unit + build | ✅ |
| T3 — file=export holds for all nine `*Columns.tsx`; records test files green with import-line-only edits | unit | ✅ |
| T4 — vitest/lint/typecheck/build green; `tags-crud` e2e green locally | full run | ✅ |
| S2 — visible behavior unchanged (guard opacity/cursor/no-op, accessible names) | e2e + unit (unedited) | ✅ |

All plan DoD items green. Issue point 1 (page-clamp) was out of scope — closed by fact, already
implemented and tested in #139.

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` — `[Unreleased] — 2026-09-19` bullet added.
- `PLAN.md` — completion blockquote + Priorities table row added.

## References

- **GitHub Issue**: #227
- **Design Spec**: `docs/specs/2026-09-19-datatable-polish-minors-227-design.md`
- **Plan**: `docs/plans/2026-09-19-datatable-polish-minors-227-plan.md`
- **PR**: _(to be added after PR creation)_
