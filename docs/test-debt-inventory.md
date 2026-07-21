# Test-debt inventory

> Wave 0 GH issue hygiene pass.
> Generated: 2026-07-21.
> Base commit: `a73be12` (`main`).
> Goal: account for every disabled E2E / vitest test on `main`, replace `#XXX`
> placeholder references with real GH issue numbers, verify existing open issues,
> and produce a clean tracking surface for Wave 2 planning.

Scope: investigation + this doc + GH ops only. **No `.ts` / `.tsx` / `.py` / `.css`
/ `.js` source files were modified.** In-source annotation comments will be updated
in Wave 2 when each test is actually touched/un-skipped (per CLAUDE.md TDD rule).

## Summary

- **33 disabled tests total**: 32 E2E (`test.skip` / `test.fixme`) + 1 vitest (`it.skip`).
- **2 existing open issues cross-checked**: `#124`, `#125` — both still relevant; commented.
- **9 new GH issues created this pass**: `#156`–`#164`.
- **1 existing open issue confirmed as covering a `#XXX` test**: `#109` covers the
  `visual-regression.spec.ts:33` records-page snapshot drift (no new issue created).
- **1 issue cross-referenced as mislabel-led**: `#124` does NOT cover unified-rows
  stale-cache scenarios 10/15/15b — new tracking issue `#164`.

### By category

| category | count | rows | notes |
|---|---|---|---|
| feature-gap | 2 | #25 (→#109), #33 (→#163) | test mismatches impl / snapshot drift |
| flake | 1 | #2 (→#125) | status filter selector/timing |
| cascade-`#124` (openModal) — likely free win post-Wave-1 | 4 | #1, #3, #4, #5 (→#156, #157, #158) | un-skip + verify in Wave 2 |
| placeholder-fixed (new issue created) | 4 | #6, #7, #8, #9, #10, #11, #12, #13 (→#159, #160) | `#XXX` → real issue |
| mislabel-led (was #124, now #164) | 3 | #19, #20, #21 (→#164) | distinct root cause |
| backend-flake (already #155) | 1 | #24 (→#155) | verified open |
| Wave 2 backend refactor (out of scope) | 1 | #14 (→#124) | visitor PATCH consolidation |
| cond-skip — skip-when-condition | 7 | #1, #15, #16, #17, #18, #22, #23 | guard-pattern, no new issue |
| cond-skip wave6 — verification needed | 7 | #26, #27, #28, #29, #31, #32 (→#161) + #30 (→#162) | family issue |

(Counts overlap because some tests have multiple applicable categories — the
definitive view is the per-test table below.)

## Per-test inventory

| # | file:line | kind | annotation (current) | linked issue | state | category | triage verdict | suggested wave |
|---|---|---|---|---|---|---|---|---|
| 1 | activity-details-modal.spec.ts:219 | test.skip() (bare) | — (in `if (!activity) { test.skip(); return; }` after `openModal`) | #124 | open | cascade-`#124` | openModal failed → cond-skip; Wave 1 fixed openModal, re-verify | Wave 2 |
| 2 | clients.spec.ts:328 | test.skip | `[flaky: status filter selector/timing, tracked in #125]` | #125 | open (commented this pass) | flake | verified open; deferred status filter test | Wave 2 |
| 3 | modal-blur-footer.spec.ts:8 | test.fixme | `US-M10: ... [deferred: openModal dialog not opening, see GH issue #XXX]` | #156 | created this pass | cascade-`#124` (placeholder-fixed) | openModal fixed by #124 Wave 1 — likely free win | Wave 2 (cheap win) |
| 4 | modal-no-jump.spec.ts:8 | test.fixme | `US-M09: ... [deferred: openModal dialog not opening, see GH issue #XXX]` | #157 | created this pass | cascade-`#124` (placeholder-fixed) | same as #3 | Wave 2 (cheap win) |
| 5 | private-toggle-layout.spec.ts:8 | test.fixme | `US-M01: "Приватное" label stacked above selector [deferred: settings tab not found, see GH issue #XXX]` | #158 | created this pass | cascade-`#124` (placeholder-fixed) | may also be Settings-tab selector drift | Wave 2 (verify) |
| 6 | records.spec.ts:218 | test.fixme | `8. Click row — opens detail panel [deferred: pre-existing UI issue, see GH issue #XXX]` | #159 | created this pass | placeholder-fixed | row-click → detail panel heading mismatch / not wired | Wave 3 |
| 7 | records.spec.ts:286 | test.fixme | `10. Detail panel close button dismisses panel [deferred: cascade from test 8 ..., see GH issue #XXX]` | #159 | created this pass | placeholder-fixed | explicit cascade of #6 — same issue | Wave 3 |
| 8 | schedule-column-visibility.spec.ts:329 | test.fixme | `adding a master to filter makes its column appear` (+`FIXME: column mode dropdown toggle is unreliable`) | #160 | created this pass | placeholder-fixed | column-mode dropdown race — Topbar `handleColumnModeSelect` | Wave 3 |
| 9 | schedule-column-visibility.spec.ts:453 | test.fixme | `switching to locations mode and filtering shows only selected locations` | #160 | created this pass | placeholder-fixed | same as #8 | Wave 3 |
| 10 | schedule-column-visibility.spec.ts:512 | test.fixme | `location filter: adding location makes its column appear` | #160 | created this pass | placeholder-fixed | same as #8 | Wave 3 |
| 11 | schedule-day-view.spec.ts:108 | test.fixme | `column mode dropdown opens and shows two options` | #160 | created this pass | placeholder-fixed | same as #8 | Wave 3 |
| 12 | schedule-day-view.spec.ts:123 | test.fixme | `switching to "По локациям" changes column mode` | #160 | created this pass | placeholder-fixed | same as #8 | Wave 3 |
| 13 | schedule-day-view.spec.ts:141 | test.fixme | `switching to "По мастерам" changes column mode back` | #160 | created this pass | placeholder-fixed | same as #8 | Wave 3 |
| 14 | unified-rows.spec.ts:98 | test.skip | `waiting for PATCH /visitors (Wave 2 CRUD consolidation)` | #124 | open | — out of scope — | backend PATCH refactor — NOT test debt | Wave 4 (backend) |
| 15 | unified-rows.spec.ts:107 | test.skip() (bare) | — (in `if (!visitRow?.visitor_id) { test.skip(); return; }`) | — | cond-skip | cond-skip | skip-when seed r1 has no visitor | cond-skip (no new issue) |
| 16 | unified-rows.spec.ts:167 | test.skip() (bare) | — (in `if (tariffOptions.length < 2) { test.skip(); return; }`) | — | cond-skip | cond-skip | skip-when service has <2 tariffs | cond-skip (no new issue) |
| 17 | unified-rows.spec.ts:176 | test.skip() (bare) | — (in `if (!firstAltValue) { test.skip(); return; }`) | — | cond-skip | cond-skip | cascade of #16 | cond-skip (no new issue) |
| 18 | unified-rows.spec.ts:210 | test.skip() (bare) | — (in `if (!visitRow) { test.skip(); return; }`) | — | cond-skip | cond-skip | skip-when seed r2 has no visit | cond-skip (no new issue) |
| 19 | unified-rows.spec.ts:386 | test.skip | `[flaky: unified-rows stale-cache tab-client timeout, tracked in #124]` — **mislabel-led** | #164 | created this pass | mislabel-led | distinct root cause (stale-cache), NOT #124 | Wave 3 |
| 20 | unified-rows.spec.ts:585 | test.skip | same as #19 | #164 | created this pass | mislabel-led | same root cause | Wave 3 |
| 21 | unified-rows.spec.ts:643 | test.skip | same as #19 | #164 | created this pass | mislabel-led | same root cause | Wave 3 |
| 22 | unified-rows.spec.ts:823 | test.skip() (bare) | — (in `if (tariffOptions.length === 0) { test.skip(); return; }`) | — | cond-skip | cond-skip | skip-when no tariffs | cond-skip (no new issue) |
| 23 | unified-rows.spec.ts:833 | test.skip() (bare) | — (in `if (!firstOptionValue) { test.skip(); return; }`) | — | cond-skip | cond-skip | cascade of #22 | cond-skip (no new issue) |
| 24 | unified-rows.spec.ts:855 | test.skip | `pre-existing backend flake (GH #155): GET /payments/{id} non-OK immediately after POST ...` | #155 | open | backend-flake | verified open; explicit, no `#XXX` | Wave 3 (backend) |
| 25 | visual-regression.spec.ts:33 | test.fixme | `records page default state [deferred: screenshot diff (seed state), see GH issue #XXX]` | #109 | open (existing) | feature-gap (snapshot drift) | **#109 already covers it** — no new issue created | Wave 2 (snapshot regen) |
| 26 | wave6-record-status-derived.spec.ts:27 | test.skip | `No client records on schedule` | #161 | created this pass | cond-skip — verification needed | openModal picks activity w/o records / pre-`#124` cascade | Wave 4 |
| 27 | wave6-record-status-derived.spec.ts:76 | test.skip | `No client records on schedule` | #161 | created this pass | cond-skip | same | Wave 4 |
| 28 | wave6-record-status-derived.spec.ts:109 | test.skip | `No client records on schedule` | #161 | created this pass | cond-skip | same | Wave 4 |
| 29 | wave6-record-status-derived.spec.ts:138 | test.skip | `No client records on schedule` | #161 | created this pass | cond-skip | same | Wave 4 |
| 30 | wave6-record-status-derived.spec.ts:152 | test.skip | `Add visitor button not found` | #162 | created this pass | feature-gap (selector) | distinct cond-skip — looks like real UI bug | Wave 2 |
| 31 | wave6-status-shared.spec.ts:51 | test.skip | `No client records on schedule` | #161 | created this pass | cond-skip | same as #26-29 | Wave 4 |
| 32 | wave6-status-shared.spec.ts:91 | test.skip | `No client records` | #161 | created this pass | cond-skip | same as #26-29 | Wave 4 |
| 33 | ClientsIntegration.test.tsx:446 | it.skip (bare) | `// SKIPPED: Real ClientRecordTab uses visit-status-select (dropdown), not visit-status-icon (button)` | #163 | created this pass | feature-gap | testid drift — test must be rewritten to drive `visit-status-select` | Wave 2 |

## New GH issues created this pass

| # | title | links skip rows |
|---|---|---|
| #156 | E2E: US-M09 modal does not jump when switching tabs — openModal deferred (#XXX placeholder) | #4 |
| #157 | E2E: US-M10 schedule footer blur when modal open — openModal deferred (#XXX placeholder) | #3 |
| #158 | E2E: US-M01 "Приватное" label layout — settings tab not found (#XXX placeholder) | #5 |
| #159 | E2E: records detail panel — click row opens + close dismisses (2 fixme tests, #XXX placeholder) | #6, #7 |
| #160 | E2E: column-mode dropdown/filter race (Topbar handleColumnModeSelect) — 6 fixme tests | #8, #9, #10, #11, #12, #13 |
| #161 | E2E: wave6 cond-skip — "No client records on schedule" verification needed (6 tests, 2 files) | #26, #27, #28, #29, #31, #32 |
| #162 | E2E: wave6 "Add visitor button not found" — selector/UI bug in ClientTab (records:152) | #30 |
| #163 | vitest: ClientRecordTab status-icon cycle test mismatches implementation (visit-status-select) | #33 |
| #164 | E2E: unified-rows stale-cache tab-client timeout (scenarios 10/15/15b) — mislabeled #124 | #19, #20, #21 |

## Existing issues verified

| # | title | state | role in this pass |
|---|---|---|---|
| #124 | test/bug: unified-rows E2E follow-ups (openModal wrong-activity, tariff seed, age-only visitor edit 422) | OPEN | row #14 (Wave 2 backend PATCH — out of scope); cross-ref for rows #19-21 (mislabel-led → #164); commented this pass |
| #125 | test: 7 pre-existing E2E failures on main (visual snapshot drift + selector/timing flakes) | OPEN | row #2; commented this pass |
| #155 | E2E flake: scenario 18 'hard delete removes payment from stats' — GET /payments/{id} non-OK immediately after POST | OPEN | row #24 |
| #109 | fix(e2e): 1 pre-existing visual regression test still fails after snapshot regen | OPEN | row #25 — covers visual-regression records-page snapshot drift, **no new issue created** |
| #106 | fix(e2e): multi-worker mode hangs at test 21 — workers=1 is a workaround | OPEN | unrelated cross-ref |
| #107 | fix(e2e): activity-card-adaptive.spec.ts:140 ALWAYS times out | OPEN | unrelated cross-ref |
| #122 | fix(scripts): test-all.sh cleanup trap hangs on shard backends | OPEN | unrelated cross-ref |
| #149 | validation: numeric filters в ClientListParams не имеют нижней границы (ge=0) | OPEN | unrelated cross-ref |
| #108 | fix(e2e): database lock error between backend uvicorn (8000) and e2e tests | CLOSED | historical |
| #121 | test(e2e): fix 18 deferred flaky tests (currently test.fixme in #120) | CLOSED | superseded by this hygiene pass |
| #123 | test: 2 pre-existing date-dependent vitest flakes (CalendarPopover, Menubar) | CLOSED | historical |
| #126 | test(infra): standalone playwright mode lacks route warmup | CLOSED | historical |
| #127 | refactor(frontend): unify records/visits/payments caches | CLOSED | referenced by #164 (related area) |
| #152 | test-infra: seed staleness + E2E harness resilience | CLOSED | recently merged prior to this pass |

## Bare `test.skip()` triage results

These 7 E2E + 1 vitest skips were bare (no annotation string identifying a root cause).
Triage via 20-line context read:

| Row | file:line | title | verdict | action |
|---|---|---|---|---|
| #1 | activity-details-modal.spec.ts:219 | `4. Settings update — service_id changes in DB` | **cascade-`#124`** (cond-skip inside `if (!activity)`) | un-skip + verify in Wave 2 (#124 Wave 1 fixed openModal); no new issue |
| #15 | unified-rows.spec.ts:107 | `visits: edit existing visitor name triggers API call` | **cond-skip** | no new issue (inner guard; outer test is row #14 → #124) |
| #16 | unified-rows.spec.ts:167 | (inner guard for tariffOptions < 2) | **cond-skip** | no new issue |
| #17 | unified-rows.spec.ts:176 | (inner guard for no firstAltValue) | **cond-skip** | no new issue (cascade of #16) |
| #18 | unified-rows.spec.ts:210 | `visits: × on existing row calls DELETE API` | **cond-skip** | no new issue (skip-when seed r2 has no visit) |
| #22 | unified-rows.spec.ts:823 | (inner guard for tariffOptions.length === 0) | **cond-skip** | no new issue |
| #23 | unified-rows.spec.ts:833 | (inner guard for !firstOptionValue) | **cond-skip** | no new issue (cascade of #22) |
| #33 | ClientsIntegration.test.tsx:446 | `record tab status icon cycles visit status` | **feature-gap** (testid drift `visit-status-icon` → `visit-status-select`) | new issue #163 |

## Out of scope

- Row #14 (`unified-rows.spec.ts:98` — `waiting for PATCH /visitors (Wave 2 CRUD consolidation)`)
  — references `#124` (Wave 2 backend PATCH refactor). This is **backend CRUD
  consolidation**, not test debt. Not touched by this pass; the `#124` reference is
  already correct, no annotation update needed in Wave 2.

## Suggested next waves (high-level — architect makes the full plan)

- **Wave 2 — cheap wins + re-triage:** un-skip rows #3, #4, #5 (#156, #157, #158 —
  all were blocked by `#124` openModal, now fixed); rewrite vitest row #33 (#163,
  ~10 min testid rewrite); regenerate snapshot for row #25 (#109); re-run row #2 to
  confirm #125 still flakes; fix annotation `#XXX` → real numbers across all touched
  rows (per CLAUDE.md TDD: update annotation when test is touched).
- **Wave 3 — product fixes:** rows #19-21 (#164, stale-cache invalidation),
  #6/#7 (#159, detail-panel row-click), #8-13 (#160, column-mode dropdown product
  fix in `Topbar.tsx handleColumnModeSelect`), #24 (#155, backend write-visibility).
- **Wave 4 — cond-skip finalization:** rows #26-29, #31-32 (#161 — verify whether
  the "No client records" guard fires legitimately post-`#124`-Wave-1, or whether
  openModal picks the wrong activity); resolve #162 (`Add visitor button not found`);
  decide which cond-skip guards in rows #15-23, #1 stay as legitimate guards vs.
  become real test debt.

## Open questions for the architect

- Do we want one Wave 2 worktree branch, or separate branches per issue (#156,
  #157, #158 each as cheap PRs)?
- #164 (stale-cache) — should we ask @researcher-agent to investigate the React
  Query cache invalidation patterns in `RecordsContext` first, or just un-skip and
  let the test fail red?