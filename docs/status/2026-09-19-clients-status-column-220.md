# GH #220 — Clients table status column «Статус» (архив/активен) + unified hidden-by-default status columns

- **Date**: 2026-09-19
- **Branch**: `220-clients-status-column`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `5d3a22d1` (main) — 4 commits (`0fd4bb88..9a251ab3`), 12 files, +710 / −12
- **Issue**: #220 — колонка «Статус» (архив/активен) в таблице клиентов + унификация статус-колонок
- **Spec**: `docs/specs/2026-09-19-clients-status-column-220-design.md` (on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-clients-status-column-220-plan.md` (3 tasks, on main, unchanged by IMPL)

## Summary of Changes

Frontend-only (`frontend/admin`; backend, migrations, api-client untouched — `archived` is already
in `ClientWithStats`):

- `frontend/admin/app/(main)/clients/components/clientColumns.tsx`: new last column (after
  «Сумма оплат») `archived` — label «Статус», `defaultVisible: false`, `sortable: false`
  (server sort whitelist has no `archived`; badge-column precedent `#139` §6.2), inline badge
  on CSS variables (serviceColumns pattern, not the locations Tailwind palette), text
  «Активен» / «Архив».
- `frontend/admin/app/globals.css`: AA contrast adjustment of the status token pairs
  (WCAG 2.2 AA ≥ 4.5:1 at 12px) — light: `--ink-light` `#888888` → `#5f5f65`,
  `--success` `#6B8E6E` → `#2f6b2f`, new `--success-bg` `#dcfce7`; dark: `--ink-light`
  `#777780` → `#9c9ca5`, `--success` `#8fd18f`, `--success-bg` `#1f2f24`. Verified live:
  light 5.86 / 5.77, dark 7.84 / 4.82.
- `frontend/admin/app/(main)/staff/components/staffColumns.tsx`: column «Архив»
  (`status`) `defaultVisible: true → false`.
- `frontend/admin/app/(main)/services/components/materialsColumns.tsx`: column «Статус»
  (`archived`) `defaultVisible: true → false` — one unified rule across archivable entities.

Tests: `ClientsTable.test.tsx` +4 (picker enable, badge↔`row.archived` mapping, non-sortable
header), new `clientColumns.test.tsx` (config contract), `staffColumns.test.tsx` /
`materialsColumns.test.tsx` (new, `defaultVisible: false` pins), `StaffTable.test.tsx`
«shows default visible columns» reworked (no longer expects «Архив» by default),
`MaterialsTable.test.tsx` updated; e2e `staff-crud.spec.ts` default-header set updated (the
archive-badge test enables the column via the picker). New e2e
`frontend/admin/e2e/clients-status-column.spec.ts` — 3 scenarios: picker enable + badges,
deep-link `/clients?clientId=` to an archived client, badge flip «Активен»→«Архив» on
archive (and back on restore) without reload with status filter «Все» (seed via
`createTestClient` + `POST /api/v1/clients/{id}/archive`, pattern of
`client-phone-typeahead.spec.ts`).

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Clients «Статус» column + AA token adjustment + unit tests | small | ✅ (`0fd4bb88`) — review: compliance ✅ |
| T2 | Staff/Materials `defaultVisible → false` + config/unit tests + staff-crud e2e header | small | ✅ (`93b9ed65`, `9e91e47c`) — review: compliance ✅ |
| T3 | E2E `clients-status-column.spec.ts` (3 scenarios) | standard | ✅ (`9a251ab3`) — review: compliance ✅ + quality ✅ |

## Test Results

- **admin vitest full suite:** **2181 passed / 0 failed** (incl. 12 new/updated tests across
  ClientsTable / clientColumns / StaffTable / staffColumns / MaterialsTable / materialsColumns).
- **e2e:** `clients-status-column.spec.ts` — **3/3 green** standalone; `staff-crud.spec.ts` —
  **15/15 green** (shard). Full e2e run = PR CI (authoritative).
- **tsc** clean, **lint** clean.
- **Visual gate:** passed (screenshots `/tmp/opencode/e220-*.png` — not committed); badge
  contrast ≥ 4.5:1 verified live (light 5.86/5.77, dark 7.84/4.82).

## Acceptance Criteria

| Spec scenario | Level | Status |
|---|---|---|
| §1 — column off by default, picker enable shows «Активен»/«Архив» badges | e2e + unit | ✅ |
| §2 — deep-link to archived client (row visible, badge «Архив») | e2e | ✅ |
| §3 — badge flip on archive/restore without reload (filter «Все») | e2e | ✅ |
| §5 — consistency with the status filter | unit + e2e | ✅ |
| §6 — unified hidden-by-default status columns (staff, materials) | unit + e2e (staff-crud) | ✅ |
| Badge contrast ≥ 4.5:1 (WCAG 2.2 AA) | live token check | ✅ |

All plan DoD items green.

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` — `[Unreleased] — 2026-09-19` bullet added.
- `PLAN.md` — completion blockquote + Priorities table row added.
- `docs/design-system.md` — untouched: token structure unchanged (values only, `--success-bg`
  added alongside the existing pair).

## References

- **GitHub Issue**: #220
- **Design Spec**: `docs/specs/2026-09-19-clients-status-column-220-design.md`
- **Plan**: `docs/plans/2026-09-19-clients-status-column-220-plan.md`
- **PR**: _(to be added after PR creation)_
