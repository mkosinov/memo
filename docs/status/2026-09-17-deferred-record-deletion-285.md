# GH #285 — Deferred record deletion with undo-toast (shared PendingActions pipeline + expected verification)

- **Date**: 2026-09-17
- **Branch**: `feat/deferred-record-deletion`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `9852dd5` (#307 lint threshold + lucide icons) — 15 commits (`598f062..77b7c4f`), 47 files, +3515 / −499
- **Issue**: #285 — deferred deletion of records with undo-toast; expected-state verification at commit; stale-aware honest errors
- **Spec**: `docs/specs/2026-09-16-deferred-record-deletion-design.md` (rev8)
- **Plan**: `docs/plans/2026-09-17-deferred-record-deletion-plan.md` (rev8 amendments)

## Summary of Changes

- **Backend — no-body DELETE forbidden (T1, `598f062`):** `DELETE /api/v1/records/{id}` gains a
  `?dry_run=true` pure-preview flag (204 without deleting when clean, 409 with the dependency tree,
  404 when absent, 422 when combined with `resolutions`; never writes rows, no SSE marks). The bare
  no-body branch is gone: no flag and no body → `422 {"detail": "expected_state_required"}` — the
  records contract deliberately diverges from the 5 archive entities.
- **Backend — expected-state verification (T2, `8d83e7e`):** execute path takes two flat embedded
  body params (`resolutions`, `expected`); `expected` is mandatory on execute, `RecordDeleteBody`
  flattens without wrapper keying. The handler runs existence → `collect_dependencies` →
  **subset check by id** (`set(now_ids) ⊆ set(expected[entity])`, auto-dependencies excluded via the
  explicit `auto` field) → only then `resolve_delete`. Mismatch → `409 {"detail": "stale_dependencies",
  dependencies: <current tree>}`; vanished dependencies no longer block (subset, not equality).
- **Backend — `items` in the record 409 tree (T3, `457f307`, `68fa2cf`, `5f2575a`):** `DependencyNode`
  gains `items: list[DependencyItem] | None` (`DependencyItem {id, label}`) and `auto: bool = False`;
  label builders follow the model `__str__` format; record tree serializes with `exclude_none=True`
  so other entities' 409 payloads keep today's shape (`count`/`cascade_preview` retained).
- **api-client (T4, `47529ff`):** new `dryRunDeleteRecord(id)` (no body, `?dry_run=true`; 409 →
  `ApiError.dependencies`), `resolveDeleteRecord(id, { expected, resolutions? })` with `expected`
  mandatory in the type, bare `deleteRecord` removed; `DependencyNode.items?: { id, label }[]` in the
  package; endpoint tests updated/added.
- **Frontend — cache snapshots + deferred `useDeleteRecord` (T5, `dc0db10`, `6016314`):**
  `recordCacheSync` gains by-key snapshot/restore over both cache shapes (paginated envelope + flat
  list); `useDeleteRecord` rewritten onto the shared `PendingActions` pipeline — dry-run on click,
  409 → dialog (no enqueue, cache untouched), 204 → `enqueuePendingAction('delete-record-<id>')`
  with «Удалено. Отменить» / `delayMs: 5000`; commit sends `{expected}` + `resolutions` built from
  the dialog's dependency `items` (auto nodes skipped); undo restores by key; rev8 (ж)
  `staleAwareOnError` — commit `409` with dependencies → undo + error toast «Не удалось удалить:
  данные изменились» with «Обновить» action invalidating the `['records']` family; non-409 errors
  fall through to the context default.
- **`PendingActionsContext` generalization (T6, `e126736`):** `PendingAction.onError?`; commit-timer
  `try/catch` — `onError` first, `ApiError` 404 = silent success (target already gone, no false
  error), otherwise undo + «Не удалось удалить. Изменение отменено»; the undo timer is cleared
  **before** `await commit()` so cancelling during an in-flight DELETE cannot resurrect a
  server-deleted row; **additive** toast action slot (`Toast.action?: { label, onAction }`,
  render gate `undo || action`) — the existing undo lifetime logic (#94) is untouched.
- **Call sites + dialog item lines (T7, `ee7fa91`, `53ac52a`):** `RecordsTable`, `ClientRecordTab`,
  `ClientTab` use the dry-run-first flow (409 from preview populates the dialog, enqueue synchronously
  on confirm, dialog closes immediately); `DeleteDialog` renders dependency `items` as one-line
  entries under a «{relationPlural} — будут удалены:» header (first 10 + «и ещё N»), `dep-visits` /
  `dep-payments` testids kept on the group, nodes without `items` render as before.
- **e2e (T8, `17855ac`, `2030f61`):** `records.spec.ts` — S1 (clean deferred delete → undo toast →
  row gone after reload + DB check), S2 (cancel → no DELETE with body in the window → row alive),
  S5 (offline commit failure → row restored + honest error toast → row alive after reload), S6
  (race: payment added in the window → commit 409 → row restored + stale-aware toast with
  «Обновить» → record + payment alive); the old bare-DELETE regression rewritten to expect
  `422 expected_state_required`; S6 un-fixme asserted green.
- **e2e activity-details-modal (T9, `fce0385`):** S3 updated — the dependency dialog now shows the
  one-line item groups and confirm leads to the undo toast («Удалено. Отменить» replaces «Запись
  удалена»); S4 new — undo after a cascade confirm restores record + visits + payments (DB poll).
- **Domain rules + CHANGELOG (T10, `77b7c4f`):** `docs/domain-rules/records.md` Delete section
  rewritten to the rev7/rev8 contract (flag, body, subset check, `stale_dependencies`, no-body 422,
  records divergence noted; delayed delete reinstated on the shared pipeline); `_overview.md` FK-matrix
  attachment criterion (`expected` required where server-side dependencies exist — records #285;
  visits/payments inherit only the D4 error handling; activities follow in #286); CHANGELOG entry.

## Behavioral Delta

- **S1/S3:** record deletion is now deferred (5 s window with the «Удалено. Отменить» toast) on the
  shared visits/payments pipeline, for both the clean path and the dependency-dialog cascade; the
  row disappears immediately and the DELETE only fires at window expiry.
- **S2/S4:** undo (toast button) restores the row(s) into both cache shapes and no DELETE-with-body
  reaches the server; cascade undo restores record + visits + payments.
- **S5/S6:** a failed commit is no longer silent — the row returns and an honest error toast appears;
  a row already deleted by someone else is a silent success (no false error); a dependency that
  appeared in the window yields `409 stale_dependencies` → row returns + «Обновить» action toast.
- **Dialog:** the record dependency dialog now lists what will actually be deleted (id + one-line
  labels) instead of bare counts.
- Everything else (dry-run preview semantics for other entities, archive-entity flows, instant
  hard-deletes for Tag/Photo/Visitor/UserSettings) is behaviorally unchanged.

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Backend — `?dry_run=true` flag + rev7 contract (no-body → 422) | standard | ✅ (`598f062`) |
| T2 | Backend — `RecordDeleteBody` + expected id-set verification | large | ✅ (`8d83e7e`) |
| T3 | Backend — `items` (+`auto`) in the record 409 dependency tree | standard | ✅ (`457f307`, `68fa2cf`, `5f2575a`) |
| T4 | api-client — `dryRunDeleteRecord` / `resolveDeleteRecord {expected,…}` | small | ✅ (`47529ff`) |
| T5 | `recordCacheSync` snapshots + `useDeleteRecord` rewrite (rev8 stale-aware) | large | ✅ (`dc0db10`, `6016314`) |
| T6 | `PendingActionsContext` — generalized `onError` + toast action slot | small | ✅ (`e126736`) |
| T7 | Call sites (3) + `DeleteDialog` item one-liners | large | ✅ (`ee7fa91`, `53ac52a`) |
| T8 | e2e `records.spec` — S1/S2/S5/S6 + rev7 regression rewrite | large | ✅ (`17855ac`, `2030f61`) |
| T9 | e2e `activity-details-modal` — S3 update + S4 new | standard | ✅ (`fce0385`) |
| T10 | Domain rules + CHANGELOG + full-suite verification | small | ✅ (`77b7c4f`) |

All ten tasks reviewed (spec panel rev8 + per-task review fixes; T7 quality commit `53ac52a`).

## User Scenarios (spec) — all covered, green

| # | Scenario | Anchor | Status |
|---|----------|--------|--------|
| S1 | Clean deferred delete → undo toast → gone after reload | `e2e/records.spec.ts` (`17855ac`) | ✅ |
| S2 | Cancel within the window → row restored, no DELETE with body | `e2e/records.spec.ts` (`17855ac`) | ✅ |
| S3 | Dependency dialog item lines + cascade deferred delete | `e2e/activity-details-modal.spec.ts` (`fce0385`) | ✅ |
| S4 | Undo after cascade confirm → record + visits + payments alive | `e2e/activity-details-modal.spec.ts` (`fce0385`) | ✅ |
| S5 | Commit failure (offline) → row restored + honest error toast | `e2e/records.spec.ts` (`17855ac`) | ✅ |
| S6 | Race: dependency appears in window → 409 stale + «Обновить» | `e2e/records.spec.ts` (`2030f61`, un-fixme) | ✅ |

## Test Results

- **backend pytest:** **2197 passed / 8 skipped** — full suite; new/updated coverage for dry-run
  preview, expected verification (subset, id-swap, vanished/appeared dependency), `items` payloads,
  no-body 422, SSE non-emission on preview.
- **admin vitest:** **2116 passed / 0 failed (133 files)** — `useDeleteRecord`, `recordCacheSync`,
  `PendingActionsContext`, `UIContext`, `ToastContainer`, `DeleteDialog`, call-site suites.
- **tsc --noEmit:** clean. **lint:** 0 errors / 38 warnings (at `main`'s threshold).
- **e2e focus (shard 1, workers=1, per `docs/tests_workflow.md`):** `records.spec` +
  `activity-details-modal.spec` + smoke → **46/46**.
- **Undo regression:** `unified-rows` + `unify-caches` → **30/30**.
- **Visual regression:** 47/61 local pass; the 14 local divergences are **pre-existing drift from
  `main`'s #307** (lucide icons — merged 14/14 CI-green; baselines CI-pass; local-only rendering
  drift; the #285-owned surface is pixel-identical). Documented exception, baselines not touched.
- **Visual compliance gate (G4.5):** **6/6 PASS** with screenshots (`/tmp/visual-compliance-285`).

## Key Files Changed

- **Backend (prod):** `src/api/v1/records.py`, `src/domain/deletion.py`, `src/schemas/record.py`,
  `src/services/record.py`, + `items` serialization touches in 5 sibling routers (`clients`,
  `locations`, `materials`, `services`, `staff`).
- **Backend (tests):** `tests/test_api_records.py`, `test_coverage_boost.py`, `test_edge_cases.py`,
  `test_events_emit.py`, `test_integration_flows.py`, `test_master_scope_read.py`.
- **api-client:** `src/endpoints.ts`, `src/schemas.ts`, `src/endpoints.test.ts`.
- **Admin (prod):** `hooks/useDeleteRecord.ts`, `lib/cache/recordCacheSync.ts`,
  `contexts/PendingActionsContext.tsx`, `contexts/UIContext.tsx`,
  `app/components/toast/ToastContainer.tsx`, `app/components/DeleteDialog.tsx`,
  `app/(main)/records/components/RecordsTable.tsx`,
  `app/(main)/clients/components/ClientRecordTab.tsx`,
  `app/components/modal/ActivityDetailsModal/{ActivityDetailsModal,ClientTab}.tsx`.
- **Admin (tests):** 11 vitest suites + `e2e/records.spec.ts` + `e2e/activity-details-modal.spec.ts`.
- **Docs:** `docs/domain-rules/records.md`, `docs/domain-rules/_overview.md`, `CHANGELOG.md`;
  meta: `PLAN.md`, this status file.

## Docs Impact

- Spec (`docs/specs/2026-09-16-deferred-record-deletion-design.md`, rev8) and plan
  (`docs/plans/2026-09-17-deferred-record-deletion-plan.md`) live on `main` and were not touched here.
- `docs/domain-rules/records.md` — Delete/API sections rewritten to rev7/rev8 (committed `77b7c4f`).
- `docs/domain-rules/_overview.md` — FK-matrix attachment criterion for `expected` (committed `77b7c4f`,
  with the #286 activity line deliberately left to that feature).
- `CHANGELOG.md` — `[Unreleased]` entry (committed `77b7c4f`, framed in the canonical feature shape by
  the IMPL wrap-up commit).
- No `README.md` / `design-system.md` change: no new UI primitive (the toast action slot is additive
  and visual-compliant; the countdown ring from #94 is reused as-is).

## Known Non-Blocking Observations

- The visual-suite local failures belong to the documented pre-existing lucide/font render drift
  family (also red on `main` after #307); CI baselines are authoritative — no baselines were
  re-recorded.
- `expected` is verified as a **subset** by design: a dependency that disappears during the window
  does not block (we delete less than confirmed); one that appears does.
- The records DELETE contract intentionally diverges from the archive entities (no-body DELETE stays
  legal only for the 5 archive entities) — pinned in domain rules, not a defect.

## References

- **GitHub Issue**: #285 (related: #94 — undo toast countdown ring, #286 — activity conversion onto the frozen records contract, #297/#298 — visit/payment leaf entities)
- **Design Spec**: `docs/specs/2026-09-16-deferred-record-deletion-design.md` (rev8)
- **Plan**: `docs/plans/2026-09-17-deferred-record-deletion-plan.md` (rev8 amendments)
- **PR**: _(to be added after PR creation)_
