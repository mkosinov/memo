# GH #257 — Unified visitor model: anonymous = visit with `visitor_id = NULL`

- **Date**: 2026-09-17
- **Branch**: `feat/257-anonymous-visits-unified`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `0ec854d` (G2 plan commit) — 18 commits (`88059f4..fe73c26`), 49 files, +2649 / −303
- **Issue**: #257 — «Нет посетителей» при `anonym_visits > 0`
- **Spec**: `docs/specs/2026-09-16-anonymous-visits-unified-design.md`
- **Plan**: `docs/plans/2026-09-16-anonymous-visits-unified-plan.md`

## Summary of Changes

- **Backend unified model (`764512d`, `a2b05fa`, T2):** the `anonym_visits` column is removed from
  `models/record.py`; an anonymous guest is now a real `Visit` row with `visitor_id = NULL` carrying
  its own tariff/price/status. `seats` is a pure function of the visit list
  (`recompute_record_seats` → `len(visits)`, `domain/record_visits.py`); the response mapper
  (`map_record`) no longer emits the counter; create/update/patch stop accepting and persisting it.
  The **create path now persists `VisitItem.tariff_id`** (previously dropped), so an anonymous tail
  saved from the booking form keeps the default tariff and its price.
- **`guests` sort (`a9ce603` → `fe73c26`):** the SQL ordering key is a correlated subquery over the
  record's **named** visits (parity pin restored to the pre-#257 semantics — all named visits, not
  only active ones; the intermediate "active named only" change was reverted by a dedicated fix
  commit with a parity test).
- **Migration `dc47abd1ad2d` (`764512d`, T2):** expands each unit of the legacy counter into one
  `visits` row with `visitor_id = NULL`; the new visit **inherits the record's status** (a cancelled
  record's anonymous guests must not come back as `waiting`); `price = 0`,
  `tariff_id`/`custom_price` NULL (the counter carried no per-seat money); `seats` is recomputed from
  the actual rows; then the column is dropped. `downgrade` re-adds the column EMPTY (default 0) —
  the expansion is deliberately NOT reversible (the generated rows carry no marker), accepted
  because only test databases are in scope.
- **api-client breaking (`4b7109b`, T4):** `anonym_visits` removed from `RecordCreate`/`RecordUpdate`/
  `RecordPatch`/`RecordResponse` zod schemas and the endpoints typing.
- **domain-rules (`c23f94a`, T3):** `docs/domain-rules/records.md` — `seats = len(visits)`, the
  anonymous-visit definition, the record-level status cascade (`StatusPicker` writes the status onto
  ALL visits, including anonymous ones; the record status stays derived), and the re-checked capacity
  rule (capacity is verified again on PUT/PATCH whenever the visits array is replaced; comment/
  custom-price-only patches skip the capacity query).
- **Frontend:**
  - `useRecordMutations` (`14512c4`, T5): booking create path sends the unfilled tail as anonymous
    visits with the service's default tariff; stepper + conversion mutations added (optimistic cache
    updates, invalidation via `addVisit`/`deleteVisit`).
  - `RecordHeader` (`6921455` + `9ca27f4`, T6): the +/− stepper now creates/deletes ONE real anonymous
    visit per click (`onAddAnonymousVisit`/`onDeleteAnonymousVisit` props; default tariff with the
    tariff price, same logic as the booking form); the counter renders `visits.filter(visitor_id ==
    null).length`; a failed `deleteVisit` rolls the optimistic cache back.
  - `RecordVisitsTable` (`db706a6` + `948064b` + `7c0d4a3`, T7): typing a name/age into an «Аноним»
    row converts it inline with a single PATCH of the visit (`visitor_id` after one `createVisitor` —
    no duplicate create/PATCH, no extra toast), an in-flight guard prevents double submits, the row
    returns to «Аноним» on error/rejection, and the original error is rethrown after reconciliation.
  - Card wiring (`dd53462`, T8): seats and money are derived from `record.visits` (dead counter spans
    removed), the coarse record-status handler in `ClientTab` now cascades onto all visits while
    preserving `tariff_id`/`custom_price` of each row, and capacity re-checks are surfaced.
- **Test sweep (`23f30db`, T9):** fixtures/tests purged of `anonym_visits`; empty-state and seats
  expectations rewritten against the unified model; new `test_anonymous_visits.py` and
  `test_migration_anonym_unfold.py` cover the model and the data migration.
- **E2E (`4172803`, `baf103a`, `0e6b8c0`, T10):** new `e2e/anonymous-visits.spec.ts` (US1/US2, US2,
  US3, US4, US5, US6) + helper `e2e/helpers/anonymous-visits.ts`; `wave6-record-status-derived`
  scenario 3 rewritten from the counter stub to real anonymous rows.
- **Task 1 artifact:** `docs/impl/2026-09-16-257-anonym-inventory.md` (grep inventory of all
  `anonym_visits`/`anonymVisits` consumers) plus cleanup of the orphaned, untracked `memo.db` seeded
  with the old schema.

## Behavioral Delta

- **Bug #257 (empty state):** «Нет посетителей» now appears only for a true empty record
  (`visits = []`); a record that used to carry «3 анонимных» shows three «Аноним» rows with real
  fields.
- **US1/US2 (booking):** filled rows are saved as named visits, the unfilled tail as anonymous visits
  with the default tariff of the service.
- **US3 (conversion):** typing a name into an anonymous row converts it in ONE action even at full
  capacity — seats and «к оплате» unchanged, no 409; on error the row returns to «Аноним».
- **US4 (money):** anonymous rows' tariff/price are editable like any other visit; «Стоимость» and
  «к оплате» now include anonymous prices (intentional change).
- **US5 (deletion):** deleting an anonymous row frees a seat; seats and the header recompute.
- **US6 (status):** an anonymous row can be marked «пришёл» — the record honestly becomes «Пришли»;
  the record-level status picker cascades onto ALL visits, anonymous included.
- **Stepper:** +1/−1 creates/deletes one anonymous visit (per unit) with the service default tariff;
  +1 on a full activity gets the regular 409 toast.
- **US7 (migration):** a record with `anonym_visits = N` ends up with N anonymous visits inheriting
  the record status; status and occupancy are unchanged.
- **API (breaking):** `anonym_visits` disappears from `RecordCreate`/`RecordUpdate`/`RecordPatch`/
  `RecordResponse`; clients derive seats from `visits`.

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | Inventory of `anonym_visits` consumers + orphan DB artifact cleanup | small | ✅ (`88059f4`) |
| T2 | Backend — counter removal + data migration with status inheritance | large | ✅ (`764512d`, `a2b05fa`, parity pins `a9ce603`/`fe73c26`) |
| T3 | `domain-rules/records.md` — cascade, seats, stale text | small | ✅ (`c23f94a`) |
| T4 | `packages/api-client` — field removal (breaking) | small | ✅ (`4b7109b`) |
| T5 | `useRecordMutations` — create tail as anonymous visits + stepper/conversion mutations | standard | ✅ (`14512c4`) |
| T6 | `RecordHeader` — stepper creates/deletes an anonymous visit | standard | ✅ (`6921455`, `9ca27f4`) |
| T7 | `RecordVisitsTable` — counter props removed + inline conversion | standard | ✅ (`db706a6`, `948064b`, `7c0d4a3`) |
| T8 | Card wiring — derived seats, coarse status cascade, money | standard | ✅ (`dd53462`) |
| T9 | Frontend unit tests — fixture sweep + behavioral rewrites | standard | ✅ (`23f30db`) |
| T10 | E2E — `anonymous-visits.spec.ts` (US1–US6) + wave 6 | large | ✅ (`4172803`, `baf103a`, `0e6b8c0`) |
| T11 | Final — grep sweep, full runs, CHANGELOG, PR | small | ✅ (docs commit; PR by architect) |

## User Scenarios (spec §6) — covered

| # | Scenario | Anchor | Status |
|---|----------|--------|--------|
| US1 | New client booking with an unfilled tail → tail saved as anonymous visits with the default tariff | `e2e/anonymous-visits.spec.ts:36` | ✅ |
| US2 | Existing client — saved visitors in rows + 1-seat tail as anonymous | `e2e/anonymous-visits.spec.ts:161` | ✅ |
| US3 | Typing a name into an «Аноним» row converts inline at full capacity | `e2e/anonymous-visits.spec.ts:282` | ✅ |
| US4 | Changing an anonymous row's tariff/price recalculates «Стоимость»/«к оплате» | `e2e/anonymous-visits.spec.ts:345` | ✅ |
| US5 | Deleting an anonymous row — undo restores it, commit frees the seat | `e2e/anonymous-visits.spec.ts:403` | ✅ |
| US6 | Anonymous «пришёл» → record «Пришли»; record cancel cascades and frees the seat | `e2e/anonymous-visits.spec.ts:480` | ✅ |
| US7 | Migration — counter unfolds into anonymous visits inheriting the record status | `backend/tests/test_migration_anonym_unfold.py` | ✅ |

## Test Results

- **pytest (backend):** **1978 passed / 8 skipped** — includes the new
  `test_anonymous_visits.py` (model/API) and `test_migration_anonym_unfold.py` (data migration with
  status inheritance, seats recompute, downgrade semantics).
- **admin vitest:** **2004 passed / 0 failed (128 files)** — fixture sweep plus new/rewritten suites
  for `RecordHeader`, `RecordVisitsTable`, `useRecordMutations`, `ClientTab`/`ClientRecordTab`.
- **`tsc --noEmit`:** clean.
- **e2e:** `anonymous-visits` **6/6**, `unified-rows` **22/22**, `wave6-record-status-derived`
  **4/4**.
- **grep sweep (T11):** zero `anonym_visits` / `anonymVisits` hits anywhere in `backend/src`,
  `backend/tests`, `frontend`, `packages` — the only remaining occurrences are the alembic migration
  (`drop_column`) and the historical spec/plan docs.

## Key Files Changed

- **Backend (prod):** `backend/alembic/versions/dc47abd1ad2d_expand_anonym_visits_into_anonymous_.py`
  (new), `src/models/record.py`, `src/schemas/record.py`, `src/services/record.py`,
  `src/domain/record_visits.py`.
- **Backend (tests):** new `test_anonymous_visits.py`, `test_migration_anonym_unfold.py`;
  updates in `conftest.py`, `test_api_records.py`, `test_api_records_view.py`, `test_edge_cases.py`,
  `test_record_seats_dedup.py`, `test_record_visits.py`, `domain/test_deletion.py`,
  `services/test_delete_cascades.py`, `services/test_visit_service.py`.
- **Frontend (prod):** `hooks/useRecordMutations.ts`,
  `app/components/shared/records/RecordHeader.tsx`,
  `app/components/shared/record/blocks/RecordVisitsTable.tsx`,
  `app/components/shared/record/blocks/RecordSummary.tsx`,
  `app/components/modal/ActivityDetailsModal/ClientTab.tsx`,
  `app/(main)/clients/components/ClientRecordTab.tsx`,
  `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`.
- **Frontend (tests):** 15+ unit suites touched (fixture sweep + behavioral rewrites), new
  `e2e/anonymous-visits.spec.ts`, new `e2e/helpers/anonymous-visits.ts`,
  `e2e/wave6-record-status-derived.spec.ts`.
- **api-client:** `src/schemas.ts`, `src/schemas.test.ts`, `src/endpoints.ts`
  (`anonym_visits` removed).
- **Docs (feature branch):** `docs/domain-rules/records.md` (`c23f94a`),
  `docs/impl/2026-09-16-257-anonym-inventory.md` (`88059f4`); meta: this status file, `PLAN.md`,
  `CHANGELOG.md`.

## Docs Impact

- `docs/specs/2026-09-16-anonymous-visits-unified-design.md` and
  `docs/plans/2026-09-16-anonymous-visits-unified-plan.md` live on main and were not touched here.
- `docs/domain-rules/records.md` is the product-domain doc updated by the implementation (T3,
  `c23f94a`) — seats, anonymous definition, status cascade, capacity re-check.
- `docs/impl/2026-09-16-257-anonym-inventory.md` — Task 1 implementation artifact (consumer
  inventory).
- No `docs/memo-full-spec.md` / `docs/v4-design-system.md` changes: no design-system or
  mock-data model change in this feature.

## Known Non-Blocking Observations

- **Downgrade loses data deliberately:** `downgrade()` re-adds `anonym_visits` empty; the generated
  anonymous visits cannot be folded back (no marker). Accepted in the spec — only test databases are
  in scope; the migration docstring states this.
- **`guests` sort parity pin:** the intermediate "active named visits only" variant (`a9ce603`) was
  reverted (`fe73c26`) to the pre-#257 semantics (all named visits) with a parity test, so the sort
  order is unchanged by this feature.
- **API breaking change** is intentional and user-approved (clean break, no compatibility shim);
  consumers must derive seats from `visits`.

## References

- **GitHub Issue**: #257
- **Design Spec**: `docs/specs/2026-09-16-anonymous-visits-unified-design.md`
- **Plan**: `docs/plans/2026-09-16-anonymous-visits-unified-plan.md`
- **PR**: _(to be added after PR creation)_
