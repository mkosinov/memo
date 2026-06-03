# Backend Testing Handbook — Memo Project

**Companion to:** `2026-06-03-testing-strategy.md`
**Audience:** Backend developer (junior/middle)
**Last updated:** 2026-06-03

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Conftest Architecture](#2-conftest-architecture)
3. [Writing Your First Test](#3-writing-your-first-test)
4. [Test Patterns](#4-test-patterns)
5. [Edge Cases Checklist](#5-edge-cases-checklist)
6. [Enum Validation Tests](#6-enum-validation-tests)
7. [Integration Tests](#7-integration-tests)
8. [Data Integrity Tests](#8-data-integrity-tests)
9. [Common Mistakes](#9-common-mistakes)
10. [Running Tests](#10-running-tests)

---

## 1. Quick Start

### Run all tests
```bash
cd backend
uv run pytest tests/ -v
```

### Run one file
```bash
uv run pytest tests/test_api_records.py -v
```

### Run one test
```bash
uv run pytest tests/test_api_records.py::TestRecordsCrud::test_create_record_with_visits -v
```

### Run with output on failure
```bash
uv run pytest tests/ -v --tb=short
```

### Run only edge cases
```bash
uv run pytest tests/test_edge_cases.py -v
```

---

## 2. Conftest Architecture

### How it works

```
conftest.py (autouse)
├── reset_db          ← drops/recreates ALL tables before EACH test
├── api_client        ← TestClient(app) — shared per test
├── create_master     ← factory fixture
├── create_service    ← factory fixture
├── create_location   ← factory fixture
├── create_client     ← factory fixture
├── create_activity   ← factory (creates master+service+location+activity)
└── create_record     ← factory (creates activity+client+record+visit)
```

### Key principle: fixtures are composable

`create_record` depends on `create_activity` which depends on `create_master`, `create_service`, `create_location`. Pytest resolves the chain automatically.

### Database lifecycle

```
Test 1 starts:
  → reset_db drops all tables
  → reset_db creates all tables (empty DB)
  → test runs with clean DB
  → test ends

Test 2 starts:
  → reset_db drops all tables (Test 1 data gone)
  → reset_db creates all tables (empty DB)
  → test runs with clean DB
  → test ends
```

**Result:** Zero data leaking between tests. Each test is fully isolated.

---

## 3. Writing Your First Test

### Template: Simple CRUD test

```python
"""Tests for the [Entity] CRUD API endpoints."""


class Test[Entity]Crud:
    """Full CRUD round-trip for /api/[entities]."""

    def test_create_[entity](self, api_client, create_[prerequisite]) -> None:
        """POST /api/[entities] creates and returns 201."""
        [entity] = create_[entity]()
        
        assert [entity]["id"] is not None
        assert [entity]["is_active"] is True

    def test_get_[entity]_by_id(self, api_client, create_[entity]) -> None:
        """GET /api/[entities]/{id} returns the specific entity."""
        created = create_[entity]()
        
        response = api_client.get(f"/api/v1/[entities]/{created['id']}")
        assert response.status_code == 200
        assert response.json()["id"] == created["id"]

    def test_list_[entities](self, api_client, create_[entity]) -> None:
        """GET /api/[entities] returns a list including created."""
        created = create_[entity]()
        
        response = api_client.get("/api/v1/[entities]")
        assert response.status_code == 200
        ids = [item["id"] for item in response.json()]
        assert created["id"] in ids

    def test_update_[entity](self, api_client, create_[entity]) -> None:
        """PUT /api/[entities]/{id} updates fields."""
        created = create_[entity]()
        
        update_data = { ... }  # changed fields
        response = api_client.put(f"/api/v1/[entities]/{created['id']}", json=update_data)
        assert response.status_code == 200

    def test_delete_[entity]_soft_deletes(self, api_client, create_[entity]) -> None:
        """DELETE /api/[entities]/{id} soft-deletes."""
        created = create_[entity]()
        
        response = api_client.delete(f"/api/v1/[entities]/{created['id']}")
        assert response.status_code == 204
        
        # Still accessible by ID but is_active=False
        resp = api_client.get(f"/api/v1/[entities]/{created['id']}")
        assert resp.json()["is_active"] is False
        
        # Excluded from list
        resp = api_client.get("/api/v1/[entities]")
        ids = [item["id"] for item in resp.json()]
        assert created["id"] not in ids

    def test_get_nonexistent_returns_404(self, api_client) -> None:
        """GET /api/[entities]/{fake_id} returns 404."""
        response = api_client.get("/api/v1/[entities]/nonexistent-id")
        assert response.status_code == 404
```

### Concrete example: Payment test

```python
def test_create_payment(self, api_client, create_record) -> None:
    """POST /api/payments creates a payment and returns 201."""
    record = create_record()
    
    response = api_client.post("/api/v1/payments", json={
        "record_id": record["id"],
        "amount": 3000,
        "method": "card",
    })
    
    assert response.status_code == 201
    body = response.json()
    assert body["record_id"] == record["id"]
    assert body["amount"] == 3000
    assert body["method"] == "card"
```

---

## 4. Test Patterns

### Pattern 1: Validation error test

```python
def test_create_payment_zero_amount(self, api_client, create_record) -> None:
    """POST /api/payments with amount=0 returns 422."""
    record = create_record()
    
    response = api_client.post("/api/v1/payments", json={
        "record_id": record["id"],
        "amount": 0,
        "method": "card",
    })
    
    assert response.status_code == 422
```

### Pattern 2: Enum validation test

```python
def test_update_record_invalid_status(self, api_client, create_record) -> None:
    """PUT /api/records/{id} with status='banana' returns 422."""
    record = create_record()
    
    response = api_client.put(f"/api/v1/records/{record['id']}", json={
        "activity_id": record["activity_id"],
        "status": "banana",  # invalid!
        "visits": [],
    })
    
    assert response.status_code == 422
```

### Pattern 3: Business logic test

```python
def test_activity_occupied_increases(self, api_client, create_activity, create_client) -> None:
    """Creating a record increases activity.occupied."""
    activity = create_activity()
    client = create_client()
    
    # Verify occupied=0
    resp = api_client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.json()["occupied"] == 0
    
    # Create a record
    api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client["id"],
        "visits": [{"price": 3500}],
    })
    
    # Verify occupied=1
    resp = api_client.get(f"/api/v1/activities/{activity['id']}")
    assert resp.json()["occupied"] == 1
```

### Pattern 4: Phone-based record creation

```python
def test_create_record_with_phone_new_client(self, api_client, create_activity) -> None:
    """POST /api/records with phone auto-creates client and visitors."""
    activity = create_activity()
    phone = "+79990001122"
    
    response = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "phone": phone,
        "visits": [
            {"name": "Alice", "age": 28, "price": 1500},
        ],
    })
    
    assert response.status_code == 201
    body = response.json()
    assert body["client_id"] is not None
    
    # Verify client was created with the phone
    client_resp = api_client.get(f"/api/v1/clients/{body['client_id']}")
    assert client_resp.json()["phone"] == phone
```

### Pattern 5: Date filtering test

```python
def test_list_activities_date_range(self, api_client, create_activity) -> None:
    """GET /api/activities?date_from=...&date_to=... filters correctly."""
    from datetime import UTC, datetime, timedelta
    
    today = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0)
    tomorrow = today + timedelta(days=1)
    next_week = today + timedelta(days=7)
    
    create_activity(start=today)
    create_activity(start=tomorrow)
    create_activity(start=next_week)
    
    response = api_client.get("/api/v1/activities", params={
        "date_from": today.strftime("%Y-%m-%d"),
        "date_to": tomorrow.strftime("%Y-%m-%d"),
    })
    
    assert response.status_code == 200
    assert len(response.json()) == 2
```

### Pattern 6: Direct SQL verification

```python
import sqlite3

def query_db(sql: str) -> list[dict]:
    """Execute SQL against the test database."""
    from tests.conftest import _db_file
    conn = sqlite3.connect(_db_file.name)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def test_soft_delete_at_db_level(self, api_client, create_record) -> None:
    """DELETE sets is_active=0 in database."""
    record = create_record()
    
    api_client.delete(f"/api/v1/records/{record['id']}")
    
    rows = query_db(f"SELECT is_active FROM records WHERE id='{record['id']}'")
    assert len(rows) == 1
    assert rows[0]["is_active"] == 0  # SQLite stores bool as 0/1
```

---

## 5. Edge Cases Checklist

### Records (test_api_records.py + test_edge_cases.py)

| # | Test Case | Expected | Fixture needed |
|---|-----------|----------|----------------|
| 1 | Create record with valid data | 201, record in DB | `create_record` |
| 2 | Create record with non-existent activity_id | 404 or FK error | `create_client` |
| 3 | Create record with non-existent client_id | 404 or FK error | `create_activity` |
| 4 | Create record with empty visits array | 201, seats=0 | `create_activity`, `create_client` |
| 5 | Create record with phone (new client) | 201, client created | `create_activity` |
| 6 | Create record with phone (existing client) | 201, client reused | `create_activity`, `create_client` |
| 7 | Update record status | 200, status changed | `create_record` |
| 8 | Update record with invalid status="banana" | **422** | `create_record` |
| 9 | Delete record (soft delete) | 204, is_active=false | `create_record` |
| 10 | Get deleted record | 200, is_active=false | `create_record` |
| 11 | List records excludes deleted | deleted not in list | `create_record` |
| 12 | Create record exceeding capacity | 400 or business error | `create_activity` (capacity=1) |
| 13 | Create record with missing required fields | 422 | — |
| 14 | Update visit with status="fake_status" | **422** | `create_record` |
| 15 | Create record with all valid statuses | 201 for each | `create_activity`, `create_client` |

### Clients (test_api_clients.py)

| # | Test Case | Expected | Fixture needed |
|---|-----------|----------|----------------|
| 1 | Create client with valid data | 201 | `create_client` |
| 2 | Create client with duplicate phone | 409 or error | `create_client` |
| 3 | Create client without phone (empty string) | 201 | — |
| 4 | Search by phone — found | 200 + client data | `create_client` |
| 5 | Search by phone — not found | 404 | — |
| 6 | Update client name | 200, name changed | `create_client` |
| 7 | Delete client with active records | behavior defined | `create_record` |
| 8 | Create client with invalid channel="banana" | **422** | — |
| 9 | Create client with valid channel enum | 201 | — |
| 10 | List clients excludes deleted | deleted not in list | `create_client` |
| 11 | Get visitors for client | 200 + visitors list | `create_client` |

### Payments (test_api_payments.py)

| # | Test Case | Expected | Fixture needed |
|---|-----------|----------|----------------|
| 1 | Create payment with valid data | 201 | `create_record` |
| 2 | Create payment with amount=0 | **422** | `create_record` |
| 3 | Create payment with negative amount | **422** | `create_record` |
| 4 | Create payment for non-existent record | 404 | — |
| 5 | Delete payment (soft delete) | 204, is_active=false | `create_record` |
| 6 | Create multiple payments for same record | 201, all stored | `create_record` |
| 7 | Payment method validation (invalid) | **422** | `create_record` |

### Activities (test_api_activities.py)

| # | Test Case | Expected | Fixture needed |
|---|-----------|----------|----------------|
| 1 | Create activity with valid data | 201, occupied=0 | `create_activity` |
| 2 | Create activity with past date | 201 (allowed) | `create_activity` (past start) |
| 3 | Create activity with capacity=0 | **422** | — |
| 4 | PATCH partial update | 200, only changed fields | `create_activity` |
| 5 | Date range filter | Only in-range activities | `create_activity` ×3 |
| 6 | Occupied count matches records | occupied = count(records) | `create_activity`, `create_record` |

### Visitors (test_api_visitors.py)

| # | Test Case | Expected | Fixture needed |
|---|-----------|----------|----------------|
| 1 | Create visitor with valid data | 201 | `create_client` |
| 2 | Create visitor without age (null) | 201, age=null | `create_client` |
| 3 | Create visitor with age=0 | 201 (infant) | `create_client` |
| 4 | Delete visitor (soft delete) | 204 | `create_client` |
| 5 | Update visit status to invalid value | **422** | `create_record` |

---

## 6. Enum Validation Tests

**⚠️ These tests only make sense AFTER Phase 0 (enum validation in schemas) is done.**

### What to test

For each enum field, verify:
1. **Valid values** → 201/200
2. **Invalid value** → 422
3. **All valid values** work (exhaustive check)

### Template

```python
import pytest


class TestRecordStatusValidation:
    """Record.status must be a valid RecordStatus enum value."""

    VALID_STATUSES = ["pending", "confirmed", "cancelled", "no_show"]

    @pytest.mark.parametrize("status", VALID_STATUSES)
    def test_valid_statuses(self, api_client, create_record, status) -> None:
        """All valid RecordStatus values are accepted."""
        record = create_record()
        response = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "status": status,
            "visits": [],
        })
        assert response.status_code == 200
        assert response.json()["status"] == status

    def test_invalid_status_rejected(self, api_client, create_record) -> None:
        """status='banana' returns 422."""
        record = create_record()
        response = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "status": "banana",
            "visits": [],
        })
        assert response.status_code == 422


class TestVisitStatusValidation:
    """Visit.status must be a valid VisitStatus enum value."""

    VALID_STATUSES = ["waiting", "visited", "missed", "cancelled"]

    @pytest.mark.parametrize("status", VALID_STATUSES)
    def test_valid_statuses(self, api_client, create_record, status) -> None:
        record = create_record()
        visit_id = record["visits"][0]["id"]
        response = api_client.put(
            f"/api/v1/visits/{visit_id}/status",
            json={"status": status},
        )
        assert response.status_code == 200

    def test_invalid_visit_status(self, api_client, create_record) -> None:
        record = create_record()
        visit_id = record["visits"][0]["id"]
        response = api_client.put(
            f"/api/v1/visits/{visit_id}/status",
            json={"status": "fake_status"},
        )
        assert response.status_code == 422


class TestPaymentMethodValidation:
    """Payment.method must be a valid PaymentMethod enum value."""

    VALID_METHODS = ["cash", "card", "transfer"]

    @pytest.mark.parametrize("method", VALID_METHODS)
    def test_valid_methods(self, api_client, create_record, method) -> None:
        record = create_record()
        response = api_client.post("/api/v1/payments", json={
            "record_id": record["id"],
            "amount": 1000,
            "method": method,
        })
        assert response.status_code == 201

    def test_invalid_method(self, api_client, create_record) -> None:
        record = create_record()
        response = api_client.post("/api/v1/payments", json={
            "record_id": record["id"],
            "amount": 1000,
            "method": "crypto",
        })
        assert response.status_code == 422


class TestChannelValidation:
    """Client.channel must be a valid Channel enum value."""

    VALID_CHANNELS = ["telegram", "phone", "email", "whatsapp", "website"]

    @pytest.mark.parametrize("channel", VALID_CHANNELS)
    def test_valid_channels(self, api_client, channel) -> None:
        import uuid
        response = api_client.post("/api/v1/clients", json={
            "name": f"Test {uuid.uuid4().hex[:6]}",
            "phone": f"+7999{uuid.uuid4().hex[:7]}",
            "channel": channel,
        })
        assert response.status_code == 201

    def test_invalid_channel(self, api_client) -> None:
        response = api_client.post("/api/v1/clients", json={
            "name": "Test",
            "phone": "+79990000000",
            "channel": "banana",
        })
        assert response.status_code == 422
```

---

## 7. Integration Tests

### Record Creation Flow (phone → client → record → visits)

```python
"""Integration test: full record creation via phone number."""


class TestRecordCreationFlow:
    """End-to-end record creation as a real user would do it."""

    def test_phone_creates_client_and_visitors(self, api_client, create_activity) -> None:
        """
        Real user flow:
        1. Admin selects an activity
        2. Admin enters phone number
        3. Admin adds visitor names
        4. Admin submits
        5. System creates: client + visitors + record + visits
        """
        activity = create_activity()
        phone = "+79998887766"

        # Step 1: Create record with phone
        response = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": phone,
            "comment": "Integration test",
            "visits": [
                {"name": "Алиса", "age": 28, "price": 3500},
                {"name": "Борис", "age": 35, "price": 3500},
            ],
        })
        assert response.status_code == 201
        record = response.json()

        # Step 2: Verify client was created
        assert record["client_id"] is not None
        client_resp = api_client.get(f"/api/v1/clients/{record['client_id']}")
        assert client_resp.status_code == 200
        client = client_resp.json()
        assert client["phone"] == phone

        # Step 3: Verify visitors were created
        assert record["seats"] == 2
        assert len(record["visits"]) == 2
        for visit in record["visits"]:
            visitor_resp = api_client.get(f"/api/v1/visitors/{visit['visitor_id']}")
            assert visitor_resp.status_code == 200

        # Step 4: Verify activity occupied increased
        activity_resp = api_client.get(f"/api/v1/activities/{activity['id']}")
        assert activity_resp.json()["occupied"] == 1

    def test_phone_reuses_existing_client(self, api_client, create_activity, create_client) -> None:
        """If client with this phone exists, reuse instead of creating new."""
        activity = create_activity()
        existing = create_client(phone="+79991112233")

        response = api_client.post("/api/v1/records", json={
            "activity_id": activity["id"],
            "phone": "+79991112233",
            "visits": [{"name": "Visitor", "price": 3500}],
        })
        assert response.status_code == 201
        assert response.json()["client_id"] == existing["id"]
```

---

## 8. Data Integrity Tests

### FK Constraints

```python
"""Tests for foreign key constraints and data integrity."""

import sqlite3


def query_db(sql: str) -> list[dict]:
    from tests.conftest import _db_file
    conn = sqlite3.connect(_db_file.name)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class TestForeignKeyConstraints:
    """Verify FK constraints prevent orphaned records."""

    def test_record_requires_valid_activity(self, api_client, create_client) -> None:
        """Cannot create record with non-existent activity_id."""
        client = create_client()
        response = api_client.post("/api/v1/records", json={
            "activity_id": "nonexistent-activity",
            "client_id": client["id"],
            "visits": [{"price": 1000}],
        })
        # Should fail — either 404 (business check) or 422/500 (FK constraint)
        assert response.status_code in (404, 422, 500)

    def test_visit_requires_valid_record(self, api_client, create_client) -> None:
        """Cannot create visit with non-existent record_id."""
        client = create_client()
        response = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"],
            "name": "Test",
            "age": 25,
        })
        # Visitor creation doesn't need record — but visit does
        # This tests the visit within record creation
        response = api_client.post("/api/v1/records", json={
            "activity_id": "fake",
            "client_id": client["id"],
            "visits": [{"visitor_id": "nonexistent", "price": 1000}],
        })
        assert response.status_code in (404, 422, 500)


class TestSoftDelete:
    """Verify soft delete behavior."""

    def test_deleted_record_excluded_from_list(self, api_client, create_record) -> None:
        record = create_record()
        api_client.delete(f"/api/v1/records/{record['id']}")

        response = api_client.get("/api/v1/records")
        ids = [r["id"] for r in response.json()]
        assert record["id"] not in ids

    def test_deleted_record_still_in_db(self, api_client, create_record) -> None:
        """Soft delete sets is_active=0, doesn't remove row."""
        record = create_record()
        api_client.delete(f"/api/v1/records/{record['id']}")

        rows = query_db(f"SELECT * FROM records WHERE id='{record['id']}'")
        assert len(rows) == 1
        assert rows[0]["is_active"] == 0

    def test_deleted_client_excluded_from_list(self, api_client, create_client) -> None:
        client = create_client()
        api_client.delete(f"/api/v1/clients/{client['id']}")

        response = api_client.get("/api/v1/clients")
        ids = [c["id"] for c in response.json()]
        assert client["id"] not in ids
```

---

## 9. Common Mistakes

### ❌ Mistake 1: Creating app in every test

```python
# ❌ WRONG — boilerplate in every test
def test_something():
    from src.main import create_app
    app = create_app()
    with TestClient(app) as client:
        # ... 40 lines of setup
        response = client.get("/api/v1/records")
```

```python
# ✅ CORRECT — use fixture
def test_something(api_client, create_record):
    record = create_record()
    response = api_client.get("/api/v1/records")
```

### ❌ Mistake 2: Hardcoding IDs

```python
# ❌ WRONG — assumes specific IDs exist
def test_get_record():
    response = api_client.get("/api/v1/records/specific-id-123")
```

```python
# ✅ CORRECT — create data first, use returned ID
def test_get_record(create_record):
    record = create_record()
    response = api_client.get(f"/api/v1/records/{record['id']}")
```

### ❌ Mistake 3: Not checking response status before parsing

```python
# ❌ WRONG — crashes with KeyError if request failed
def test_create():
    response = api_client.post("/api/v1/records", json=payload)
    body = response.json()
    assert body["id"] == "something"  # KeyError if 422!
```

```python
# ✅ CORRECT — check status first
def test_create(api_client, create_activity, create_client):
    activity = create_activity()
    client = create_client()
    response = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client["id"],
        "visits": [{"price": 1000}],
    })
    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
    body = response.json()
    assert body["id"] is not None
```

### ❌ Mistake 4: Testing only happy path

```python
# ❌ WRONG — only tests valid data
def test_create_payment():
    response = api_client.post("/api/v1/payments", json=valid_payload)
    assert response.status_code == 201
```

```python
# ✅ CORRECT — also tests invalid data
def test_create_payment_invalid_amount(api_client, create_record):
    record = create_record()
    response = api_client.post("/api/v1/payments", json={
        "record_id": record["id"],
        "amount": -100,
        "method": "card",
    })
    assert response.status_code == 422
```

### ❌ Mistake 5: Duplicating prerequisite creation

```python
# ❌ WRONG — copy-pasting master+service+location+activity creation
def test_1():
    master = api_client.post("/api/v1/masters", json={...}).json()
    service = api_client.post("/api/v1/services", json={...}).json()
    # ... 20 more lines
```

```python
# ✅ CORRECT — use composable fixtures
def test_1(create_activity):
    activity = create_activity()  # creates master+service+location+activity
```

### ❌ Mistake 6: Ignoring error messages in assertions

```python
# ❌ WRONG — when test fails, you get "assert 422 == 201" with no context
assert response.status_code == 201
```

```python
# ✅ CORRECT — error message tells you what went wrong
assert response.status_code == 201, f"Create failed: {response.status_code} {response.text}"
```

---

## 10. Running Tests

### Commands

```bash
# All tests
cd backend && uv run pytest tests/ -v

# One file
uv run pytest tests/test_api_records.py -v

# One class
uv run pytest tests/test_api_records.py::TestRecordsCrud -v

# One test
uv run pytest tests/test_api_records.py::TestRecordsCrud::test_create_record_with_visits -v

# With coverage
uv run pytest tests/ --cov=src --cov-report=term-missing

# Stop on first failure
uv run pytest tests/ -v -x

# Show print output
uv run pytest tests/ -v -s

# Run only edge cases
uv run pytest tests/test_edge_cases.py -v

# Run only integration
uv run pytest tests/test_record_creation_flow.py -v
```

### Expected output

```
tests/test_api_records.py::TestRecordsCrud::test_create_record_with_visits PASSED
tests/test_api_records.py::TestRecordsCrud::test_list_records_includes_created PASSED
...
tests/test_edge_cases.py::TestRecordStatusValidation::test_invalid_status_rejected PASSED
...
===== 215 passed in 12.34s =====
```

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `no such table: records` | DB not reset | Check `reset_db` fixture is `autouse=True` |
| `422 Unprocessable Entity` | Schema validation failed | Check payload matches schema. After A1: check enum values |
| `ImportError: src.main` | Wrong working directory | Run from `backend/` directory |
| `sqlite3.OperationalError: database is locked` | Concurrent access | Don't run tests in parallel (pytest is sequential by default) |
| Test passes alone but fails in suite | Data leaking | Check `reset_db` is working. Don't use module-level state |
