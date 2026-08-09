# Records Server-Side Filters + Pagination + Sorting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Records admin page filtering, pagination, and sorting to the server (mirroring the Clients page), removing all client-side filter/sort/slice logic.

**Architecture:** Backend — validated `RecordListParams` (FastAPI Query Parameter Model, `Annotated[_, Query()]`), hand-written business filters in `RecordService.list` over a `records JOIN activities` statement, whitelist sort-column map with correlated scalar subqueries (incl. a CASE payment-bucket), shared `paginate_orm` core (COUNT before ORDER BY), shared `day_range` date util reused by the activities refactor. Frontend — `RecordsContext` holds page/filters/sort in state (mirrors `ClientsContext`), caches the envelope, exposes server `total`; `RecordsTable` is re-wired to context; two modals get dedicated queries; cache-sync helpers become shape-agnostic (envelope + array).

**Tech Stack:** FastAPI 0.136.3, SQLAlchemy 2 async, SQLite, Pydantic v2 / Next.js 14, TanStack Query v5, Zod (api-client), vitest, Playwright.

**Spec:** `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` (approved at G1b 2026-08-08, incl. `date_from > date_to` → 422)

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **All filter params + 422 validation (§10.1)** → The Records page filters (dates, Локация, Услуга, Мастер, Статус) now filter on the server. Manually entering a nonsense URL (bad date, `sort_by=xyz`, unknown status, `date_from` after `date_to`) returns a clean "validation error" — never a 500 crash, never silent ignoring.
- **Whole-day inclusive date filter (§10.2)** → Picking "Дата до 08.08" includes ALL records of Aug 8 up to 23:59 — same as today, now enforced by the server.
- **Filters via Activity JOIN, correct `total` (§10.3)** → Any filter combination shows "N всего" matching the true filtered count; filters combine (e.g. master + status + period).
- **9 server sort keys, correct across pages (§10.4)** → Clicking any of the 9 column headers re-sorts the WHOLE filtered result, not just visible rows. "Оплата" ascending shows Оплачено → Частично → Не оплачено. Order is stable when paging.
- **Activities 422 + no duplication (§10.5)** → A garbage date on the activities endpoint returns 422 instead of crashing with 500. No visible change otherwise.
- **Context drives pagination UI (§10.6)** → Page buttons / "Строк:" selector / "N всего" are driven by real server data. Changing any filter or date range returns to page 1.
- **No client-side logic in RecordsTable (§10.7)** → The table renders exactly what the server sends; payment badges look and behave as before.
- **Modals keep working (§10.8, §10.9)** → Client card (from Records page AND from Clients page) shows the client's full history with correct payment badges; schedule-page activity modal still lists all bookings of the activity — even with >100 records in the database.
- **>100 records reachable (Scenario 2)** → Nothing is silently truncated anymore; all pages are reachable via the pagination controls.

## File Structure

### Backend
| File | Change |
|---|---|
| `backend/src/domain/dates.py` | CREATE — `day_range()` shared util |
| `backend/tests/test_domain_dates.py` | CREATE — util tests |
| `backend/src/schemas/record.py` | MODIFY — add `RecordListParams` + Literal aliases |
| `backend/tests/test_record_list_params.py` | CREATE — schema validation tests |
| `backend/src/services/generic.py` | MODIFY — extract `paginate_orm` core; `_paginate` counts before ordering |
| `backend/src/services/record.py` | MODIFY — `list(params)` rewrite + `_sort_columns` whitelist map |
| `backend/src/api/v1/records.py` | MODIFY — `params: Annotated[RecordListParams, Query()]` |
| `backend/src/services/activity.py` | MODIFY — `_list_by_date` via `day_range` + `_paginate`; signatures str→date |
| `backend/src/api/v1/activities.py` | MODIFY — `date_from`/`date_to` typed `date` |
| `backend/tests/test_api_records.py` | MODIFY — new filter/sort/422 test classes |
| `backend/tests/services/test_record_service.py` | MODIFY — params-model call signature |
| `backend/tests/test_api_activities.py` | MODIFY — invalid-date → 422 test |

### Frontend
| File | Change |
|---|---|
| `packages/api-client/src/endpoints.ts` | MODIFY — `getRecords` new params |
| `packages/api-client/src/endpoints.test.ts` | MODIFY — URL-building tests |
| `frontend/admin/lib/cache/recordCacheSync.ts` | MODIFY — `mapRecordsListCache` shape guard |
| `frontend/admin/hooks/useRecordMutations.ts` | MODIFY — deleteRecord uses the guard |
| `frontend/admin/contexts/RecordsContext.tsx` | MODIFY — server-driven state (page/filters/sort/total) |
| `frontend/admin/app/(main)/records/components/RecordsTable.tsx` | MODIFY — delete client-side logic, wire to context |
| `frontend/admin/app/(main)/records/page.tsx` | MODIFY — filter state from context |
| `frontend/admin/app/(main)/records/components/ClientCardModal.tsx` | MODIFY — dedicated queries |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` | MODIFY — dedicated `['records','activity',id]` query |
| `frontend/admin/__tests__/helpers/mockContexts.ts` | MODIFY — new context mock shape |
| `frontend/admin/__tests__/RecordsContext.test.tsx` | MODIFY — new keys + state tests |
| `frontend/admin/__tests__/recordCacheSync.test.ts` | MODIFY — envelope + array cache tests |
| `frontend/admin/__tests__/useRecordMutations.test.ts` | MODIFY — envelope seeds + both-shapes delete test |
| `frontend/admin/__tests__/RecordsTable.test.tsx` | MODIFY — drop client-sort test, add wiring tests |
| `frontend/admin/__tests__/ActivityDetailsModal.test.tsx` | MODIFY — mock records query |
| `frontend/admin/e2e/records.spec.ts` | MODIFY — honest server-side rework |
| `frontend/admin/e2e/fixtures/helpers.ts` | MODIFY — modal helper waits for activity-records fetch |

---

## Task 1: Shared `day_range` date util

### Classification: small
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §5.2 — util contract
- Skill: `pytest-patterns`

### Task Description

Create the shared date-range helper used by records and activities list services.

**Files:**
- Create: `backend/src/domain/dates.py`
- Test: `backend/tests/test_domain_dates.py`

### Steps

- [ ] 1. Write the failing test `backend/tests/test_domain_dates.py`:

```python
"""Unit tests for the shared day_range util (#191)."""

from datetime import date, datetime

from src.domain.dates import day_range


def test_day_range_both_bounds():
    from_dt, to_dt = day_range(date(2026, 8, 3), date(2026, 8, 9))
    assert from_dt == datetime(2026, 8, 3, 0, 0, 0)
    assert to_dt == datetime(2026, 8, 9, 23, 59, 59, 999999)


def test_day_range_from_only():
    from_dt, to_dt = day_range(date(2026, 8, 3), None)
    assert from_dt == datetime(2026, 8, 3, 0, 0, 0)
    assert to_dt is None


def test_day_range_to_only():
    from_dt, to_dt = day_range(None, date(2026, 8, 9))
    assert from_dt is None
    assert to_dt == datetime(2026, 8, 9, 23, 59, 59, 999999)


def test_day_range_none():
    assert day_range(None, None) == (None, None)


def test_day_range_year_9999_no_overflow():
    _, to_dt = day_range(None, date(9999, 12, 31))
    assert to_dt == datetime(9999, 12, 31, 23, 59, 59, 999999)
```

- [ ] 2. Run `cd backend && python -m pytest tests/test_domain_dates.py -q` — expect FAIL (ModuleNotFoundError).
- [ ] 3. Create `backend/src/domain/dates.py`:

```python
"""Shared date-range helpers — technical mechanism shared by list services (#191)."""

from datetime import date, datetime, time


def day_range(
    date_from: date | None, date_to: date | None
) -> tuple[datetime | None, datetime | None]:
    """Convert inclusive YYYY-MM-DD bounds to an inclusive [from_dt, to_dt] datetime range.

    Whole-day inclusive semantics: date_from covers from 00:00:00, date_to covers
    through 23:59:59.999999 (datetime.combine idiom — same as client.py created_*;
    overflow-free, no year-9999 edge case).
    """
    from_dt = datetime.combine(date_from, time.min) if date_from is not None else None
    to_dt = datetime.combine(date_to, time.max) if date_to is not None else None
    return from_dt, to_dt
```

- [ ] 4. Run tests — all 5 pass.
- [ ] 5. Commit: `feat(backend): shared day_range date util (#191)`

---

## Task 2: `RecordListParams` schema

### Classification: small
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §5.1 — params contract, validation decisions
- `docs/domain-rules/records.md` — status enum values
- Skill: `pytest-patterns`

### Task Description

Add the validated query-params model. It is injected in Task 4 via `Annotated[RecordListParams, Query()]` — the official FastAPI Query Parameter Models pattern (Depends() + model_validator would 500 — panel-verified).

**Files:**
- Modify: `backend/src/schemas/record.py` (append at end)
- Test: `backend/tests/test_record_list_params.py`

### Steps

- [ ] 1. Write the failing test `backend/tests/test_record_list_params.py`:

```python
"""Validation tests for RecordListParams (#191)."""

from datetime import date

import pytest
from pydantic import ValidationError

from src.schemas.record import RecordListParams


def test_defaults():
    p = RecordListParams()
    assert (p.page, p.per_page, p.sort_by, p.sort_order) == (1, 20, "date", "asc")
    assert p.status is None and p.client_id is None and p.activity_id is None


def test_invalid_status_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(status="bogus")


def test_invalid_sort_by_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(sort_by="nonexistent")


def test_invalid_sort_order_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(sort_order="sideways")


@pytest.mark.parametrize("per_page", [0, 101])
def test_per_page_bounds(per_page):
    with pytest.raises(ValidationError):
        RecordListParams(per_page=per_page)


def test_page_bound():
    with pytest.raises(ValidationError):
        RecordListParams(page=0)


def test_garbage_date_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(date_from="not-a-date")


def test_date_range_inverted_rejected():
    with pytest.raises(ValidationError, match="date_from"):
        RecordListParams(date_from=date(2026, 8, 9), date_to=date(2026, 8, 3))


def test_date_range_valid():
    p = RecordListParams(date_from=date(2026, 8, 3), date_to=date(2026, 8, 9))
    assert p.date_from == date(2026, 8, 3)
```

- [ ] 2. Run `cd backend && python -m pytest tests/test_record_list_params.py -q` — expect FAIL (ImportError).
- [ ] 3. In `backend/src/schemas/record.py`: extend imports — add `date` to the datetime import (create `from datetime import date` if absent), add `from typing import Literal`, add `model_validator` to the pydantic import. Append:

```python
RecordSortBy = Literal[
    "date", "client", "service", "master", "location",
    "guests", "status", "total", "payment",
]
RecordSortOrder = Literal["asc", "desc"]
RecordStatusFilter = Literal["waiting", "visited", "missed", "cancelled"]


class RecordListParams(BaseModel):
    """Query parameters for GET /api/v1/records with filtering, pagination, sorting (#191).

    Injected as FastAPI Query Parameter Model: `Annotated[RecordListParams, Query()]`.
    NOT Depends() — Depends-injected models + model_validator raise 500 (fastapi#4974).
    """

    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
    client_id: str | None = None
    activity_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    location_id: str | None = None
    service_id: str | None = None
    master_id: str | None = None
    status: RecordStatusFilter | None = None
    sort_by: RecordSortBy = "date"
    sort_order: RecordSortOrder = "asc"

    @model_validator(mode="after")
    def _check_date_range(self) -> "RecordListParams":
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be on or before date_to")
        return self
```

- [ ] 4. Run tests — all 9 pass.
- [ ] 5. Commit: `feat(backend): RecordListParams validated query model (#191)`

---

## Task 3: Shared `paginate_orm` core in generic.py

### Classification: standard
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §5.5 — COUNT-before-ORDER rationale
- Skill: `pytest-patterns`

### Task Description

Extract the COUNT+slice core from `GenericService._paginate` into a module-level `paginate_orm` so `RecordService` (ORM items) and `ActivityService` can share it. Behavioral contract: COUNT is computed on the statement BEFORE `order_by` is applied (sort-key subqueries must not be evaluated inside the count). Semantics for existing consumers unchanged — the entire backend suite is the regression gate.

**Files:**
- Modify: `backend/src/services/generic.py`

### Steps

- [ ] 1. Current `_paginate` (generic.py:72-84) counts AFTER applying `order_by`. Add the module-level function (imports `select`, `func`, `AsyncSession` already exist in the file):

```python
async def paginate_orm(
    db_session: AsyncSession, stmt, page: int, per_page: int, order_by=None
) -> tuple[list, int]:
    """Shared pagination core (#191): COUNT the (unordered) statement, then ORDER + slice.

    COUNT is computed BEFORE order_by is applied so correlated sort-key
    subqueries are never evaluated inside the count query.
    Returns (orm_items, total).
    """
    total = (
        await db_session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    if order_by is not None:
        stmt = stmt.order_by(*order_by)
    result = await db_session.execute(
        stmt.limit(per_page).offset((page - 1) * per_page)
    )
    return list(result.scalars().all()), total
```

- [ ] 2. Rewrite `GenericService._paginate` as a thin wrapper:

```python
    async def _paginate(
        self, db_session: AsyncSession, stmt, page: int, per_page: int, order_by=None
    ) -> PaginatedResponse[ResponseSchemaT]:
        items_orm, total = await paginate_orm(db_session, stmt, page, per_page, order_by)
        items = [self._response_schema.model_validate(o) for o in items_orm]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

- [ ] 3. Run the FULL backend suite: `cd backend && python -m pytest tests -q` — expect ALL green (1008 passed / 5 skipped baseline; identical count). Any failure = regression in the shared path — investigate, do not patch tests.
- [ ] 4. Commit: `refactor(backend): extract shared paginate_orm core, count before order (#191)`

---

## Task 4: `RecordService.list` rewrite + router wiring + API tests

### Classification: large
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §5.1–5.3, §6 — filters, sort map, payment bucket, determinism, collation note
- `docs/domain-rules/records.md` — status derivation, seats/anonym_visits (note: code truth = `seats = len(visits) + anonym_visits`)
- `docs/domain-rules/payments.md` — payment status thresholds
- Skill: `pytest-patterns`

### Task Description

Rewrite the records list endpoint: JOIN Activity, hand-written business filters, whitelist sort map with correlated subqueries, deterministic tiebreak, shared pagination. Router takes the Query params model. Full API test matrix per spec §9.1.

**Files:**
- Modify: `backend/src/services/record.py`
- Modify: `backend/src/api/v1/records.py`
- Modify: `backend/tests/services/test_record_service.py` (params-model call)
- Modify: `backend/tests/test_api_records.py` (new test classes)

### Steps

- [ ] 1. RED — write the new API test classes in `backend/tests/test_api_records.py` (append; ensure `from datetime import datetime` is imported at the top of the file — add if absent. Factories from conftest: `create_master`/`create_service`/`create_location`/`create_client`/`create_activity`/`create_record` — all follow the `**kwargs`/`**overrides` spread pattern of `create_activity`/`create_record` at conftest.py:276-344; `create_record(activity_id=<id>)` overrides the activity, `create_record(client_id=None)` makes an anonymous record, `create_activity(start=<datetime>)` sets the start):

```python
class TestRecordsListFilters:
    """Server-side filters on GET /api/v1/records (#191)."""

    def test_filter_date_range_whole_day_inclusive(self, api_client, create_activity, create_record):
        late = create_activity(start=datetime(2026, 8, 5, 23, 30))
        early_next = create_activity(start=datetime(2026, 8, 6, 0, 0))
        r_in = create_record(activity_id=late["id"])
        r_out = create_record(activity_id=early_next["id"])
        resp = api_client.get("/api/v1/records", params={"date_from": "2026-08-05", "date_to": "2026-08-05"})
        assert resp.status_code == 200
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_in["id"] in ids and r_out["id"] not in ids

    def test_filter_date_from_only(self, api_client, create_activity, create_record):
        before = create_activity(start=datetime(2026, 8, 1, 10, 0))
        after = create_activity(start=datetime(2026, 8, 5, 10, 0))
        r_before = create_record(activity_id=before["id"])
        r_after = create_record(activity_id=after["id"])
        resp = api_client.get("/api/v1/records", params={"date_from": "2026-08-03"})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_after["id"] in ids and r_before["id"] not in ids

    def test_filter_date_to_only(self, api_client, create_activity, create_record):
        before = create_activity(start=datetime(2026, 8, 1, 10, 0))
        after = create_activity(start=datetime(2026, 8, 5, 10, 0))
        r_before = create_record(activity_id=before["id"])
        r_after = create_record(activity_id=after["id"])
        resp = api_client.get("/api/v1/records", params={"date_to": "2026-08-03"})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_before["id"] in ids and r_after["id"] not in ids

    def test_filter_location_id(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        resp = api_client.get("/api/v1/records", params={"location_id": a["location_id"]})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_a["id"] in ids and r_b["id"] not in ids

    def test_filter_service_id(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        resp = api_client.get("/api/v1/records", params={"service_id": a["service_id"]})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_a["id"] in ids and r_b["id"] not in ids

    def test_filter_master_id(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_b = create_record(activity_id=b["id"])
        resp = api_client.get("/api/v1/records", params={"master_id": a["master_id"]})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_a["id"] in ids and r_b["id"] not in ids

    def test_filter_status(self, api_client, create_record):
        r_waiting = create_record()  # visits default status waiting
        r_visited = create_record(visits=[{"name": "Гость", "price": 3500, "status": "visited"}])
        resp = api_client.get("/api/v1/records", params={"status": "visited"})
        ids = [r["id"] for r in resp.json()["items"]]
        assert r_visited["id"] in ids and r_waiting["id"] not in ids

    def test_filter_activity_id(self, api_client, create_activity, create_record):
        a = create_activity()
        r_a = create_record(activity_id=a["id"])
        r_other = create_record()
        resp = api_client.get("/api/v1/records", params={"activity_id": a["id"]})
        body = resp.json()
        assert [r["id"] for r in body["items"]] == [r_a["id"]] and body["total"] == 1

    def test_filter_combined_location_master_status(self, api_client, create_activity, create_record):
        a = create_activity()
        b = create_activity()
        r_a = create_record(activity_id=a["id"], visits=[{"name": "Гость", "price": 3500, "status": "visited"}])
        create_record(activity_id=a["id"])  # same master+location, wrong status
        create_record(activity_id=b["id"], visits=[{"name": "Гость", "price": 3500, "status": "visited"}])  # right status, wrong activity refs
        resp = api_client.get(
            "/api/v1/records",
            params={"location_id": a["location_id"], "master_id": a["master_id"], "status": "visited"},
        )
        body = resp.json()
        assert [r["id"] for r in body["items"]] == [r_a["id"]] and body["total"] == 1

    def test_total_reflects_filtered_count(self, api_client, create_activity, create_record):
        a = create_activity()
        create_record(activity_id=a["id"])
        create_record(activity_id=a["id"])
        create_record()
        resp = api_client.get("/api/v1/records", params={"activity_id": a["id"], "per_page": 1})
        body = resp.json()
        assert body["total"] == 2 and len(body["items"]) == 1
```

```python
class TestRecordsListSorting:
    """Server-side sorting on GET /api/v1/records (#191)."""

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200
        return [r["id"] for r in resp.json()["items"]]

    def test_sort_date_asc_desc(self, api_client, create_activity, create_record):
        early = create_record(activity_id=create_activity(start=datetime(2026, 8, 4, 10, 0))["id"])
        late = create_record(activity_id=create_activity(start=datetime(2026, 8, 6, 10, 0))["id"])
        params = {"date_from": "2026-08-01", "date_to": "2026-08-10"}
        asc = self._ids(api_client.get("/api/v1/records", params={**params, "sort_by": "date", "sort_order": "asc"}))
        desc = self._ids(api_client.get("/api/v1/records", params={**params, "sort_by": "date", "sort_order": "desc"}))
        assert asc.index(early["id"]) < asc.index(late["id"])
        assert desc.index(late["id"]) < desc.index(early["id"])

    def test_sort_client_name_anonymous_first_on_asc(self, api_client, create_client, create_record):
        named = create_record(client_id=create_client(name="Анна")["id"])
        anon = create_record(client_id=None)
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "client", "sort_order": "asc"}))
        assert ids.index(anon["id"]) < ids.index(named["id"])

    def test_sort_guests_counts_live_visits_not_anonym_seats(self, api_client, create_record):
        # BLOCKER-guard test: anonym-visits record must sort by live visits count (seats - anonym_visits)
        anon = create_record(visits=[], anonym_visits=3)   # seats=3, live visits=0
        two = create_record(visits=[
            {"name": "А", "price": 1000, "status": "waiting"},
            {"name": "Б", "price": 1000, "status": "waiting"},
        ])  # seats=2, live visits=2
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "guests", "sort_order": "asc"}))
        assert ids.index(anon["id"]) < ids.index(two["id"])  # 0 < 2; raw-seats sort would invert

    def test_sort_total(self, api_client, create_record):
        cheap = create_record(visits=[{"name": "А", "price": 1000, "status": "waiting"}])
        pricey = create_record(visits=[{"name": "А", "price": 5000, "status": "waiting"}])
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "total", "sort_order": "asc"}))
        assert ids.index(cheap["id"]) < ids.index(pricey["id"])

    def test_sort_payment_bucket_asc(self, api_client, create_record):
        full = create_record(visits=[{"name": "А", "price": 3500, "status": "waiting"}])
        partial = create_record(visits=[{"name": "Б", "price": 3500, "status": "waiting"}])
        unpaid = create_record(visits=[{"name": "В", "price": 3500, "status": "waiting"}])
        api_client.post("/api/v1/payments", json={"record_id": full["id"], "amount": 3500, "method": "card"})
        api_client.post("/api/v1/payments", json={"record_id": partial["id"], "amount": 1500, "method": "card"})
        ids = self._ids(api_client.get("/api/v1/records", params={"sort_by": "payment", "sort_order": "asc"}))
        assert ids.index(full["id"]) < ids.index(partial["id"]) < ids.index(unpaid["id"])

    def test_sort_pages_disjoint(self, api_client, create_record):
        for _ in range(3):
            create_record()
        p1 = self._ids(api_client.get("/api/v1/records", params={"sort_by": "date", "page": 1, "per_page": 2}))
        p2 = self._ids(api_client.get("/api/v1/records", params={"sort_by": "date", "page": 2, "per_page": 2}))
        assert not set(p1) & set(p2)
```

```python
class TestRecordsList422:
    """Explicit 422 validation on GET /api/v1/records (#191, #182 style)."""

    @pytest.mark.parametrize("params", [
        {"sort_by": "bogus"},
        {"sort_order": "sideways"},
        {"status": "bogus"},
        {"date_from": "not-a-date"},
        {"date_from": "2026-08-09", "date_to": "2026-08-03"},
    ])
    def test_invalid_params_return_422(self, api_client, params):
        resp = api_client.get("/api/v1/records", params=params)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"
```

- [ ] 2. Also fix `backend/tests/services/test_record_service.py` (line ~15): the service call becomes `await service.list(db_session=session, params=RecordListParams(client_id=..., per_page=...))` (import `RecordListParams` from `src.schemas.record`). Assertions unchanged.
- [ ] 3. Run new tests — expect FAIL (filters/sorts not implemented; note: filter-by-client_id still passes — old behavior).
- [ ] 4. GREEN — rewrite `RecordService.list` in `backend/src/services/record.py`. Add imports: `case` to the sqlalchemy import (select/func already present), `from src.models.activity import Activity`, `from src.models.master import Master`, `from src.models.service import Service`, `from src.models.location import Location` (Record/Visit/Client/Payment already imported), `from src.domain.dates import day_range`, `RecordListParams` added to the existing `src.schemas.record` import, `paginate_orm` added to the existing `src.services.generic` import. Replace the whole `list` method (record.py:36-61):

```python
    async def list(
        self, db_session: AsyncSession, params: RecordListParams
    ) -> PaginatedResponse:  # items are ORM Record instances
        """Return a paginated page of records (ORM items, visits eagerly loaded).

        Filter → Sort → Paginate, fully server-side (#191).
        Business filters are hand-written here (G1a principle); pagination/date
        mechanics are shared helpers (paginate_orm, day_range).
        """
        stmt = (
            select(Record)
            .join(Activity, Record.activity_id == Activity.id)
            .options(selectinload(Record.visits))
        )
        # --- Filter ---
        from_dt, to_dt = day_range(params.date_from, params.date_to)
        if from_dt is not None:
            stmt = stmt.where(Activity.start >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(Activity.start <= to_dt)
        if params.location_id is not None:
            stmt = stmt.where(Activity.location_id == params.location_id)
        if params.service_id is not None:
            stmt = stmt.where(Activity.service_id == params.service_id)
        if params.master_id is not None:
            stmt = stmt.where(Activity.master_id == params.master_id)
        if params.status is not None:
            stmt = stmt.where(Record.status == params.status)
        if params.client_id is not None:
            stmt = stmt.where(Record.client_id == params.client_id)
        if params.activity_id is not None:
            stmt = stmt.where(Record.activity_id == params.activity_id)
        # --- Sort (whitelist map) + Paginate (COUNT before ORDER BY) ---
        items, total = await paginate_orm(
            db_session, stmt, params.page, params.per_page,
            order_by=self._sort_columns(params),
        )
        return PaginatedResponse.model_construct(
            items=items, total=total, page=params.page, per_page=params.per_page
        )

    @staticmethod
    def _sort_columns(params: RecordListParams) -> list:
        """Whitelist sort map → ORDER BY expressions (#191, mirrors the deleted
        client-side comparator; collation note: SQLite BINARY ≠ localeCompare)."""
        client_name = (
            select(Client.name).where(Client.id == Record.client_id).scalar_subquery()
        )
        service_title = (
            select(Service.title).where(Service.id == Activity.service_id).scalar_subquery()
        )
        master_last = (
            select(Master.last_name).where(Master.id == Activity.master_id).scalar_subquery()
        )
        master_first = (
            select(Master.first_name).where(Master.id == Activity.master_id).scalar_subquery()
        )
        location_name = (
            select(Location.name).where(Location.id == Activity.location_id).scalar_subquery()
        )
        total_price = (
            select(func.coalesce(func.sum(Visit.price), 0))
            .where(Visit.record_id == Record.id)
            .scalar_subquery()
        )
        paid_sum = (
            select(func.coalesce(func.sum(Payment.amount), 0))
            .where(Payment.record_id == Record.id)
            .scalar_subquery()
        )
        payment_bucket = case(
            (paid_sum >= total_price, 0),
            (paid_sum > 0, 1),
            else_=2,
        )
        sort_map: dict[str, list] = {
            "date": [Activity.start],
            "client": [client_name],
            "service": [service_title],
            "master": [master_last, master_first],
            "location": [location_name],
            "guests": [Record.seats - Record.anonym_visits],  # == live visits count
            "status": [Record.status],
            "total": [total_price],
            "payment": [payment_bucket],
        }
        columns = sort_map[params.sort_by]  # Literal-validated upstream; KeyError impossible
        if params.sort_order == "desc":
            ordered = [c.desc().nullslast() for c in columns]
        else:
            ordered = [c.asc().nullsfirst() for c in columns]
        return [*ordered, Record.id.asc()]  # deterministic tiebreak — cross-page stability
```

- [ ] 5. Update the router `backend/src/api/v1/records.py` (add `RecordListParams` to the `src.schemas.record` import; `Annotated` and `Query` are already imported):

```python
@router.get("", response_model=PaginatedResponse[RecordResponse])
async def list_records(
    service: _ServiceDep,
    session: SessionDep,
    params: Annotated[RecordListParams, Query()],
) -> PaginatedResponse[RecordResponse]:
    """Return records with nested visits — server-side filter, sort, paginate (#191)."""
    result = await service.list(db_session=session, params=params)
    return PaginatedResponse(
        items=[_map_record(r) for r in result.items],
        total=result.total,
        page=result.page,
        per_page=result.per_page,
    )
```

- [ ] 6. Run `cd backend && python -m pytest tests/test_api_records.py tests/services/test_record_service.py tests/test_record_list_params.py -q` — all green.
- [ ] 7. Run FULL backend suite — all green (regression: existing record tests incl. custom_price, visits, capacity).
- [ ] 8. Commit: `feat(backend): records list server-side filters + sorting + pagination (#191)`

---

## Task 5: Activities refactor onto shared util + `_paginate`

### Classification: standard
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §5.4 — scope boundaries (behavior unchanged except 500→422)
- Skill: `pytest-patterns`

### Task Description

Kill the `replace(hour=23,...)` hack and the duplicated pagination in `ActivityService._list_by_date`; make invalid dates 422 (was 500) by typing router params `date`.

**Files:**
- Modify: `backend/src/services/activity.py`
- Modify: `backend/src/api/v1/activities.py`
- Modify: `backend/tests/test_api_activities.py`

### Steps

- [ ] 1. RED — add to `backend/tests/test_api_activities.py` (inside `TestActivitiesDateFiltering`):

```python
    def test_list_activities_invalid_date_returns_422(self, api_client):
        resp = api_client.get("/api/v1/activities", params={"date_from": "garbage"})
        assert resp.status_code == 422
```

- [ ] 2. Run it — expect FAIL (today: 500).
- [ ] 3. Router `backend/src/api/v1/activities.py`: add `from datetime import date`; change the two params to `date_from: date | None = Query(None)`, `date_to: date | None = Query(None)`.
- [ ] 4. Service `backend/src/services/activity.py`: add `from datetime import date` (remove now-unused `datetime` import if nothing else uses it) and `from src.domain.dates import day_range`. Change the `list` dispatcher signature to `date_from: date | None = None, date_to: date | None = None`. Rewrite `_list_by_date` (activity.py:53-77):

```python
    async def _list_by_date(
        self, db_session: AsyncSession, date_from: date | None, date_to: date | None,
        page: int, per_page: int,
    ) -> PaginatedResponse[ActivityResponse]:
        """Return a paginated page of activities filtered by date range."""
        stmt = select(Activity)
        from_dt, to_dt = day_range(date_from, date_to)
        if from_dt is not None:
            stmt = stmt.where(Activity.start >= from_dt)
        if to_dt is not None:
            stmt = stmt.where(Activity.start <= to_dt)
        return await self._paginate(db_session, stmt, page, per_page)
```

- [ ] 5. Run `cd backend && python -m pytest tests/test_api_activities.py tests/test_list_activities_query_count.py -q` — all green (regression gate + new 422).
- [ ] 6. Run FULL backend suite — all green.
- [ ] 7. Commit: `refactor(backend): activities date filter via shared util + _paginate, 422 on bad dates (#191)`

---

## Task 6: api-client `getRecords` new params

### Classification: small
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §7.6 — param names mirror clients
- Skill: `vitest-playwright-patterns`

### Task Description

Extend `getRecords` with the 7 new params and pin the wire contract with URL-building tests.

**Files:**
- Modify: `packages/api-client/src/endpoints.ts` (getRecords, lines 252-267)
- Modify: `packages/api-client/src/endpoints.test.ts`

### Steps

- [ ] 1. RED — add to the `getRecords` describe block in `packages/api-client/src/endpoints.test.ts` (style mirrors lines 255-262):

```ts
  it('sends all new filter and sort params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords({
      date_from: '2026-08-03',
      date_to: '2026-08-09',
      location_id: 'l-1',
      service_id: 's-1',
      master_id: 'm-1',
      status: 'waiting',
      activity_id: 'a-1',
      sort_by: 'payment',
      sort_order: 'desc',
      page: 2,
      per_page: 50,
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records?date_from=2026-08-03&date_to=2026-08-09&location_id=l-1&service_id=s-1&master_id=m-1&status=waiting&activity_id=a-1&sort_by=payment&sort_order=desc&page=2&per_page=50',
      expect.anything(),
    );
  });

  it('omits empty/undefined params from the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords({ page: 1, per_page: 10, status: undefined, location_id: undefined });
    expect(api).toHaveBeenCalledWith('/api/v1/records?page=1&per_page=10', expect.anything());
  });
```

- [ ] 2. Run `cd packages/api-client && pnpm test` — expect FAIL.
- [ ] 3. GREEN — replace `getRecords` in `endpoints.ts`:

```ts
export async function getRecords(params?: {
  date_from?: string;
  date_to?: string;
  client_id?: string;
  activity_id?: string;
  location_id?: string;
  service_id?: string;
  master_id?: string;
  status?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<RecordResponse>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  if (params?.client_id) search.set('client_id', params.client_id);
  if (params?.activity_id) search.set('activity_id', params.activity_id);
  if (params?.location_id) search.set('location_id', params.location_id);
  if (params?.service_id) search.set('service_id', params.service_id);
  if (params?.master_id) search.set('master_id', params.master_id);
  if (params?.status) search.set('status', params.status);
  if (params?.sort_by) search.set('sort_by', params.sort_by);
  if (params?.sort_order) search.set('sort_order', params.sort_order);
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/records${qs ? `?${qs}` : ''}`, RecordListResponseSchema);
}
```

- [ ] 4. Run `cd packages/api-client && pnpm test` — all green (156 baseline + 2 new).
- [ ] 5. Commit: `feat(api-client): getRecords filter/sort params (#191)`

---

## Task 7: Cache-sync envelope shape guard

### Classification: standard
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §7.5 — cache topology after the change
- Skill: `vitest-playwright-patterns`

### Task Description

After Task 8 the main `['records', ...]` list cache holds the envelope `{items,total,page,per_page}` while `['records','client',id]` / `['records','activity',id]` stay arrays. All list-cache updaters become shape-agnostic. This task lands BEFORE the context switch so both shapes are safe at all times.

**Files:**
- Modify: `frontend/admin/lib/cache/recordCacheSync.ts`
- Modify: `frontend/admin/hooks/useRecordMutations.ts` (deleteRecord updater, lines 183-194)
- Modify: `frontend/admin/__tests__/recordCacheSync.test.ts`
- Modify: `frontend/admin/__tests__/useRecordMutations.test.ts`

### Steps

- [ ] 1. RED — in `recordCacheSync.test.ts`: change the ~6 spots seeding `['records', '2026-01-01', '2026-01-31']` from plain arrays to envelopes `{ items: [...], total: N, page: 1, per_page: 10 }` (keep `['records', 'client', 'c1']` as plain arrays) and update assertions to read `.items` for envelope keys. Add:

```ts
it('patchRecordEverywhere patches envelope caches, preserving page metadata', () => {
  qc.setQueryData(['records', 1, 10], {
    items: [makeRecord(recordId), makeRecord(otherRecordId)],
    total: 2, page: 1, per_page: 10,
  });
  patchRecordEverywhere(qc, recordId, (r) => ({ ...r, comment: 'patched' }));
  const after = qc.getQueryData<any>(['records', 1, 10]);
  expect(after.items.find((r: any) => r.id === recordId)?.comment).toBe('patched');
  expect(after.total).toBe(2);
  expect(after.page).toBe(1);
});
```

In `useRecordMutations.test.ts`: flip seeded date-list caches (lines 242, 462, 494, 567, 625) to envelopes; keep `['records','client','c1']` arrays. Add:

```ts
it('deleteRecord removes from BOTH envelope and array records caches', async () => {
  queryClient.setQueryData(['records', 1, 10], {
    items: [mockRecordResponse], total: 1, page: 1, per_page: 10,
  });
  queryClient.setQueryData(['records', 'client', 'c1'], [mockRecordResponse]);
  // ...perform deleteRecord (existing arrange/act pattern)...
  const envelope = queryClient.getQueryData<any>(['records', 1, 10]);
  const array = queryClient.getQueryData<RecordResponse[]>(['records', 'client', 'c1']);
  expect(envelope.items).toEqual([]);
  expect(array).toEqual([]);
});
```

- [ ] 2. Run `cd frontend/admin && npx vitest run __tests__/recordCacheSync.test.ts __tests__/useRecordMutations.test.ts` — expect FAIL (TypeError on envelope).
- [ ] 3. GREEN — in `recordCacheSync.ts` add (and update the header topology comment: main list is now an envelope keyed by all server params #191):

```ts
import type { PaginatedResponse } from '@memo/api-client'; // extend the existing type import

export type RecordsListCache = RecordResponse[] | PaginatedResponse<RecordResponse>;

/**
 * Apply `fn` to the items of any ['records', ...] list cache, shape-agnostic:
 * the paged main list caches the envelope {items,total,page,per_page} (#191);
 * per-client/per-activity caches hold plain arrays. `total` is NOT adjusted —
 * every mutation path follows with invalidateQueries(['records']).
 */
export function mapRecordsListCache(
  old: RecordsListCache | undefined,
  fn: (items: RecordResponse[]) => RecordResponse[],
): RecordsListCache | undefined {
  if (old == null) return old;
  if (Array.isArray(old)) return fn(old);
  if (Array.isArray(old.items)) return { ...old, items: fn(old.items) };
  return old;
}
```

Then in `patchRecordEverywhere` replace the `setQueriesData` block:

```ts
  qc.setQueriesData<RecordsListCache | undefined>(
    { queryKey: ['records'] },
    (old) =>
      mapRecordsListCache(old, (items) =>
        items.map((r) => (r.id === recordId ? updater(r) : r)),
      ),
  );
```

- [ ] 4. In `useRecordMutations.ts` (import `mapRecordsListCache` from `@/lib/cache/recordCacheSync`), replace the deleteRecord updater:

```ts
    queryClient.setQueriesData<RecordsListCache | undefined>(
      { queryKey: ['records'] },
      (old) => mapRecordsListCache(old, (items) => items.filter((r) => r.id !== recordId)),
    );
```

- [ ] 5. Run both test files — all green.
- [ ] 6. Commit: `feat(frontend): shape-agnostic records list cache updaters (#191)`

---

## Task 8: RecordsContext server-driven redesign

### Classification: large
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §7.1 — context contract, mapping, resets, keepPreviousData
- `frontend/admin/contexts/ClientsContext.tsx` — the pattern being mirrored
- Skill: `vitest-playwright-patterns`

### Task Description

Rewrite RecordsContext: page/perPage/filters/sort state, envelope cached, server params passed, `total` exposed, page-reset rules. Lookup maps, payments-totals query, seed effect, refetch — unchanged.

**Files:**
- Modify: `frontend/admin/contexts/RecordsContext.tsx`
- Modify: `frontend/admin/__tests__/RecordsContext.test.tsx`

### Steps

- [ ] 1. RED — update `RecordsContext.test.tsx` FIRST:
   - The 3 hard-coded queryKey literals (lines 138/158/177) change from `['records', '2026-01-01', '2026-01-31']` to `['records', 1, 10, '2026-01-01', '2026-01-31', { locationId: '', serviceId: '', masterId: '', status: '' }, 'date', 'asc']` (react-query hashes objects structurally — an equal literal matches).
   - New tests:

```ts
it('passes all server params with snake_case mapping', async () => {
  // render provider, act: result.current.setFilters({ locationId: 'loc-1' })
  await waitFor(() => expect(getRecords).toHaveBeenCalledWith(
    expect.objectContaining({
      page: 1, per_page: 10,
      date_from: '2026-01-01', date_to: '2026-01-31',
      location_id: 'loc-1',
      sort_by: 'date', sort_order: 'asc',
    }),
  ));
});

it('setFilters resets page to 1', async () => {
  // act: setPage(3), then setFilters({ status: 'waiting' })
  // assert: getRecords last called with page: 1 AND result.current.page === 1
});

it('date-range change resets page to 1', async () => {
  // rerender with mocked NavigationContext dateFrom changed; assert page back to 1
});

it('setPerPage resets page to 1', async () => { /* setPage(3) → setPerPage(50) → page === 1 */ });

it('setSort toggles order on same field, resets to asc on new field', async () => {
  // act: setSort('status') → sortBy 'status', sortOrder 'asc'
  // act: setSort('status') → sortOrder 'desc'
  // act: setSort('date') → sortBy 'date', sortOrder 'asc'
});

it('exposes server total', async () => {
  vi.mocked(getRecords).mockResolvedValue({ items: [rec1], total: 42, page: 1, per_page: 10 });
  // assert result.current.total === 42
});
```

- [ ] 2. Run — expect FAIL.
- [ ] 3. GREEN — rewrite `RecordsContext.tsx`. New/changed parts (everything not shown stays byte-identical: lookup maps, payments-totals query, seed effect, refetch, `useRecords` hook):

```tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse /* + existing types */ } from '@memo/api-client';

export interface RecordFilters {
  locationId: string;
  serviceId: string;
  masterId: string;
  status: string;
}

export type RecordSortField =
  | 'date' | 'client' | 'service' | 'master' | 'location'
  | 'guests' | 'status' | 'total' | 'payment';
export type RecordSortOrder = 'asc' | 'desc';

const DEFAULT_FILTERS: RecordFilters = { locationId: '', serviceId: '', masterId: '', status: '' };

export interface RecordsContextType {
  records: RecordResponse[];
  total: number;
  page: number;
  perPage: number;
  filters: RecordFilters;
  sortBy: RecordSortField;
  sortOrder: RecordSortOrder;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setFilters: (newFilters: Partial<RecordFilters>) => void;
  setSort: (field: RecordSortField) => void;
  resetFilters: () => void;
  clients: Map<string, ClientWithStats>;
  payments: Map<string, number>;
  activities: Map<string, ActivityResponse>;
  masters: Map<string, MasterResponse>;
  services: Map<string, ServiceResponse>;
  locations: Map<string, LocationResponse>;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}
```

Provider body (replaces the old records useQuery; keep everything else):

```tsx
  const [page, setPage] = useState(1);
  const [perPage, setPerPageState] = useState(10);
  const [filters, setFiltersState] = useState<RecordFilters>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<RecordSortField>('date');
  const [sortOrder, setSortOrder] = useState<RecordSortOrder>('asc');

  // Server-driven records list (#191) — queryKey carries every server param
  const { data, isLoading: recordsLoading, error: recordsError } = useQuery<PaginatedResponse<RecordResponse>>({
    queryKey: ['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder],
    queryFn: () => getRecords({
      page,
      per_page: perPage,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      location_id: filters.locationId || undefined,
      service_id: filters.serviceId || undefined,
      master_id: filters.masterId || undefined,
      status: filters.status || undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
    }),
    placeholderData: keepPreviousData,
  });
  const records = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  const setFilters = useCallback((newFilters: Partial<RecordFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
    setPage(1);
  }, []);

  const setPerPage = useCallback((pp: number) => {
    setPerPageState(pp);
    setPage(1);
  }, []);

  const setSort = useCallback((field: RecordSortField) => {
    if (field === sortBy) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  }, [sortBy]);

  // Date-range change (NavigationContext) resets to page 1
  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo]);
```

Extend `contextValue` with `records, total, page, perPage, filters, sortBy, sortOrder, setPage, setPerPage, setFilters, setSort, resetFilters` (+ all existing keys).

- [ ] 4. Run `cd frontend/admin && npx vitest run __tests__/RecordsContext.test.tsx` — all green.
- [ ] 5. Run `cd frontend/admin && npm run test` — RecordsTable/modal suites will fail on the OLD context shape — expected at this point; they are fixed in Tasks 9-11. Do NOT patch them here.
- [ ] 6. Commit: `feat(frontend): RecordsContext server-driven page/filters/sort state (#191)`

---

## Task 9: RecordsTable surgery + page wiring + context mocks

### Classification: large
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §7.2, §7.3 — what gets deleted, wiring, pagination UX
- Skill: `vitest-playwright-patterns`

### Task Description

Delete ALL client-side filter/sort/slice logic from RecordsTable; wire headers and pagination controls to the context; move filter state from page.tsx into the provider. Update the shared context mock and the RecordsTable suite.

**Files:**
- Modify: `frontend/admin/app/(main)/records/components/RecordsTable.tsx`
- Modify: `frontend/admin/app/(main)/records/page.tsx`
- Modify: `frontend/admin/__tests__/helpers/mockContexts.ts`
- Modify: `frontend/admin/__tests__/RecordsTable.test.tsx`

### Steps

- [ ] 1. `mockContexts.ts` — extend `createMockRecordsContext` return object with:

```ts
    total: 0,
    page: 1,
    perPage: 10,
    filters: { locationId: '', serviceId: '', masterId: '', status: '' },
    sortBy: 'date',
    sortOrder: 'asc',
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setFilters: vi.fn(),
    setSort: vi.fn(),
    resetFilters: vi.fn(),
```

- [ ] 2. `RecordsTable.test.tsx` — update to the new mock shape (all existing renders keep working via overrides). DELETE test #8 "sorts by payment status: paid, then partial, then unpaid" (client-side sort no longer exists). ADD wiring tests:

```tsx
it('header click calls setSort with the column key', () => {
  const setSort = vi.fn();
  render(<RecordsTable />, { recordsContext: createMockRecordsContext({ setSort }) });
  fireEvent.click(screen.getByText(/Оплата/));
  expect(setSort).toHaveBeenCalledWith('payment');
});

it('sort indicator reflects context sortBy/sortOrder', () => {
  render(<RecordsTable />, { recordsContext: createMockRecordsContext({ sortBy: 'payment', sortOrder: 'desc' }) });
  expect(screen.getByText(/Оплата/).textContent).toContain('↓');
});

it('pagination shows server total and calls setPage/setPerPage', () => {
  const setPage = vi.fn();
  const setPerPage = vi.fn();
  render(<RecordsTable />, {
    recordsContext: createMockRecordsContext({ total: 42, page: 2, perPage: 10, setPage, setPerPage }),
  });
  expect(screen.getByText('42 всего')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '3' }));
  expect(setPage).toHaveBeenCalledWith(3);
  fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '50' } });
  expect(setPerPage).toHaveBeenCalledWith(50);
});
```

- [ ] 3. Run RecordsTable tests — expect FAIL (old shape).
- [ ] 4. `RecordsTable.tsx` surgery:
   - DELETE: the `filters` prop + `RecordsTableProps` interface; the `filteredRecords` useMemo (lines 87-105); local `sortField`/`sortDir` state + `handleSort` + the `sortedRecords` useMemo (122-194); local `page`/`pageSize` state + `paginatedRecords` useMemo (197-201) + the reset-on-filter effect (204-206).
   - Context destructure becomes: `const { records, clients, payments, activities, masters, services, locations, total, page, perPage, setPage, setPerPage, sortBy, sortOrder, setSort, error, refetch } = useRecords();`
   - New helpers:

```tsx
  const sortIcon = (field: string) =>
    sortBy !== field ? ' ↕' : sortOrder === 'asc' ? ' ↑' : ' ↓';
  const totalPages = Math.ceil(total / perPage);
```

   - Headers: each `<th onClick={() => setSort('<key>')}>` with `{sortIcon('<key>')}` — keys: `date, client, service, master, location, guests, status, total, payment` (same 9 headers as today).
   - Rows render directly from `records` (no filtered/sorted/paginated intermediates); `totalForRecord`/`paidForRecord`/payment badges/`parseActivityStart` display logic unchanged.
   - Empty state: `records.length === 0` → the existing "Записи не найдены" row.
   - Pagination footer (visuals preserved, state now 1-based server-driven):

```tsx
      <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-light)' }}>
          <span>Строк:</span>
          <select
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value))}
            className="border rounded px-2 py-1 text-xs"
            style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)', color: 'var(--ink)' }}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span>{total} всего</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1 text-sm rounded border disabled:opacity-30"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            ←
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1 text-sm rounded border ${p === page ? 'font-bold' : ''}`}
              style={{
                borderColor: 'var(--line)',
                backgroundColor: p === page ? 'var(--brand)' : 'transparent',
                color: p === page ? 'white' : 'var(--ink)',
              }}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 text-sm rounded border disabled:opacity-30"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            →
          </button>
        </div>
      </div>
```

- [ ] 5. `page.tsx` — remove the local `filters` useState and the composed `filters` prop. New content component reads context:

```tsx
function RecordsPageContent() {
  const { filters, setFilters, resetFilters } = useRecords();
  return (
    <div ...>
      <h1>Управление записями</h1>
      <BookingFilters
        locationId={filters.locationId}
        serviceId={filters.serviceId}
        masterId={filters.masterId}
        status={filters.status}
        onLocationChange={(v) => setFilters({ locationId: v })}
        onServiceChange={(v) => setFilters({ serviceId: v })}
        onMasterChange={(v) => setFilters({ masterId: v })}
        onStatusChange={(v) => setFilters({ status: v })}
        onReset={resetFilters}
      />
      <RecordsTable />
    </div>
  );
}
```

(Keep the existing page wrapper/layout classes and the `RecordsProvider` mount exactly as they are; only the filter state plumbing changes. `useNavigation` import may become unused in page.tsx — remove if so; BookingFilters reads NavigationContext directly.)

- [ ] 6. Run `cd frontend/admin && npx vitest run __tests__/RecordsTable.test.tsx` — all green. Then `npm run test` — remaining failures should only be the modal suites (Tasks 10-11).
- [ ] 7. Type-check: `cd frontend/admin && npx tsc --noEmit` — clean.
- [ ] 8. Commit: `feat(frontend): RecordsTable server-driven sort/pagination, page filter wiring (#191)`

---

## Task 10: Records-folder ClientCardModal — dedicated queries

### Classification: standard
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §7.4 — data strategy (mirrors clients-folder modal + own payment totals)
- `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx` — the reference implementation
- Skill: `vitest-playwright-patterns`

### Task Description

The modal currently filters context `records` (shrinks to one server page). Replace with its own three queries so the client's full history + payment badges + "Потрачено" keep working. Also verify-only: `ClientsIntegration.test.tsx` (`['records','client',id]` branch stays an array — same key, same params) and `ClientRecordTab.api.test.tsx` (prefix invalidation unchanged) must still pass.

**Files:**
- Modify: `frontend/admin/app/(main)/records/components/ClientCardModal.tsx`
- Modify: any `__tests__` file rendering this modal (grep `records/components/ClientCardModal` under `frontend/admin/__tests__/` to find them — mock the api-client layer)

### Steps

- [ ] 1. RED — update the modal's tests: mock `@memo/api-client` (`getRecords` → envelope with the client's records; `getActivity` → per-id activity; `getPaymentTotals` → totals map) and assert: full history rendered, payment badges from own totals, `Потрачено` = sum over non-cancelled records' paid amounts.
- [ ] 2. GREEN — in `ClientCardModal.tsx` (props `{clientId, onClose}` unchanged; parent mounts conditionally so no isOpen gate needed beyond `!!clientId`). Replace the `useRecords()` records/activities/payments reads:

```tsx
  const { clients, services, locations } = useRecords(); // reference-data maps stay

  // Own data — the context records list is now one server page (#191)
  const { data: clientRecords = [] } = useQuery<RecordResponse[]>({
    queryKey: ['records', 'client', clientId],
    queryFn: () => getRecords({ client_id: clientId, per_page: 100 }).then((r) => r.items),
    enabled: !!clientId,
  });
  const { data: recordActivities = [] } = useQuery<ActivityResponse[]>({
    queryKey: ['activities', 'for-records', clientRecords.map((r) => r.activity_id)],
    queryFn: () => Promise.all(clientRecords.map((r) => getActivity(r.activity_id))),
    enabled: clientRecords.length > 0,
  });
  const recordIds = useMemo(() => clientRecords.map((r) => r.id).sort(), [clientRecords]);
  const { data: paymentTotals } = useQuery({
    queryKey: ['payments', 'totals', recordIds],
    queryFn: () => getPaymentTotals(recordIds),
    enabled: recordIds.length > 0,
  });
```

Rework `recordDetails` to build activity lookup from `recordActivities` (local `new Map(recordActivities.map(a => [a.id, a]))`) and `paidAmount` from `paymentTotals?.[record.id] ?? 0`. `totalVisitCount`/`totalGuests`/`totalSpent` computations unchanged. Add imports: `useQuery` from `@tanstack/react-query`, `getRecords`, `getActivity`, `getPaymentTotals` + types `RecordResponse`, `ActivityResponse` from `@memo/api-client`.

- [ ] 3. Run the modal's test files + `ClientsIntegration.test.tsx` + `ClientRecordTab.api.test.tsx` — all green.
- [ ] 4. Commit: `feat(frontend): records ClientCardModal dedicated queries (#191)`

---

## Task 11: ActivityDetailsModal — dedicated activity-records query

### Classification: standard
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §7.4 — modal rewiring
- Skill: `vitest-playwright-patterns`

### Task Description

The schedule-page modal filters context `records` by activity (shrinks to one page). Give it its own query on the new `activity_id` param.

**Files:**
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`
- Modify: `frontend/admin/__tests__/ActivityDetailsModal.test.tsx`

### Steps

- [ ] 1. RED — update `ActivityDetailsModal.test.tsx`: mock `getRecords` → envelope for the activity's records; assert booking tabs render from it.
- [ ] 2. GREEN — replace lines 56-59 (`records.filter(...)`) with:

```tsx
  // Own data — context records is now one server page; activity bookings need the full set (#191)
  const { data: activityRecords = [] } = useQuery<RecordResponse[]>({
    queryKey: ['records', 'activity', activity.id],
    queryFn: () => getRecords({ activity_id: activity.id, per_page: 100 }).then((r) => r.items),
    enabled: isOpen && !!activity?.id,
  });
```

Remove `records` from the `useRecords()` destructure (keep `clients`). Add `useQuery` + `getRecords` + `RecordResponse` imports. The existing `activityRecords.map(...)` tab-building code is untouched.

- [ ] 3. Run `ActivityDetailsModal.test.tsx` + `ClientTab.integration.test.tsx` — green.
- [ ] 4. Run `cd frontend/admin && npm run test` — FULL suite green now (all Tasks 8-11 landed).
- [ ] 5. Commit: `feat(frontend): ActivityDetailsModal dedicated activity-records query (#191)`

---

## Task 12: E2E rework — records.spec.ts + schedule helper

### Classification: large
### Required Docs
- `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md` §9.3 — rework rules, isolation mechanism, watch items
- `frontend/admin/e2e/clients.spec.ts:336-341` — the response-wait pattern being mirrored
- Skill: `vitest-playwright-patterns`, `dev-workflow`

### Task Description

Honest rework of the filter/sort/pagination e2e against the real server (no page.route). Pattern for EVERY reworked test: register `page.waitForResponse` with a URL-param predicate BEFORE the UI action, await it after, then assert post-state.

**Files:**
- Modify: `frontend/admin/e2e/records.spec.ts`
- Modify: `frontend/admin/e2e/fixtures/helpers.ts` (modal helper response-wait)

### Steps

- [ ] 1. `helpers.ts` — in `openActivityDetailsModal` (and any helper clicking into booking tabs), add a response wait on `r.url().includes('/api/v1/records') && r.url().includes('activity_id=')` before the click that opens the modal, awaited after.
- [ ] 2. Test 6 (status filter) — replace `waitForTimeout(500)` + `count <=` with:

```ts
      const filterResponse = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('status=waiting'),
        { timeout: 10_000 },
      );
      await page.locator('[data-testid="booking-filters-status-trigger"]').click();
      await page.locator('[data-testid="booking-filters-status-option-waiting"]').click();
      await filterResponse;
      // post-state: every visible status badge is "waiting"
      const badges = page.locator('tbody tr [data-testid^="status-badge-"]');
      for (const badge of await badges.all()) {
        await expect(badge).toHaveAttribute('data-testid', 'status-badge-waiting');
      }
```

- [ ] 3. Test 7 (reset) — after filtering (same response-wait as above), click Сбросить with a wait on `status=` ABSENT + `page=1` present: predicate `(r) => r.url().includes('/api/v1/records') && !r.url().includes('status=') && r.url().includes('page=1')`; assert row count ≥ filtered count and "N всего" grew or equal.
- [ ] 4. Tests 16/17 (location/service) — same shape: seed a record on a known activity first (`createTestRecordWithClient` returns `activityId`; fetch the activity to learn its `location_id`/`service_id`), select that option, wait on `location_id=`/`service_id=` param, assert every visible row matches.
- [ ] 5. Test 18 (compound) — chain two response waits (status=waiting, then + master_id=), asserting the URL accumulates BOTH params after the second action.
- [ ] 6. Test 11 (sorting) — capture the request on header click: after `clientHeader.click()`, `await page.waitForResponse((r) => r.url().includes('sort_by=client') && r.url().includes('sort_order=desc'))` (second click toggles back to asc). Keep the row-order assertions; the existing `.catch(() => {})` moot-wait is removed.
- [ ] 7. Test 12 (pagination total) — seed 12 records via `createTestRecordWithClient` on current-week activities; assert "12+ всего" text; click page button 2 with `waitForResponse((r) => r.url().includes('page=2'))`; assert page-2 rows are disjoint from page-1 rows (collect first-column texts).
- [ ] 8. Test 15 (status badges) — replace `waitForTimeout(500)` with response waits on the date-param requests; badge assertions unchanged.
- [ ] 9. NEW payment-sort test — isolation per spec §9.3: create THREE activities with explicit EARLY dates (e.g. `start: '2026-01-05T10:00:00'` — inside a narrow range no seed data shares), one record each via `createTestRecordWithPayment` variants; set date inputs to 2026-01-01 → 2026-01-10 (wait on `date_from=2026-01-01`); click Оплата header with `waitForResponse((r) => r.url().includes('sort_by=payment') && r.url().includes('sort_order=asc'))`; assert the payment column reads top→bottom: Оплачено, Частично, Не оплачено.
- [ ] 10. Tests 13/20 — replace timeouts with date-param response waits; keep assertions (they isolate via date range already).
- [ ] 11. Run the records e2e spec + `activity-details-modal.spec.ts` + `clients.spec.ts` via the project's shard script (see dev-workflow skill: `frontend/admin` e2e with real backend) — all green, no `waitForTimeout` left in records.spec.ts except the helpers' re-render buffers.
- [ ] 12. Commit: `test(e2e): records spec honest server-side rework (#191)`

---

## Follow-ups (file at finishing, NOT in scope)

- #205 — >100 cap for reference tables (masters/services/locations/materials/tags/photos) + their server pagination.
- Router-inline query violations in `photos.py:34-43` and `search.py:65-71`.
- Equality-loop copy-paste in `record.py`/`payment.py`/`service.py` services.
- `custom_price`-aware totals for the total/payment columns.
- Clients endpoint silent sort fallback harmonization (422 like records).
- Activities list deterministic default order + `date_from > date_to` 422 parity.
- Shared pagination UI component across admin tables.

## Self-Review

- **Spec coverage:** §5.1→T2/T4, §5.2→T1, §5.3→T4, §5.4→T5, §5.5→T3, §6→T4, §7.1→T8, §7.2/7.3→T9, §7.4→T10/T11, §7.5→T7, §7.6→T6, §9.1→T1/T2/T4/T5, §9.2→T6-T11, §9.3→T12. Visual checks → G4.5 at IMPL.
- **Type consistency:** `RecordListParams` (T2) matches service signature (T4) and router (T4); `paginate_orm` (T3) consumed by T4/T5; api-client params (T6) match context queryFn (T8); `RecordsContextType` (T8) matches mocks (T9) and table/modal usage (T9-T11); `mapRecordsListCache` (T7) matches both call sites.
- **No placeholders:** every step has code or an exact command.
- **Baseline:** backend 1008p/5s, api-client 156p/4f (4 = known #188), admin 1239p/0f (per scratchpad 2026-08-08) — verify at worktree setup.
