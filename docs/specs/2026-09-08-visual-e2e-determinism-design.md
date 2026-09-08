# GH #246 — Deterministic visual-regression E2E (kill the dev-overlay flake)

- **Issue:** #246 `chore(ci): побороть флейки e2e — полный Tests красный в 48% прогонов`
- **Status:** DESIGN phase, G1a passed 2026-09-08; G1b revisions 1–2 (5-reviewer panel rounds 1–2 + user decisions D1–D2) same day
- **Scope:** the three visual spec files (`frontend/admin/e2e/visual-regression.spec.ts`, `week-view.spec.ts`, `wave6-status-snapshots.spec.ts` — rename of one describe block only) + one new CSS file + **one line in the existing `expect:` block of `frontend/admin/playwright.config.ts`** + one-time regeneration of all three committed baseline directories via the existing `update-snapshots.yml`. **No application code, no CI workflow structure changes.**
- **Grounding:** two host-scout passes 2026-09-08 (CI run-log failure classification; runner-image and date-drift refutation) + 5-reviewer panel round 1 (completeness/consistency/feasibility/simplicity/best-practices) with every finding fact-checked against the live tree; all file:line facts verified.

---

## 1. Context & Problem (what the evidence says, not what the issue assumed)

#246 was filed assuming infra flake (timeouts, stack-start races, data). Live CI logs say otherwise:

- **Every sampled red e2e run (08-28 → 09-06) is a pixel diff** (`toHaveScreenshot` exceeding `maxDiffPixels`) on shard-rest: records page, photos/services/clients tables, activity-modal settings — different baselines per run, 1 to 20+ shots per run. **Zero timeouts, zero `net::ERR`, zero globalSetup/stack-start failures** in the sample.
- **Retries don't help because the diff is deterministic within a run**: every sampled failure fails identically on attempt 1 and retry 1 (consistent with `retries: 1`, playwright.config.ts:47).
- **Runner-image drift is refuted**: red and green runs on the same day sit on the same image (run 33791666911 RED vs 33793071973 GREEN, both ubuntu-24.04 `20260828.587`, 09-03).
- **Date/data drift is refuted**: every visual block pins the browser clock (`page.clock.install({ time: new Date('2026-06-15T10:00:00') })` — Records describe visual-regression.spec.ts:37, Activity Modal :89, table describe :546; week-view.spec.ts:16) and all seed data those pages render is frozen (records r1–r6 → `ev_fixed_*` on `WEEK_FIXED_START=2026-06-15`, seed.py:65, :364-369; photos/clients/services rows carry no dates). No failing screenshot contains run-date-derived content.

**The mechanism that survives refutation — dev-overlay toast contamination**, documented inside the suite itself (visual-regression.spec.ts:520-527): the mocked browser clock guarantees an SSR↔client hydration mismatch on the sidebar «Сегодня» (SSR renders the real date); Next.js dev mode surfaces it as a "1 error" toast that **intermittently lands in the screenshot**. Today only the photos config hides the overlay (`nextjs-portal` hider init script with a 10-second polling window, :528-539); all other baselines were recorded with whatever overlay state the run had. Run-local presence/absence of the toast matches both the scatter across shots and the deterministic-within-run behavior. Secondary fact: e2e runs against `next dev` (scripts/e2e-shard-start.sh:139), so the dev overlay exists in every e2e run by construction.

**Three visual suites, one problem (panel round 1, verified):** `toHaveScreenshot` lives in THREE spec files, all in the shard-rest project (playwright.config.ts:95,102 — nothing in their names matches the shard-schedule exclusions): `visual-regression.spec.ts` (records page, modal, 8 tables × 7 states), `week-view.spec.ts` (4 page-level fullPage shots: schedule + menubar), `wave6-status-snapshots.spec.ts` (6 element-level shots: status picker/badges). Only visual-regression has partial protection (photos only); week-view and wave6 have none — same exposure, same fix.

## 2. Locked decisions (G1a user-approved 2026-09-08; D1–D2 re-decided at G1b)

1. **Invariant: zero dev-chrome pixels in visual shots.** The Next.js dev overlay (`nextjs-portal`) is hidden in ALL `toHaveScreenshot` comparisons across all three spec files (19 call sites, panel-verified). Playwright's `mask:` (masked pixels are excluded from the diff — pink-box fill in both images) was considered and set aside: the CSS route below produces clean shots with no per-call-site options at all. Raw diagnostic `page.screenshot()` calls elsewhere (`visual-compliance-checks.spec.ts`, `activity-card-adaptive.spec.ts`) are artifacts for manual review with DOM-based assertions — they compare nothing, so they stay as-is by design.
2. **Mechanism = declarative CSS via `expect.toHaveScreenshot.stylePath` (D1).** One CSS file (`frontend/admin/e2e/fixtures/hide-dev-overlay.css`, `nextjs-portal { display: none !important; }`) wired once in the existing `expect:` block of playwright.config.ts (:61 — `{ timeout: 10_000 }` gains `toHaveScreenshot: { stylePath: <css> }`). Why this beats the round-1 draft (per-test JS hider with a 10s polling window): CSS is applied at screenshot time **regardless of when or how often the portal mounts** — the late-mount/multi-portal gap found by the feasibility panel disappears structurally; zero call-site edits; every current AND future `toHaveScreenshot` (page- and element-level) inherits the invariant **structurally — nothing to remember, nothing to wire** (config-level options are defaults; per-call options take precedence; `stylePath` also accepts an array of CSS files if more overlays ever appear). This amends the G1a scope line "no Playwright config changes" — the change is one line in test-infra config, not application code.
3. **One-time full baseline regeneration** via the existing `update-snapshots.yml` (workflow_dispatch, `--project=shard-rest`, which covers all three visual files; artifact → manual commit), covering every `*.png` under the three `*-snapshots/` directories. New baselines are guaranteed overlay-free. Both workflows keep their current runner labels (image-drift refuted; #246's "update-snapshots.yml stays on ubuntu-latest" honored unchanged).
4. **The table describe is kept and renamed (D2, re-decided after a fact-check).** The `${config.name} table — #139 pre-migration baselines` describe (:514) is the ONLY caller of the seven table builders (:548-554) — i.e. the entire visual coverage of the 8 CRUD tables (~56 shots), not a leftover parity guard. It is renamed to drop the misleading "#139 pre-migration baselines" label (e.g. `${config.name} table — Visual Regression`); coverage and shot names are preserved. The rename cannot churn baselines: every `toHaveScreenshot` passes an explicit `.png` name and the config has no `snapshotPathTemplate` override — the describe title is not part of the snapshot path (panel-verified). The old describe title is referenced by no code or test (other `#139` mentions in the tree are migration comments).
5. **The hydration mismatch itself is NOT fixed.** The SSR clock seam (test-only fixed-time env for the dev server) was rejected at G1a: it edits application code for tests' sake, must cover every date call site to work, and any future dev-mode warning would re-contaminate shots anyway. The Next.js `devIndicators: false` lever (suggested by the best-practices panel round 1) was verified a dead end for this repo: `next@14.2.35` (frontend/admin/package.json) maps `devIndicators` to the route/timer indicator only — the Next docs themselves confirm "Next.js will still surface any compile or runtime errors" with it disabled, and the error overlay/toast lives in `nextjs-portal`. Console noise from the mismatch stays (it never affects pixels).
6. **Success criterion (DoD anchor): repeated runs on one unchanged commit are green** — at least 3 consecutive green runs of the full visual suite (all three files) via CI runs of the Tests workflow, zero visual diffs. Evidence = CI run links (local macOS runs compare nothing: committed baselines carry the `-linux` platform suffix).

## 3. Mechanism (binding)

### 3.1 The CSS + config wire-up

```css
/* frontend/admin/e2e/fixtures/hide-dev-overlay.css */
/* Visual-regression invariant: screenshots contain zero dev-chrome pixels.
   Applied by Playwright at screenshot time (expect.toHaveScreenshot.stylePath)
   — works regardless of when the portal mounts; covers multiple portals. */
nextjs-portal { display: none !important; }
```

```ts
// playwright.config.ts — existing expect block (was: { timeout: 10_000 })
expect: {
  timeout: 10_000,
  toHaveScreenshot: { stylePath: './e2e/fixtures/hide-dev-overlay.css' },
},
```

- Config-level `toHaveScreenshot` options act as defaults for every screenshot assertion; per-call options (the existing `maxDiffPixels`/`fullPage` at the call sites) take precedence. No per-call `stylePath` exists today (verified by grep) — nothing can accidentally shadow the CSS.
- Existing `toHaveScreenshot` determinism defaults are adequate (panel-verified against Playwright docs): `animations` defaults to `'disabled'`, `caret` to `'hide'`, `scale` to `'css'`; viewport is pinned by the project's `devices['Desktop Chrome']`. No further per-call hardening is added. Font readiness (`document.fonts.ready`) was considered and dropped: fonts are self-hosted via `next/font` and the current baselines show no font-swap artifacts (YAGNI).
- The photos-only JS hider block (:528-539) becomes redundant — deleted together with its explanatory comment.

### 3.2 Spec-file edits (minimal)

- `visual-regression.spec.ts`: delete the photos-only hider special case; rename the table describe (§2.4). No other test-body changes.
- `week-view.spec.ts`, `wave6-status-snapshots.spec.ts`: no edits at all — the config-level stylePath covers them.
- No functional (non-visual) spec changes — they don't screenshot.

### 3.3 Baseline regeneration (one time)

- Run `update-snapshots.yml` on the migrated tree; download the artifact; commit ALL regenerated `*.png` across the three snapshot directories in one "test: regenerate visual baselines (overlay-free)" commit. Regen (update-snapshots.yml) and verification (test.yml) run on the same ubuntu-latest runner family — baselines are generated in the environment that verifies them (Playwright's snapshot-stability guidance).
- **Regen-run guard:** before committing, spot-check the regen diff — if any regenerated baseline still shows overlay pixels, the mechanism failed; stop and fix, do not commit contaminated baselines.
- Expected diff: shots whose old baselines carried overlay traces change; clean ones may stay byte-identical — both outcomes fine, no manual cherry-picking.

## 4. User Scenarios (each maps to an E2E test)

1. **Не-UI пуш не роняет Tests:** a developer pushes a docs/chore commit → the visual suite is green; shots don't depend on whether the dev overlay fired. *E2E: ≥3 consecutive runs of the three visual spec files on the same commit, all green.*
2. **UI-изменение зажигает ровно свои базлайн-группы:** a developer changes UI → exactly the affected `toHaveScreenshot` tests go red (no scatter across unrelated shots). *E2E: the existing `toHaveScreenshot` assertions unchanged — they are the guard; verified by the regen commit where only overlay-carrying shots change.*
3. **Обновление baseline — одна детерминированная процедура:** a developer updates baselines via `update-snapshots.yml` → the very next run is green without retries, and the new baselines contain no overlay pixels. *E2E: first Tests run after the regen commit — green.*

(Inheritance for future visual tests is structural — config-level `stylePath` covers any new `toHaveScreenshot` automatically; see §2.2. No separate scenario.)

## 5. Out of scope / constraints (binding)

- **No SSR-clock seam / hydration-mismatch fix** — backlog candidate (§2.5).
- **No prod-build e2e** (`next build && next start` kills the whole dev-overlay class) — backlog candidate; wider blast radius than this scope.
- **No runner-image pinning** — hypothesis refuted (§1); both workflows keep current labels.
- **No retries increase** — masks, doesn't fix; the diff is deterministic within a run.
- **No CI-structure work** (job `timeout-minutes`, shard rebalance, warmup-list dedup) — declined at G1a ("только visual-diff").
- **No deletion or reduction of visual coverage** — the table describe is renamed, not removed (D2); no baselines are dropped.
- **No application-code changes of any kind** (the mismatch stays in the console).

## 6. Definition of Done

- CSS file exists; the `expect:` block carries the `stylePath` wire-up; the photos-only JS hider and its comment are deleted; the table describe is renamed (§3.1–3.2).
- All baselines across the three snapshot directories regenerated in one commit, spot-checked overlay-free (regen-run guard, §3.3).
- **≥3 consecutive green runs of the full visual suite (three files) on one unchanged commit via CI runs of the Tests workflow** — evidence: run links in the PR.
- The rest of the e2e suite and all other Tests jobs green on the regen commit.
- CHANGELOG.md entry (test-infra section, house style).
