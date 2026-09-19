# GH #203 — ServiceModal: NULL max_age → 0 blocked edit-save on open-ended services

- **Date**: 2026-09-19
- **Branch**: `service-modal-null-max-age-203`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `514a2b96` (main) — 3 commits (`1d8f97d0..4aa19858`), 7 files, +676 / −21
- **Issue**: #203 — ServiceModal: NULL max_age → 0 блокирует edit-save на open-ended услугах
- **Spec**: `docs/specs/2026-09-18-service-modal-null-max-age-design.md` (rev4, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-service-modal-null-max-age-plan.md` (3 tasks, on main, unchanged by IMPL)

## Summary of Changes

Client-only fix (3 production files; server, migrations, api-client untouched — schemas already
`int | None`):

- `frontend/admin/app/(main)/services/components/ServiceModal.tsx`:
  - init: `max_age: null` → `''` (fixed explicit field list — `max_age` only, NOT driven by a
    `required` flag; `min_age` keeps its 0-init);
  - validate: cross-rule «Возраст от ≤ Возраст до» fires only when BOTH values are filled
    (`value !== '' && value != null`, no truthy checks — `0` is a valid value); the 0–18 range
    check already passed empty values — untouched;
  - validate + render: tariff item walk over their field configs (`itemFields`: required / min /
    max — the same mechanics as top-level fields) with the error text under the matching item
    field (client-side required validation for tariff fields — user variant B, Gate C 2026-09-19);
  - submit: `'' → null` normalization for `max_age` only (per the `MyDataModal` pattern, not
    generically for all fields);
  - `FieldRenderer`: `placeholder` pass-through into the numeric input (mandatory edit, not
    conditional — plan-reviewer MINOR 1); accepted limitation: composite tariff-item error keys
    (e.g. `tariffs.0.price`) are not cleared by top-level `handleChange` — they clear on the next
    submit (DoD tests do not cover this).
- `frontend/admin/app/(main)/services/components/ServicesTable.tsx`: edit-mapper
  (`handleEditSubmit`, PUT branch) no longer coerces `max_age` with `?? 18` (create branch
  untouched — passes the payload as is).
- `frontend/admin/app/(main)/services/components/serviceFields.tsx`: placeholder
  «без ограничения» in the `max_age` field config.

Tests: new `frontend/admin/__tests__/ServiceModal.test.tsx` (13 tests, spec §4.3–4.5, RED→GREEN)
and an edit-mapper unit added to the existing `frontend/admin/__tests__/ServicesTable.test.tsx`
(mock-mutations pattern was already there); new e2e
`frontend/admin/e2e/services-null-max-age.spec.ts` — smoke pair only (user decision, spec §4.1–4.2).

Docs: `docs/domain-rules/services.md` — `max_age` row now optional/nullable (`null` = no upper
bound, migration `275ba490cab8` parity), the stale zod reference (`max_age: min(0).max(18)`)
replaced with the live `maxAge: z.string().optional()` (`packages/domain/src/index.ts:47`);
0–18 remains documented as client-side form validation (commit `4aa19858`).

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Component tests (RED) + 3 client fixes (GREEN) | standard | ✅ (`1d8f97d0`) — review: compliance ✅ + quality ✅ |
| T2 | E2E smoke pair (spec §4.1–4.2) | small | ✅ (`71db2317`) — review: compliance ✅ |
| T3 | `docs/domain-rules/services.md` max_age row sync | trivial | ✅ (`4aa19858`) — no reviewers (trivial) |

## Test Results

- **admin vitest full suite:** **2160 passed / 0 failed** (baseline 2146 + 14 new: 13
  ServiceModal component tests + 1 edit-mapper unit).
- **e2e new spec:** `services-null-max-age.spec.ts` — **2/2 green**
  (`edit-save-null-max-age`, `clear-max-age-saves-null`), stable across two consecutive runs.
- **Visual gate:** no separate visual-regression script exists for this surface; the visual
  change (empty field + placeholder «без ограничения») is verified via the named e2e asserts
  (input value `''` + placeholder text). Standard `test:all` gate applies at finishing.

## Acceptance Criteria

| Spec scenario | Level | Status |
|---|---|---|
| §4.1 — edit-save a NULL max_age service | e2e `edit-save-null-max-age` | ✅ |
| §4.2 — clear max_age saves null | e2e `clear-max-age-saves-null` | ✅ |
| §4.3 — empty field on open + cross-rule only on filled values | component | ✅ |
| §4.4 — create/edit normalization (`'' → null`) | component | ✅ |
| §4.5 — tariff required validation (variant B) | component | ✅ |

## Known Non-Blocking Observations

- **Pre-existing, out of scope (discovered in Task 2), NOT fixed by this branch:** any ServiceModal
  edit-save PUTs `tag_ids: []` because the form never collects tags (`ServicesTable.tsx:80` sends
  `?? []`) — editing a service silently drops its tag links. A separate GitHub issue is to be filed
  by the architect; do not attribute this to #203.

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` — `[Unreleased] — 2026-09-19` bullet added.
- `PLAN.md` — completion blockquote + Priorities table row added.
- `docs/domain-rules/services.md` — max_age optional/nullable row + live zod rule (done in
  `4aa19858`, not re-edited by this status commit).

## References

- **GitHub Issue**: #203
- **Design Spec**: `docs/specs/2026-09-18-service-modal-null-max-age-design.md` (rev4)
- **Plan**: `docs/plans/2026-09-19-service-modal-null-max-age-plan.md`
- **PR**: _(to be added after PR creation)_
