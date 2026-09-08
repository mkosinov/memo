# Visual E2E Determinism (#246) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the visual-regression e2e suite deterministic: the Next.js dev-overlay toast (hydration-mismatch «Сегодня») can never again land in a screenshot, red Tests runs on unchanged UI stop, and baseline updates become a single deterministic procedure.

**Architecture:** Declarative CSS (`nextjs-portal { display: none !important; }`) wired once at the config level (`expect.toHaveScreenshot.stylePath` in `frontend/admin/playwright.config.ts`) — applied at screenshot time regardless of when/how often the portal mounts; inherited by every current and future `toHaveScreenshot` (page- and element-level). One-time regeneration of all three baseline directories via the existing `update-snapshots.yml`. No application code.

**Tech Stack:** Playwright 1.52 (`expect.toHaveScreenshot.stylePath`), Next 14 dev overlay (`nextjs-portal`), GitHub Actions (`test.yml` e2e job + `update-snapshots.yml`).

**Spec (binding):** `docs/specs/2026-09-08-visual-e2e-determinism-design.md` — §2 decisions 1–6 (D1 stylePath, D2 describe rename), §3 mechanism (CSS + config wire-up, spec-file edits, regen + guard), §4 User Scenarios 1–3, §5 NOT-built, §6 DoD.

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/visual-e2e-determinism-246`.

**Test commands:**
- E2E local sanity (stack on shard 2): `SHARD_ID=2 SHARD_PORT=3003 BACKEND_PORT=8002 bash scripts/e2e-shard-start.sh` then `cd frontend/admin && pnpm test:e2e -- --project=shard-rest visual-regression week-view wave6-status-snapshots` (local runs are sanity-only; baselines carry the `-linux` suffix — verdict evidence comes from CI, spec §2.6).
- CI run: `gh workflow run test.yml --ref <branch>` then watch `gh run watch`.
- Regen: `gh workflow run update-snapshots.yml --ref <branch>` (workflow_dispatch; artifact → manual commit).

**Commits:** per-task, prefix `test(#246):`.

---

## Behavioral Delta

How this behaves for the developer, mapped to spec User Scenarios:

- **Не-UI пуш больше не роняет Tests (С1)** — визуальные шоты не зависят от того, всплыл ли dev-overlay в прогоне; три подряд зелёных CI-прогона на одном коммите — норма, а не везение.
- **UI-изменение зажигает ровно свои базлайн-группы (С2)** — диффы появляются только у шотов, чей UI реально изменился; разброс по «случайным» таблицам исчезает.
- **Обновление baseline — одна детерминированная процедура (С3)** — regen через `update-snapshots.yml`, первый же прогон после реген-коммита зелёный, в новых baseline'ах нет пикселей overlay.
- **Новые visual-тесты безопасны по построению** — конфиг-уровень `stylePath` накрывает любой будущий `toHaveScreenshot` без действий автора теста (свойство, не задача).

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `frontend/admin/e2e/fixtures/hide-dev-overlay.css` | CREATE (T1) | `nextjs-portal { display: none !important; }` + header comment (invariant) |
| `frontend/admin/playwright.config.ts` | MODIFY (T1) | `expect:` block (:61) gains `toHaveScreenshot: { stylePath: './e2e/fixtures/hide-dev-overlay.css' }`; existing `timeout: 10_000` preserved |
| `frontend/admin/e2e/visual-regression.spec.ts` | MODIFY (T1) | delete the photos-only JS hider block (:528-539 incl. comment); rename describe :514 `#139 pre-migration baselines` → `Visual Regression` |
| `frontend/admin/e2e/visual-regression.spec.ts-snapshots/`, `week-view.spec.ts-snapshots/`, `wave6-status-snapshots.spec.ts-snapshots/` | REGENERATE (T2) | all `*.png` overlay-free, one commit |
| `CHANGELOG.md` | MODIFY (T2) | test-infra entry, house style |

---

## Task 1: Wire the invariant (CSS + config + cleanup + rename)

### Classification: trivial

### Required Docs
- `docs/specs/2026-09-08-visual-e2e-determinism-design.md` §2.1–2.2 (invariant, mechanism D1), §2.4 (rename D2), §3.1–3.2 (binding wire-up + edits).

### Steps
- [ ] Create `frontend/admin/e2e/fixtures/hide-dev-overlay.css` exactly per spec §3.1 (rule + invariant comment).
- [ ] In `frontend/admin/playwright.config.ts` extend the existing `expect:` block (:61) with `toHaveScreenshot: { stylePath: './e2e/fixtures/hide-dev-overlay.css' }` — keep `timeout: 10_000`; touch nothing else in the config.
- [ ] In `frontend/admin/e2e/visual-regression.spec.ts`: delete the photos-only hider block with its explanatory comment (was :528-539 — the `if (config.name === 'photos')` branch with `addInitScript`); keep the clock-install comment block intact.
- [ ] Same file: rename the table describe (was :514) from `${config.name} table — #139 pre-migration baselines` to `${config.name} table — Visual Regression` (title only — no test names, no shot names change; baselines unaffected, spec §2.4).
- [ ] Sanity-verify nothing else references the old describe title: `grep -rn "pre-migration baselines" frontend/` → 0 hits after the edit.

### DoD (RED-GREEN observation)
- Config diff is exactly one `toHaveScreenshot` line added inside the existing `expect:` block; CSS file is exactly the rule + comment.
- RED observable (expected, do NOT commit baselines at this stage): a CI/local shard-rest run now shows `toHaveScreenshot` mismatches on shots whose committed baselines carry overlay traces — the diff is the *expected* sign that overlay-carrying baselines no longer match the now-clean shots; the *proof* that the mechanism works comes in Task 2, when the regenerated PNGs come out overlay-free. Shots with clean baselines stay green. If NOTHING changes at all AND everything stays green with overlay traces visible in old baselines — the wire-up is broken (check path resolution: CSS path is relative to `playwright.config.ts`).
- `pnpm type-check` (frontend/admin) green — config edit compiles.

---

## Task 2: Regenerate all baselines overlay-free + CHANGELOG

### Classification: small

### Required Docs
- `docs/specs/2026-09-08-visual-e2e-determinism-design.md` §3.3 (regen procedure + guard), §2.3 (one commit, same-runner note), §6 (DoD items).

### Steps
- [ ] Push the Task-1 branch; run `gh workflow run update-snapshots.yml --ref <branch>`; wait for the artifact (`.github/workflows/update-snapshots.yml` — `--project=shard-rest`, artifact glob covers all three snapshot dirs).
- [ ] Download the artifact, unpack the three `*-snapshots/` directories over the working tree.
- [ ] **Regen-run guard (spec §3.3):** inspect the regen diff — if any regenerated PNG still shows overlay pixels (toast/badge), STOP: the mechanism failed; do not commit contaminated baselines; go back to Task 1.
- [ ] Verify diff shape matches expectation: only overlay-carrying shots changed (User Scenario 2 evidence); clean baselines byte-identical is fine.
- [ ] Add the CHANGELOG.md entry (test-infra section, house style): visual determinism — dev-overlay hidden via config-level stylePath; baselines regenerated.
- [ ] One commit: `test(#246): regenerate visual baselines (overlay-free)` — all PNGs + CHANGELOG together.

### DoD (User Scenario 3 — RED-GREEN-REFACTOR)
- E2E for scenario 3 passes: the FIRST CI Tests run on the regen commit is green on all three visual files without retries — `gh workflow run test.yml --ref <branch>` → e2e job green (link as evidence).

---

## Task 3: Determinism proof — 3 consecutive green CI runs

### Classification: small

### Required Docs
- `docs/specs/2026-09-08-visual-e2e-determinism-design.md` §2.6 (success criterion, CI-only evidence), §6 (DoD).

### Steps
- [ ] Merge the branch to `main` (or run on the branch ref — the criterion is one unchanged commit; record which).
- [ ] Trigger Tests on that exact commit three times in a row: `gh workflow run test.yml --ref <ref>` (×3, sequential — wait for each to finish before the next; do not let concurrency cancel them).
- [ ] Record all three run links as evidence (PR description / issue #246 comment).

### DoD (User Scenario 1)
- E2E for scenario 1 passes: 3/3 runs green on the e2e job (shard-rest AND shard-schedule), zero visual diffs, no retries masking failures.
- All other Tests jobs green on the same commit (backend ×4 groups, coverage, frontend vitest ×5, frontend-checks).
- Issue #246 gets a closing comment with the evidence links.

---

## Guardrails (binding, from spec §5)

- NO application-code changes (the hydration mismatch stays in the console — out of scope).
- NO Playwright changes beyond the one `expect.toHaveScreenshot.stylePath` line.
- NO retries increase, NO runner pinning, NO CI-structure work (timeouts/shard rebalance), NO deletion of visual coverage.
- Raw diagnostic `page.screenshot()` calls (visual-compliance-checks, activity-card-adaptive) are NOT touched — they compare nothing.
