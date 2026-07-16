# Design: Backend Health — N+1, Capacity Re-check, Dedup Seats (#129)

**Date:** 2026-07-16
**Issue:** [#129](https://github.com/mkosinov/memo/issues/129)
**Type:** Backend tech-debt (perf + correctness)
**Workflow:** Full (brainstorming → spec → plan → TDD)

---

## 1. Context

Read-only backend audit (2026-07-08) found a cluster of service/domain-layer health
issues in #129: non-atomic cascades, N+1 queries, duplicated business rules, and a
missing capacity re-check on update/patch.

During brainstorming (2026-07-16) we re-read the actual code and **narrowed the scope**:

- **"Non-atomic cascades" is already mitigated.** `DBManager.get_db_session`
  (`backend/src/db/database.py:24-32`) wraps every request in a transaction:
  `commit()` on success, `rollback()` on ANY exception. All `flush()` calls in the
  cascades only write to the transaction buffer — they do not commit. If anything
  raises mid-cascade, the whole request rolls back → no partial/orphan state can
  persist. Explicit `async with session.begin()` boundaries would be
  defense-in-depth/readability, not a correctness fix. **Deferred** to a separate
  cleanup issue.

- **#98 already unified the "active record" definition** via
  `domain.record_visits.active_record_filter()` (shared by capacity check and the
  occupied view). That dependency is resolved.

This spec covers the three items with real user value.

### Scope

**IN:**
1. **N+1 fix** in `list_activities` — one batched aggregate instead of one `SUM`
   per activity.
2. **Capacity re-check on update/patch** — a growing record can currently exceed
   activity capacity silently.
3. **Dedup seats rule** — remove dead inline `seats` computation; single source of
   truth via `recompute_record_seats`.

**OUT (deferred to separate cleanup issues, out of #129 for this PR):**
- Explicit transaction boundaries (already atomic via session model).
- Remaining N+1 sweeps: `reorder` loops, per-tag insert, `_resolve_visitor_by_name`
  per-visit SELECT.
- Cosmetic: `datetime.utcnow()` deprecation, unused `lru_cache` on stateless repos,
  duplicated `dt_to_str`.

**No schema changes. No API contract changes. Backend only.** The frontend is
unaffected: `ActivityResponse.occupied` remains the same field with the same
semantics — only how the backend computes it changes.

---

## 2. Section 1 — N+1 fix in `list_activities`

### Problem

`api/v1/activities.py:51` maps each activity through `_to_response`, which calls
`service.sum_active_seats(activity_id)` — one `SUM` query per activity. A week view
of 7–21 activities = 7–21 round-trips (1 + N).

### Chosen approach: batch aggregate method (Option A)

Add a batch method on `ActivityService`:

```python
async def sum_active_seats_bulk(
    self, db_session: AsyncSession, activity_ids: list[str]
) -> dict[str, int]:
    """Return {activity_id: occupied_seats} for the given activities in ONE query.

    Active definition reuses ACTIVE_RECORD_STATUSES (same as active_record_filter)
    so the batch view can never drift from the per-activity capacity check.
    """
    if not activity_ids:
        return {}
    result = await db_session.execute(
        select(Record.activity_id, func.coalesce(func.sum(Record.seats), 0))
        .where(
            Record.activity_id.in_(activity_ids),
            Record.is_active.is_(True),
            Record.status.in_(ACTIVE_RECORD_STATUSES),
        )
        .group_by(Record.activity_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}
```

`list_activities` calls it **once**, then maps responses from the dict (defaulting to
`0` for activities with no active records):

```python
activities = await service.list(db_session=session, date_from=..., date_to=...)
occupied_map = await service.sum_active_seats_bulk(
    db_session=session, activity_ids=[a.id for a in activities]
)
return [
    _map_activity_response(a, occupied=occupied_map.get(a.id, 0))
    for a in activities
]
```

- `get_activity` (single) keeps using the existing `sum_active_seats` — no N+1 there.
- `_to_response` may be split into a pure mapper (no DB) + the single-activity path
  that still computes occupied via `sum_active_seats`. Exact refactor decided in plan.
- The `ACTIVE_RECORD_STATUSES` constant is reused directly — no rule duplication.

### Rejected alternatives

- **B — `column_property`/correlated subquery on the `Activity` model.** Elegant in
  the abstract, but it forces the "active record" business rule
  (`status IN ('waiting','visited')`) **into the model**, because the model cannot
  cleanly import the domain filter (import cycles: `models/activity` ↔ `domain` ↔
  `models/record`). That re-duplicates the exact rule #98 just unified and #129 item 4
  wants to remove — it works *against* the issue's goal. It also computes `occupied`
  on **every** `Activity` load (even where unneeded) and is harder to unit-test. The
  codebase deliberately keeps thin models + domain-layer rules; B violates that style.
- **C — leave as-is.** Rejected; this is the biggest easy perf win in #129.

---

## 3. Section 2 — Capacity re-check on update/patch

### Problem

`check_activity_capacity` runs only in `RecordService.create`. `RecordService.update`
(`record.py:192`) and `patch` (`record.py:230`) let the visits list or `anonym_visits`
change with **no capacity re-check** → a record can silently grow past the activity's
capacity.

### Chosen behavior (user decision, 2026-07-16)

**409, symmetric with `create`.** If the record's new seat count would push the
activity over capacity → raise `HTTPException(409, ACTIVITY_AT_CAPACITY)`; the update
rolls back (session model). Shrinking a record is always allowed.

### Chosen approach: check after removing the record's own visits (Variant 1)

The naive re-check double-counts the record's own existing seats (the record already
sits in the occupied sum for its activity). Rather than add an `exclude_record_id`
branch to the domain filter, we exploit the fact that update/patch **already delete
old visits and insert new ones**. We reorder so the capacity check happens **after**
the record's own visits are removed (and its `anonym_visits` set to the new value):

**Order of operations in `update` / `patch` (when visits or anonym_visits change):**

1. Delete the record's existing visits (flush).
2. Set `record.anonym_visits` to the new value.
3. **Recompute `record.seats` via `recompute_record_seats` BEFORE the check.**
   This is load-bearing: `check_activity_capacity` sums the stored `Record.seats`
   **column** (`domain/record_visits.py:106-111`), NOT live visit counts. Deleting
   visits does not change `Record.seats` — it keeps its old value until recompute
   runs. Without this step the occupied sum still includes this record's stale old
   seats → double-count → a shrink would falsely 409. After recompute, the record's
   own contribution to the sum = 0 visits + new anonym.
4. Compute `effective_seats = len(new_visits) + new_anonym_visits`.
5. Call the **unchanged** `check_activity_capacity(db_session, activity_id,
   seats=effective_seats)` — same function used by `create`. Because the record's own
   seats were reset in step 3, the occupied sum now reflects only *other* records +
   this record's (new) anonym count. No `exclude_record_id` needed.
6. If over capacity → raise 409 → transaction rolls back → deleted visits restored on
   disk (nothing was committed).
7. If OK → insert the new visits, then `recompute_record_seats` (again, now with the
   new visits) + `recompute_record_status` as today. The extra recompute in step 3 is
   idempotent — recomputing twice is harmless.

**`check_activity_capacity` and `active_record_filter` are NOT modified.** Zero new
domain code. The only change is the *order* of existing operations plus the added
call.

### Critical implementation note

The capacity check must sit **between** the delete-old-visits step and the
insert-new-visits step. This ordering is load-bearing (it is what avoids the double
count) and MUST be preserved. The plan will call this out explicitly per method.

### When to skip the check

- **`update`** always sends the full visits list → always re-check.
- **`patch`** only re-checks when the patch actually touches `visits` or
  `anonym_visits`. A patch of only `comment`/`custom_price` does not change seats →
  skip the capacity query (avoid a pointless SQL round-trip on every comment edit).

### Rejected alternatives

- **Variant 3 — `exclude_record_id` param on `active_record_filter`.** Explicit
  ("exclude me from the sum") but adds a branch to the shared domain filter and more
  code. Rejected in favor of the simpler reordering.
- **Variant 2 — compute in Python from the N+1 batch result.** Couples the perf
  method into record-write logic and links two unrelated modules. Rejected.

---

## 4. Section 3 — Dedup seats rule

### Problem

"Compute seats" is spread across two forms:

- `record.py:205` (in `update`): `record.seats = len(data.visits) + (data.anonym_visits or 0)`
  — **dead code**: line 224 immediately overwrites it via `recompute_record_seats`.
- `record.py:121` (in `create`): `seats=effective_seats` in the `Record(...)`
  constructor — and `create` does **not** call `recompute_record_seats` after
  flushing visits (only `recompute_record_status` at line 143). So in `create` the
  inline form is the only final computation.

### Solution

1. **Remove the dead line 205** in `update` (already overwritten).
2. **Add `recompute_record_seats` in `create`** after the visits flush (after line
   140), matching `update`/`patch`.
3. The `effective_seats = len(data.visits) + anonym` inline form **stays only where it
   is genuinely needed**: computing seats **before** visits exist in the DB, for the
   capacity check (`create` line 91, and the new update/patch check). That is
   meaningful pre-insert arithmetic, not a duplicated rule.

**Result:** the single source of truth for a record's *final persisted* `seats` is
`recompute_record_seats` (count of visits in DB + anonym), used identically in
create/update/patch. Behavior is unchanged (for `create`, post-insert
`count(visits) == len(data.visits)`), but the rule lives in one place.

---

## 5. User Scenarios

Because #129 is backend-health with no UI-contract change, scenarios are expressed as
API/service behaviors and map to **pytest** tests (not E2E).

| # | Scenario | Verifies | Test |
|---|----------|----------|------|
| **US-1** | Listing a week of activities that have records returns correct `occupied` per activity | N+1 fix preserves correctness: batch sum == old per-activity sum | pytest — API list |
| **US-2** | `list_activities` issues a fixed number of queries regardless of activity count | N+1 actually eliminated (one GROUP BY, not 1+N) | pytest — query counter via SQLAlchemy event listener |
| **US-3** | An activity with 0 active records returns `occupied=0` in the list | batch dict returns 0 for missing keys | pytest — API list |
| **US-4** | Update a record so seats exceed activity capacity → 409 ACTIVITY_AT_CAPACITY, record unchanged | capacity re-check on update + rollback | pytest — API update |
| **US-5** | Patch a record's `visits` so seats exceed capacity → 409 | capacity re-check on patch | pytest — API patch |
| **US-6** | Update that shrinks seats → succeeds | shrink always allowed | pytest — API update |
| **US-7** | Patch only `comment` on a full activity → succeeds without 409 | capacity check skipped when seats untouched | pytest — API patch |
| **US-8** | Create + Update + Patch yield the same final `seats` for the same visit set | dedup: single `recompute_record_seats` across all paths | pytest — service |
| **US-9** | On a **fully-booked** activity (occupied == capacity), update/patch a record's visit fields (`price`, `tariff_id`, re-link `visitor_id`) **without changing the seat count** → 200, fields updated | capacity check subtracts the record's own seats before comparing, so same-size edits on a full activity are allowed | pytest — API update + patch |

US-2 is the anchor test: it pins the query count so an N+1 regression cannot silently
return during future refactors.

US-9 is the anchor for the "edit-in-place on a full activity" guarantee: because the
capacity re-check recomputes the record's own seats to their new value *before*
summing occupied, an edit that keeps the seat count constant never trips 409 even when
`occupied == capacity`. This is the behavior an admin relies on (change price/tariff on
a sold-out class). It is distinct from US-6 (shrink): US-9 keeps size *equal*, at the
capacity boundary. **Note:** changing a Visitor's `name`/`age` is NOT done via
record update/patch (those paths re-link `visitor_id` but ignore `name`/`age`) — that
is a separate concern, out of scope for #129.

---

## 6. Testing Strategy

- **Framework:** pytest (backend), sync `TestClient` for API-level scenarios, direct
  service calls for US-8. See `pytest-patterns` skill.
- **N+1 assertion (US-2):** register a SQLAlchemy `before_cursor_execute` event
  listener to count executed statements across the `list_activities` call; assert the
  count does not scale with the number of activities (seed N activities, assert query
  count is constant / bounded, not `~N`).
- **Capacity scenarios (US-4/5/6/7):** seed an activity at/near capacity, exercise
  update/patch, assert 409 vs 200 and that a rolled-back update left the record
  unchanged (re-fetch and compare).
- **Regression:** full backend suite must stay green (currently ~649 passing).

---

## 7. Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Reordering delete→check→insert in update/patch subtly changes `seats`/`status` timing | US-8 pins cross-path seat equality; recompute_* still runs after insert as today |
| 2 | Capacity check accidentally double-counts the record's own seats | Variant 1 removes own visits *before* the check; US-4/US-6 assert exact boundary behavior |
| 3 | N+1 refactor changes `occupied` for edge cases (0 records, cancelled/missed records) | US-1/US-3 assert correctness; batch query reuses ACTIVE_RECORD_STATUSES |
| 4 | Patch capacity check fires on non-seat patches → wasted query | Skip check unless `visits`/`anonym_visits` present in patch (US-7 guards this) |
| 5 | Batch query returns no row for activities with 0 records → KeyError | `.get(a.id, 0)` default; US-3 covers |

---

## 8. Out of Scope (explicit)

- Transaction boundaries (`async with session.begin()`) — already atomic via session.
- N+1 in `reorder`, per-tag insert, `_resolve_visitor_by_name` — separate cleanup.
- Cosmetic: `datetime.utcnow()`, unused `lru_cache`, `dt_to_str` dedup — separate cleanup.
- Any frontend change — none; API contract unchanged.
- `#95` (anonym_visits UI indication) — separate product decision.
