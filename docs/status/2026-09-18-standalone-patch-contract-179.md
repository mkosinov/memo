# GH #179 — standalone PATCH mini-contract for Visits and UserSettings

- **Date**: 2026-09-18
- **Branch**: `feat/179-standalone-patch-contract`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `ef94a674` (main) — 8 commits (`ef94a674..3e9bbc98`), 7 files, +590 / −80
- **Issue**: #179 — «Дедуп generic PATCH-тестов Visits/UserSettings (standalone-сервисы)» (app:core)
  — closes open question 3 of the #175 spec (PR #181, merged 2026-07-28)
- **Spec**: `docs/specs/2026-09-18-standalone-patch-contract-design.md` (rev3, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-standalone-patch-contract-plan.md` (4 tasks, on main, unchanged by IMPL)

## Summary of Changes

- **Production fix (spec §3.1, Behavioral Delta):** `backend/src/services/visit.py` →
  `VisitService.patch`:
  - (a) explicit `null` on the NOT NULL fields `price` / `status` is stripped ("don't change") —
    the `UserSettingsService` technique (local NOT NULL set before `setattr`); previously `null`
    reached flush, the DB raised `IntegrityError`, and the global handler returned HTTP 422
    `INTEGRITY_VIOLATION` aborting the WHOLE request (all other sent fields were lost);
  - (b) an empty PATCH is a full no-op — early exit after `model_dump(exclude_unset=True)` with no
    field set: no `updated_at` write, no `recompute_record_status` cascade, no `mark_changed`
    (`records` SSE event).
  - Nullable `visitor_id` / `tariff_id` / `custom_price` still apply an explicit `null` (clears the
    field) — unchanged, already canonical.
  - `GenericService` inheritance is NOT introduced (hard constraint, spec §4).
- **Contract test:** new `backend/tests/services/test_standalone_patch_contract.py` — a service-level
  (no HTTP) parametrized mini-contract for the two GH #239 standalone transactional services, modeled
  on the #175 `EntityConfig` pattern but with **two explicit configs, no auto-discovery and no
  inheritance**: `PatchContractConfig(service_factory, patch_schema, patch_call, read_state,
  not_null_fields, nullable_field, list_fields, patch_field, original, sentinel, make_owner,
  apply_null)`. It pins the same 5 patch semantics as the generic contract + the sentinel guard
  (`test_sentinel_differs_from_original`).
- **Dedup of private test files (spec §3.4):** deleted the pure duplicates —
  `test_visit_service.py::test_visit_service_patch_partial`,
  `test_api_user_settings.py::test_patch_language_only`, and the whole
  `test_user_settings_patch.py::TestUserSettingsPatchSemantic` class (−78 lines). HTTP anchors
  (route wiring 200/404), cascade/`seats`, archived-visibility, and own-only (`test_user_settings_auth.py`)
  are kept untouched.
- **Domain-rules:** `docs/domain-rules/visits.md` PATCH bullet now states the exact null-policy
  (`null` on NOT NULL `price`/`status` ignored; `null` on nullable `visitor_id`/`tariff_id`/`custom_price`
  clears) and the empty-body no-op — aligned with the code and the `_overview.md` PATCH Contract canon
  (commit `3e9bbc98`). `_overview.md` itself was cross-checked and needed no change (its generic
  contract row remains correct; the two standalone services are covered by this mini-contract).

## Semantics × Service → covering test inventory (spec S5)

Service-level contract tests live in
`backend/tests/services/test_standalone_patch_contract.py`; HTTP anchors are the private API files.

| Semantics | Visits | UserSettings |
|---|---|---|
| Partial update (sentinel lands, every other field keeps pre-state) | contract `TestStandalonePatchContract::test_patch_partial_update_applies_sentinel_keeps_pre_state[visits]` + HTTP anchor `test_api_visits.py::TestVisitPatch::test_patch_visit_partial` (200 wiring) | contract `…test_patch_partial_update_applies_sentinel_keeps_pre_state[user_settings]` + HTTP anchor `test_api_user_settings.py::TestPatchSettings::test_patch_theme_only` (200 wiring, `UserSettingsPatch`) |
| Not-found → service returns `None` (API 404) | contract `…test_patch_not_found_returns_none[visits]` + HTTP anchor `test_api_visits.py::TestVisitPatch::test_patch_visit_not_found_404` | contract `…test_patch_not_found_returns_none[user_settings]` + HTTP anchor `test_api_user_settings.py::TestPatchSettings::test_patch_not_found_404` |
| Real patch bumps `updated_at` | contract `…test_patch_bumps_updated_at[visits]` | contract `…test_patch_bumps_updated_at[user_settings]` |
| Null-policy — NOT NULL field ignored | contract `…test_patch_null_on_not_null_price_status_is_ignored[visits]` (`price`, `status`) | contract `…test_patch_null_on_not_null_field_is_ignored[user_settings-theme / -language / -show_archived_masters / -show_archived_locations]` |
| Null-policy — nullable field applied (cleared) | contract `…test_patch_null_on_nullable_field_is_applied[visits]` (`custom_price`) | capability skip — `UserSettingsPatch` has no nullable field |
| Null-policy — list fields (`null` ignored, `[]` applied) | capability skip — `VisitPatch` has no list fields | contract `…test_patch_list_fields_null_ignored_empty_applied[user_settings]` (`column_order_staff`, `column_order_locations`) |
| Empty body = full no-op (fields AND `updated_at`) | contract `…test_patch_empty_body_is_full_noop[visits]` | contract `…test_patch_empty_body_is_full_noop[user_settings]` + HTTP anchor `test_api_user_settings.py::TestPatchSettings::test_patch_empty_body_noop` |
| Service-specific behavior (kept, untouched) | `test_api_visits.py::TestVisitPatch::test_patch_visit_status_cascades_to_record` (cascade → `record.status`), `…test_patch_visit_does_not_change_seats` (`seats` invariant) | `test_user_settings_patch.py::TestUserSettingsPatchArchivedVisibility` (3 tests), `test_user_settings_auth.py` (own-only guarantees) |

Guard: `test_sentinel_differs_from_original[visits]` / `[user_settings]` — fails loudly if a config's
sentinel equals its original (would make the partial-update contract vacuous) and validates that
configured fields exist in the patch schema, list fields are NOT NULL, and `nullable_field` is not in
`not_null_fields`.

## Behavioral Delta (spec §6)

| # | Scenario | Before | After |
|---|----------|--------|-------|
| S1 | PATCH visit with explicit `null` in `price` or `status` | **422** `INTEGRITY_VIOLATION`; the whole request failed, no field applied | Those fields are ignored as "don't change"; the other sent changes apply, HTTP 200 |
| S2 | Empty PATCH visit (no fields) | `updated_at` moved, `record.status` cascade ran, other screens got a `records` event | Full no-op, like every other entity |
| S3 | Nullable-field clearing (`custom_price`, `visitor_id`, `tariff_id`), PUT, form responses | unchanged | unchanged (no UI impact — the UI never sends `null` to required fields nor empty patches) |

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Contract skeleton + 3 semantics green on current code | standard | ✅ (`a0e25fbd`, `d6cf2bb4`, `8ebeae3c`) |
| T2 | Null-policy + empty-body RED → `VisitService.patch` fix → GREEN | standard | ✅ (`97886523` RED, `c8123502` fix, `700c6ddb` capability-skip/docstring) |
| T3 | Dedup private test files | small | ✅ (`85916209`) |
| T4 | `visits.md` PATCH null-policy wording | trivial | ✅ (`3e9bbc98`) |

## Test Results

- **Contract file:** `test_standalone_patch_contract.py` — **17 passed / 7 skipped / 0 failed**
  (24 collected; the 7 skips are capability skips: 4 Visits scalar-NOT-NULL probes, 1 UserSettings
  `price`/`status` probe, 1 UserSettings nullable probe, 1 Visits list-fields probe).
- **Full backend suite:** **2230 passed / 15 skipped / 0 failed** (baseline 2236/14 minus the 5
  deduped tests, plus 1 test reclassified from pass to skip by the capability skip).
- **Dedup verification:** `test_visit_service_patch_partial`, `test_patch_language_only`,
  `TestUserSettingsPatchSemantic` — absent from the tree.
- **Lint:** `ruff` clean on all changed files (9 pre-existing `I001` findings in
  `test_visit_service.py` untouched — out of scope).
- **Visual gate / Playwright:** N/A — backend-only change, no UI behavior change (spec §5).

## Acceptance Criteria

| Spec scenario | Status |
|---|---|
| S1 — contract parameterized 2 configs × 5 semantics | ✅ (24 collected, 17 green + 7 capability skips) |
| S2 — Visits null-policy + empty-body RED→GREEN | ✅ (`97886523` RED → `c8123502` GREEN) |
| S3 — dedup applied; removed test names absent; full suite green | ✅ |
| S4 — HTTP anchors (cascade/`seats`/archived/auth) intact and green | ✅ |
| S5 — semantics × service inventory maintained | ✅ (table above; also embedded in the PR description by the architect at finishing) |

## Key Files Changed

- Production: `backend/src/services/visit.py`, `backend/src/schemas/visit.py` (docstring null-policy wording).
- Tests: `backend/tests/services/test_standalone_patch_contract.py` (new),
  `backend/tests/services/test_visit_service.py`, `backend/tests/test_api_user_settings.py`,
  `backend/tests/test_user_settings_patch.py`.
- Docs: `docs/domain-rules/visits.md`.
- No frontend, no `packages/api-client`, no DB schema, no migrations, no E2E.

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` `[Unreleased] — 2026-09-18` bullet added.
- `PLAN.md` — completion blockquote + Priorities table row added.
- `docs/domain-rules/visits.md` — PATCH null-policy + empty-body wording (done in `3e9bbc98`,
  not re-edited by this status commit).
- `docs/domain-rules/_overview.md` — cross-checked: generic PATCH Contract section remains accurate;
  no edit required.

## Known Non-Blocking Observations

- The contract uses capability skips (7) rather than per-service test duplication — intended by the
  spec's two-explicit-config design; the count is pinned here so future drift is visible.
- `nullable_field` is `None` for UserSettings and `list_fields` is empty for Visits by design; the
  guard test enforces these relationships.
- Pre-existing `ruff I001` findings in `test_visit_service.py` are out of scope (baseline, untouched).

## References

- **GitHub Issue**: #179
- **Related contract**: `docs/specs/2026-07-28-generic-service-patch-contract-design.md` (#175, merged PR #181)
- **Design Spec**: `docs/specs/2026-09-18-standalone-patch-contract-design.md` (on main)
- **Plan**: `docs/plans/2026-09-19-standalone-patch-contract-plan.md` (on main)
- **PR**: _(to be added after PR creation)_
