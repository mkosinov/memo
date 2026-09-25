# GH #341 — Fixed seed-photo `created_at`: calendar-independent photos visual baselines

- **Date**: 2026-09-21
- **Branch**: `341-photos-seed-fixed-dates`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `582c3a3e` (main) — 3 commits (`64c25d7d..d527e5b7`), 2 source files +76 / −7 + 4 PNG baselines
- **Issue**: #341 — visual-базлайны с сид-датами падают при UTC-rollover, photos-table кейс #138
- **Spec**: `docs/specs/2026-09-20-photos-seed-fixed-dates-341-design.md` (on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-20-photos-seed-fixed-dates-341-plan.md` (4 tasks, on main, unchanged by IMPL)

## Summary of Changes

Test-infra only (seed + pytest + Playwright snapshots; production code, API and DB schema untouched):

- `backend/src/seed/seed.py`: new `PHOTO_FIXED_DATES: dict[str, datetime]` next to
  `WEEK_FIXED_START` — ph1 → `datetime(2026, 6, 15, 12, 0, 0)`, …, ph7 →
  `datetime(2026, 6, 21, 12, 0, 0)` (rising consecutive days, noon, naive literals — the DB column
  is naive, an aware object would fail the insert). Each of the 7 photo dicts in `_seed_photos`
  receives `created_at=PHOTO_FIXED_DATES[p["id"]]`, so the `AbstractModel.created_at =
  datetime.utcnow` default no longer fires for seed photos. Other fields (owners, tags,
  `is_public`) unchanged.
- `backend/tests/test_seed.py`: new `test_seed_photos_fixed_dates` guard — after `seed_data` it
  reads `SELECT id, created_at FROM photos ORDER BY id`, asserts all seven exact dates hardcoded as
  literals in the test (deliberately NOT imported from `PHOTO_FIXED_DATES`, otherwise a constant
  edit would silently pass), plus strict-rising (`dates == sorted(dates)`) and uniqueness
  (`len(set(dates)) == 7`) checks — the determinism contract behind the `created_at desc` feed order.
- `frontend/admin/e2e/visual-regression.spec.ts-snapshots/`: 4 affected baselines regenerated once —
  `photos-table-filled`, `photos-table-dropdown-open`, `photos-table-sort-active`,
  `photos-table-picker-open` (`shard-rest-linux`). `photos-table-empty` / `-skeleton` / `-error`
  have no rows in frame and were left untouched. Diff hygiene honoured — only `photos-table-*` PNGs
  were regenerated (precedent `550fe238`).

Why fixed: the photos table's «Дата» column renders `created_at`, which the seed previously left to
`datetime.utcnow` — a run whose seed executed after UTC midnight deterministically reddened the
photos baselines (real case: CI PR #335, run 35477565278). Pinning the photos to the same fixed
visual week (`2026-06-15…21`) already used for records and activities removes the calendar
dependency; rising dates keep the default `created_at desc` order stable (ph7 first, as before).

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Seed: fixed rising `created_at` for the 7 photos (`PHOTO_FIXED_DATES`) | small | ✅ (`64c25d7d`) |
| T2 | Unit guard `test_seed_photos_fixed_dates` (literals + rising/uniqueness) | small | ✅ (`1c5b43b1`) |
| T3 | One-off regeneration of affected photos baselines + diff hygiene | standard | ✅ (`d527e5b7`, 4 PNGs) |
| T4 | DoD verification: calendar-independence + clean runs | small | ✅ (no commit) |

## Test Results

- **pytest `tests/test_seed.py`:** **29/29** (28 existing + 1 new guard). Mutation-bite verified —
  perturbing the seed dates makes the guard fail.
- **e2e `visual-regression.spec.ts` update run (shard-rest):** **61/61**.
- **Functional photos e2e unedited:** `photos-crud.spec.ts` + `master-role-photos.spec.ts` —
  **21/21** (S3: a UI-created photo still carries real «now» and lands first under DESC).
- **Clean photos runs:** **7/7 green twice**, including after a full shard-DB wipe + reseed
  (S2/S4 — fixed dates and stable row order).
- **Known local-only reds:** 14 non-photos visual tests fail locally under the pre-existing
  local-env anonymous-render condition — unrelated to #341; main CI is green.

## Acceptance Criteria

| Plan DoD / Scenario | Level | Status |
|---|---|---|
| Issue DoD 1 — visual specs with seed dates green at any time of day | construction | ✅ (see note) |
| Issue DoD 2 — `photos-table` baselines from #335 (`550fe238`) replaced by calendar-independent ones | e2e | ✅ |
| Issue DoD 3 — no overlap with glyph/env drift class (#307/#182, both closed) | analysis | ✅ |
| S1 — full shard-rest run green at any time of day | e2e | ✅ (clean photos runs) |
| S2 — two runs on different days/machines give the same photos row order | e2e | ✅ |
| S3 — admin uploads a new photo → first row; search/filters unchanged | e2e (unedited) | ✅ |
| S4 — after the one-off regen, baselines need no update on the next calendar day | e2e | ✅ |
| S5 — seed-date edit caught by the unit guard, not red CI | unit | ✅ |

**Note on the cross-midnight DoD point:** the manual run starting before 00:00 UTC and crossing the
day boundary was infeasible in-window (start UTC 07:43, ~16 h to midnight). Calendar-independence is
instead verified by construction: the spec pins the browser clock to `2026-06-15` via `page.clock`,
and the regenerated baselines contain only fixed June-2026 dates — there is no wall-clock-dependent
value left in the photos frame. Residual limitations stay out of scope as designed (no tie-breaker
on equal `created_at` in prod sorting; browser timezone not pinned in the Playwright config).

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` — `[Unreleased] — 2026-09-21` → `### Test Infra` bullet added.
- `PLAN.md` — completion blockquote row added.
- This status file added.

## References

- **GitHub Issue**: #341
- **Design Spec**: `docs/specs/2026-09-20-photos-seed-fixed-dates-341-design.md`
- **Plan**: `docs/plans/2026-09-20-photos-seed-fixed-dates-341-plan.md`
- **Precedent**: `550fe238` (previous photos baseline refresh on UTC-day rollover)
- **PR**: _(to be added after PR creation)_
