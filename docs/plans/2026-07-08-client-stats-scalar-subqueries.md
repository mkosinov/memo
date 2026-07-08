# Client Stats Scalar-Subqueries Fix (#105) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `list_clients_with_stats` to compute the four client stats via correlated scalar subqueries, eliminating the join-then-aggregate cartesian footgun, and add one guard test.

**Architecture:** Replace the two `outerjoin → GROUP BY` subqueries (`visits_subq`, `payments_subq`) with four independent correlated scalar subqueries (one per stat), each reading exactly one relation. Sort/filter wiring points at the scalar-subquery expressions directly. No API-shape change, no migration, no frontend, no field rename (rename tracked separately in #131).

**Tech Stack:** Python, FastAPI, SQLAlchemy 2.x (async), SQLite, pytest.

---

## Behavioral Delta

How this behaves for the user, mapped to spec acceptance criteria (all observable via `GET /api/v1/clients`):

- **Client with multiple visits + a payment shows correct total** → a client with 1 record, 2 visits, and a 3000 ₽ payment shows `total_paid = 3000` (never doubled).
- **Payments across multiple records still sum correctly** → unchanged behavior.
- **Record count is independent of visit count** → 1 record with 3 visits still counts as `visits_count = 1`.
- **Missed visits still counted by visit** → 2 missed visits → `missed_visits = 2` (field semantics unchanged in #105; rename to record-units is #131).
- **Sorting and stats filters unchanged** → `sort_by=total_paid/visits_count/missed_visits/last_visit`, `min_paid`, `missed_from`, etc. return identical results.

**No visible change** for normal data — this is a structural hardening. The only user-facing guarantee is that the (already-correct) `total_paid` can no longer silently regress to a doubled value if the query is extended later.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/src/services/client.py` | Build & execute the client-stats query | modify (rewrite subquery region + sort/filter maps) |
| `backend/tests/test_client_stats.py` | Integration tests for `GET /api/v1/clients` | modify (add 1 guard test) |

---

## Task 1: Add guard test for cartesian regression (RED-first characterization)

### Classification: standard
### Required Docs
- `docs/specs/2026-07-08-client-stats-scalar-subqueries-design.md` — full design, the exact guard-test spec
- `docs/domain-rules/clients.md` — stats fields (`visits_count`, `last_visit`, `total_paid`, `missed_visits`) and their meaning
- `.opencode/skills/pytest-patterns/SKILL.md` — pytest fixtures, `api_client`, `create_activity`, `create_client`, factory pattern used in this file

### Task Description

Add ONE new test to `backend/tests/test_client_stats.py` that pins the exact combination which triggers the cartesian bug and is currently uncovered: **one client, one record, multiple visits, AND a payment**. The test asserts `total_paid` equals the true payment sum (not multiplied by the visit count), while `visits_count` and `missed_visits` stay correct.

This test acts as the permanent guard: on today's band-aid code it PASSES (band-aid already split the subqueries), and after the Task 2 rewrite it must still PASS. Its value is regression protection — if anyone reintroduces a cross-relation join into the stats query, `total_paid` doubles and this test goes RED.

Place the test inside the existing `class TestClientStatsAggregationExtended` (near `test_total_paid_across_multiple_records`), reusing the module's `_create_client_with_record` and `_add_payment` helpers.

### Steps

- [ ] Read `backend/tests/test_client_stats.py` top helpers (`_create_client_with_record` lines 13-26, `_add_payment` lines 29-37) and `class TestClientStatsAggregationExtended` (line ~901) to match style.
- [ ] Add this test method inside `class TestClientStatsAggregationExtended`:

```python
    def test_total_paid_not_multiplied_by_visit_count(
        self, api_client, create_activity, create_client
    ) -> None:
        """Guard against cartesian product: 1 record with multiple visits + payments.

        total_paid must equal the true payment sum, NOT sum * number_of_visits.
        This is the exact shape that triggered the historical inflated-total bug (#105).
        """
        # 1 record with 2 visits (this is what multiplies payments if joined naively)
        client, record = _create_client_with_record(
            api_client, create_activity, create_client,
            client={"name": "CartesianGuard", "phone": "+79999123456"},
            visits=[
                {"name": "V1", "price": 3500, "status": "missed"},
                {"name": "V2", "price": 2500, "status": "visited"},
            ],
        )
        # 2 payments totaling 3000
        _add_payment(api_client, record["id"], amount=1000, method="card")
        _add_payment(api_client, record["id"], amount=2000, method="cash")

        resp = api_client.get("/api/v1/clients")
        item = next(c for c in resp.json()["items"] if c["id"] == client["id"])

        # total_paid must be exactly 3000, NOT 6000 (= 3000 * 2 visits)
        assert item["total_paid"] == 3000, (
            f"total_paid inflated by cartesian product: got {item['total_paid']}, "
            f"expected 3000 (payments must not be multiplied by visit count)"
        )
        # sanity: other stats unaffected by the same query
        assert item["visits_count"] == 1  # one record, not two visits
        assert item["missed_visits"] == 1  # only the 'missed' visit
```

- [ ] Run the new test in isolation to confirm it passes on current code (characterization):

```bash
cd backend && python -m pytest tests/test_client_stats.py::TestClientStatsAggregationExtended::test_total_paid_not_multiplied_by_visit_count -v
```

Expected output: `1 passed`. (It passes because the band-aid already split subqueries. It becomes a genuine guard once Task 2 lands.)

- [ ] Commit:

```bash
git add backend/tests/test_client_stats.py
git commit -m "test(client-stats): guard against cartesian total_paid inflation (#105)"
```

### Definition of Done
- New test `test_total_paid_not_multiplied_by_visit_count` present in `TestClientStatsAggregationExtended`.
- Test passes on current (pre-rewrite) code.
- Committed.

---

## Task 2: Rewrite stats query as correlated scalar subqueries

### Classification: standard
### Required Docs
- `docs/specs/2026-07-08-client-stats-scalar-subqueries-design.md` — the query-shape design (section "Форма запроса") and behavior-preservation contract
- `docs/domain-rules/clients.md` — stats field semantics & sort columns (must stay identical)
- `.opencode/skills/fastapi-clean-architecture/SKILL.md` — service-layer conventions

### Task Description

Rewrite the query-building region of `list_clients_with_stats` (`backend/src/services/client.py`, currently lines ~38-93) to replace `visits_subq` and `payments_subq` with **four correlated scalar subqueries**, each labeled, and wire them into `base_cols`, `count_query`, the main `query`, `sort_column_map`, and `stats_filter_map`.

**Key facts about the models (verified):**
- `Record` is soft-delete (`AbstractModelSoftDelete`, has `is_active`). Filter `Record.is_active` in every stat.
- `Visit` and `Payment` are hard-delete (`AbstractModel`, NO `is_active`) — do NOT filter their `is_active` (the column does not exist).
- Relations: `Visit.record_id == Record.id`, `Payment.record_id == Record.id`, `Record.client_id`.

**Semantics that MUST be preserved exactly:**
- `visits_count` = number of **records** for the client (`count(Record.id)`), NOT visits.
- `missed_visits` = number of **visits** with `status == "missed"`.
- `total_paid` = `coalesce(sum(Payment.amount), 0)`.
- `last_visit` = `max(Visit.created_at)`.
- `NULL`/absent stats coalesce to 0 (and `last_visit` → `None`) exactly as today.

**Correlated scalar subqueries** (each correlates on the OUTER `Client.id`; use `.correlate(Client)` and `.scalar_subquery()`):

```python
from sqlalchemy import case, func, select
# ... existing imports: Client, Payment, Record, Visit ...

# visits_count: number of ACTIVE records for this client
records_count_sq = (
    select(func.count(Record.id))
    .where(Record.client_id == Client.id, Record.is_active == True)  # noqa: E712
    .correlate(Client)
    .scalar_subquery()
)

# last_visit: most recent visit datetime across this client's active records
last_visit_sq = (
    select(func.max(Visit.created_at))
    .select_from(Visit)
    .join(Record, Visit.record_id == Record.id)
    .where(Record.client_id == Client.id, Record.is_active == True)  # noqa: E712
    .correlate(Client)
    .scalar_subquery()
)

# missed_visits: number of visits with status 'missed' across active records
missed_visits_sq = (
    select(func.count(Visit.id))
    .select_from(Visit)
    .join(Record, Visit.record_id == Record.id)
    .where(
        Record.client_id == Client.id,
        Record.is_active == True,  # noqa: E712
        Visit.status == "missed",
    )
    .correlate(Client)
    .scalar_subquery()
)

# total_paid: sum of payment amounts across active records (never multiplied)
total_paid_sq = (
    select(func.coalesce(func.sum(Payment.amount), 0))
    .select_from(Payment)
    .join(Record, Payment.record_id == Record.id)
    .where(Record.client_id == Client.id, Record.is_active == True)  # noqa: E712
    .correlate(Client)
    .scalar_subquery()
)
```

Then label them for use in SELECT / ORDER BY / WHERE:

```python
visits_count_col = records_count_sq.label("visits_count")
last_visit_col = last_visit_sq.label("last_visit")
missed_visits_col = missed_visits_sq.label("missed_visits")
total_paid_col = total_paid_sq.label("total_paid")
```

### Steps

- [ ] Open `backend/src/services/client.py`. Replace the block from `# 1a. Visits subquery` through the end of the main `query` construction (`.outerjoin(payments_subq, ...)`, ~lines 38-93) with the scalar-subquery version below.

- [ ] Replace `base_cols` and query construction. The `count_query` no longer needs to join stat subqueries (count of clients doesn't depend on stats) — keep it as a plain `select(func.count(Client.id))`:

```python
    # 1. Correlated scalar subqueries — one per stat, each reads ONE relation
    #    (no join-then-aggregate → cartesian product is structurally impossible).
    records_count_sq = (
        select(func.count(Record.id))
        .where(Record.client_id == Client.id, Record.is_active == True)  # noqa: E712
        .correlate(Client)
        .scalar_subquery()
    )
    last_visit_sq = (
        select(func.max(Visit.created_at))
        .select_from(Visit)
        .join(Record, Visit.record_id == Record.id)
        .where(Record.client_id == Client.id, Record.is_active == True)  # noqa: E712
        .correlate(Client)
        .scalar_subquery()
    )
    missed_visits_sq = (
        select(func.count(Visit.id))
        .select_from(Visit)
        .join(Record, Visit.record_id == Record.id)
        .where(
            Record.client_id == Client.id,
            Record.is_active == True,  # noqa: E712
            Visit.status == "missed",
        )
        .correlate(Client)
        .scalar_subquery()
    )
    total_paid_sq = (
        select(func.coalesce(func.sum(Payment.amount), 0))
        .select_from(Payment)
        .join(Record, Payment.record_id == Record.id)
        .where(Record.client_id == Client.id, Record.is_active == True)  # noqa: E712
        .correlate(Client)
        .scalar_subquery()
    )

    visits_count_col = records_count_sq.label("visits_count")
    last_visit_col = last_visit_sq.label("last_visit")
    missed_visits_col = missed_visits_sq.label("missed_visits")
    total_paid_col = total_paid_sq.label("total_paid")

    # 2. Select Client columns + the four stat scalar subqueries
    base_cols = [
        Client.id,
        Client.name,
        Client.phone,
        Client.email,
        Client.channel,
        Client.created_at,
        Client.updated_at,
        Client.is_active,
        visits_count_col,
        last_visit_col,
        total_paid_col,
        missed_visits_col,
    ]

    # 3. Count query (total matching clients) — independent of stats
    count_query = select(func.count(Client.id))

    # 4. Main query — no outerjoin to stat subqueries; scalar subqueries are inline
    query = select(*base_cols)
```

- [ ] Update `stats_filter_map` to reference the RAW scalar-subquery expressions (NOT the `.label()` columns). This matters: the filters are applied to BOTH `query` and the simplified `count_query` (which has no FROM entry for a labeled column), so the maps must use the correlated subquery expression itself, which is valid in any `WHERE`/`ORDER BY` against `Client`:

```python
    stats_filter_map = {
        "min_visits": records_count_sq,
        "max_visits": records_count_sq,
        "min_paid": total_paid_sq,
        "max_paid": total_paid_sq,
        "missed_from": missed_visits_sq,
        "missed_to": missed_visits_sq,
    }
```

- [ ] Update `sort_column_map` likewise — use the RAW scalar-subquery expressions:

```python
    sort_column_map = {
        "name": Client.name,
        "visits_count": records_count_sq,
        "last_visit": last_visit_sq,
        "total_paid": total_paid_sq,
        "missed_visits": missed_visits_sq,
        "created_at": Client.created_at,
        "updated_at": Client.updated_at,
    }
```

- [ ] RATIONALE (why raw expressions, not labels): the old code applied stats filters to `count_query` too (lines ~152-153: `count_query = count_query.where(condition)`). The old `count_query` joined `visits_subq`, so its columns were in scope. The new `count_query = select(func.count(Client.id))` has NO stat join — a `.label()` bound to the main query's SELECT is NOT in scope there. A correlated `.scalar_subquery()` expression, by contrast, is self-contained and valid in any statement selecting from/counting `Client`. So the maps MUST hold the raw `*_sq` expressions. The `.label()` versions are used ONLY in `base_cols` (so the row mapper can read `row.visits_count` etc.). Keep `.desc().nullslast()` / `.asc().nullsfirst()` on the sort expression exactly as today.

- [ ] The row-mapping loop (`for row in rows:` … `ClientWithStats(...)`) is UNCHANGED — it reads `row.visits_count`, `row.last_visit`, `row.total_paid`, `row.missed_visits` by label, which still exist. Confirm no edits needed there.

- [ ] Run the FULL client-stats suite (must stay green):

```bash
cd backend && python -m pytest tests/test_client_stats.py -v
```

Expected: all tests pass (including Task 1's guard and the 4 `@pytest.mark.xfail` page/per_page tests still xfailing as before).

- [ ] Run the client API suite + schema tests to catch contract regressions:

```bash
cd backend && python -m pytest tests/test_api_clients.py tests/test_schemas_client.py -v
```

Expected: all pass.

- [ ] Run the full backend suite to confirm nothing else broke:

```bash
cd backend && python -m pytest -q
```

Expected: same pass/xfail baseline as before the change (no NEW failures).

- [ ] Commit:

```bash
git add backend/src/services/client.py
git commit -m "refactor(client-stats): compute stats via correlated scalar subqueries (#105)"
```

### Definition of Done
- `list_clients_with_stats` uses four correlated scalar subqueries; no `outerjoin` to stat subqueries remains.
- `visits_subq` / `payments_subq` fully removed.
- `test_client_stats.py` (all, incl. Task 1 guard), `test_api_clients.py`, `test_schemas_client.py` green.
- Full backend suite shows no NEW failures vs baseline.
- Committed.

---

## Self-Review

- **Spec coverage:** Task 2 implements the scalar-subquery rewrite (spec §"Решение"); Task 1 implements the single guard test (spec §"Новый тест-сторож"). Behavior-preservation contract enforced by keeping all existing tests green. ✅
- **No rename:** field labels stay `visits_count`/`missed_visits`/`last_visit` (rename is #131). ✅
- **No migration / no frontend:** none introduced. ✅
- **Placeholder scan:** none. ✅
- **Type consistency:** labeled columns reused across SELECT/sort/filter; row mapping unchanged. ✅
- **Required Docs:** each task has the section. ✅

---

## Notes for reviewer / architect
- The `count_query` simplification (dropping the outerjoin to `visits_subq`) is safe because the previous outerjoin never filtered rows (it was `outerjoin`, so all clients counted regardless of stats). Stats filters are applied to `count_query` separately in the existing filter loop — verify those still attach correctly after the map change.
- If SQLAlchemy rejects a `.label()` in a `WHERE`/`ORDER BY` position (rare), fall back to the raw `.scalar_subquery()` expression in the maps (see the IMPORTANT step). This is the only anticipated friction point.
