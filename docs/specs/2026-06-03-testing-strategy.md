# Testing Strategy — Memo Project

**Date:** 2026-06-03
**Status:** Approved
**Supersedes:** Previous draft (2026-06-03)

**Companion documents:**
- `backend-testing.md` — пошаговый гайд для backend программиста
- `frontend-testing.md` — пошаговый гайд для frontend программиста

---

## Problem Statement

E2E tests passed but real bugs went undetected. Root causes:

1. Tests checked element **existence**, not **content** — `toBeVisible()` passed on empty divs
2. No **database verification** — tests trusted HTTP 200 without checking persistence
3. No **test isolation** — data leaked between tests, causing flaky failures
4. **Mock data** disconnected from real data pipeline — frontend tests used hand-crafted objects that drifted from API responses
5. **Enum fields** accept any string — `status="banana"` returns 200, not 422
6. **Boilerplate overload** — juniors copy-paste `_create_prerequisites()` across 5 files instead of using fixtures

## Goals

1. Every test verifies **what the user sees** AND **what's stored in DB**
2. Every test is **isolated** — own data, no cross-test dependencies
3. Backend API tests come **before** frontend E2E
4. Test infrastructure is **deterministic** — same inputs → same results
5. Junior developer can write a new test by **copying a template** — no tribal knowledge needed

---

## Test Pyramid

```
         ╱╲
        ╱ E2E ╲          12-20 Playwright scenarios
       ╱────────╲        (full user flows, DB verification)
      ╱ Integration╲     5-10 cross-endpoint flows
     ╱──────────────╲    (record creation, payment cascade)
    ╱   Unit / API    ╲   200+ pytest tests
   ╱──────────────────╲  (CRUD, validation, edge cases)
  ╱   Static / Lint     ╲ ruff, mypy, eslint, tsc
 ╱────────────────────────╲
```

| Layer | Tool | Count | Gate | Who writes |
|-------|------|-------|------|------------|
| Static | ruff, mypy, eslint, tsc | — | Must pass before tests run | CI |
| Unit/API | pytest + httpx | 200+ | **Blocks merge** | Backend dev |
| Integration | pytest (multi-endpoint) | 5-10 | **Blocks merge** | Backend dev |
| Frontend unit | vitest + testing-library | 50+ | **Blocks merge** | Frontend dev |
| E2E | Playwright | 12-20 | **Blocks release** | Frontend dev |

---

## Quality Gates

| Gate | What | When | Blocks |
|------|------|------|--------|
| G0: Lint | ruff, mypy, eslint, tsc | Pre-commit | Commit |
| G1: Backend unit | `pytest tests/ -v` | Pre-merge | PR merge |
| G2: Frontend unit | `vitest run` | Pre-merge | PR merge |
| G3: E2E | `playwright test` | Pre-release | Deploy |
| G4: Visual regression | Playwright screenshots | Pre-release | Deploy |

**Coverage targets:**

| Module | Target | Current |
|--------|--------|---------|
| Backend API endpoints | 90% line coverage | ~70% (CRUD only, no edge cases) |
| Backend schemas/validation | 95% | ~20% (no enum validation) |
| Frontend components | 80% | ~60% |
| E2E critical paths | 100% of spec scenarios | ~40% |

---

## Part 1: Test Infrastructure

### 1.1 Test Database

**Decision:** Separate SQLite file for tests, not dev DB.

```
backend/memo.db          ← dev database (NEVER touched by tests)
backend/test_memo.db     ← test database (temp file, auto-managed)
```

**Current implementation (conftest.py):**
```python
_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db_file.close()
_TEST_DB_URL = f"sqlite+aiosqlite:///{_db_file.name}"
os.environ["DATABASE_URL"] = _TEST_DB_URL
```

**Why tempfile, not fixed path:**
- Parallel test runs don't collide
- No leftover state from previous runs
- CI-safe (no file conflicts between jobs)

### 1.2 Data Cleanup Strategy

**Approach: Drop + recreate all tables per test.**

```python
@pytest.fixture(autouse=True)
def reset_db():
    """Drop and recreate all tables before each test."""
    from src.db import db_manager
    from src.db.base import Base
    from src.models import *  # noqa: F401, F403

    async def _reset():
        async with db_manager.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_reset())
```

**Why drop/recreate, not truncate:**
- Guarantees no schema drift between tests
- SQLite is fast enough (< 50ms per reset)
- No FK ordering issues

### 1.3 Test Data Factories

**Backend: Fixture-based factories in conftest.py.**

Each factory is a pytest fixture that returns a callable. The callable creates an entity via API and returns the response JSON.

```python
@pytest.fixture
def api_client():
    """Shared TestClient — one per test."""
    from src.main import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c

@pytest.fixture
def create_master(api_client):
    """Factory: creates a master via API."""
    def factory(**overrides):
        payload = {
            "first_name": "Test",
            "last_name": "Master",
            "color": "#5B8C7A",
            "position": "мастер",
            "specialty": "живопись",
            **overrides,
        }
        resp = api_client.post("/api/v1/masters", json=payload)
        assert resp.status_code == 201, f"Failed: {resp.text}"
        return resp.json()
    return factory

@pytest.fixture
def create_service(api_client):
    def factory(**overrides):
        payload = {
            "title": "Test Service",
            "description": "Test",
            "image_url": "https://example.com/test.jpg",
            "specialty": "живопись",
            "min_age": 6,
            "max_age": 99,
            "duration": 90,
            "record_info": "Test info",
            **overrides,
        }
        resp = api_client.post("/api/v1/services", json=payload)
        assert resp.status_code == 201
        return resp.json()
    return factory

@pytest.fixture
def create_location(api_client):
    def factory(**overrides):
        payload = {
            "name": "Test Studio",
            "address": "Test Address 1",
            "capacity": 20,
            **overrides,
        }
        resp = api_client.post("/api/v1/locations", json=payload)
        assert resp.status_code == 201
        return resp.json()
    return factory

@pytest.fixture
def create_client(api_client):
    def factory(**overrides):
        import uuid
        payload = {
            "name": f"Client {uuid.uuid4().hex[:6]}",
            "phone": f"+7999{uuid.uuid4().hex[:7]}",
            "email": None,
            "channel": "telegram",
            **overrides,
        }
        resp = api_client.post("/api/v1/clients", json=payload)
        assert resp.status_code == 201
        return resp.json()
    return factory

@pytest.fixture
def create_activity(api_client, create_master, create_service, create_location):
    """Factory: creates master + service + location + activity."""
    def factory(**overrides):
        from datetime import UTC, datetime, timedelta
        master = create_master()
        service = create_service()
        location = create_location()
        start = overrides.pop("start", datetime.now(UTC) + timedelta(days=1))
        payload = {
            "master_id": master["id"],
            "service_id": service["id"],
            "location_id": location["id"],
            "start": start.isoformat(),
            "duration": 90,
            "capacity": 10,
            "is_private": False,
            **overrides,
        }
        resp = api_client.post("/api/v1/activities", json=payload)
        assert resp.status_code == 201
        return resp.json()
    return factory

@pytest.fixture
def create_record(api_client, create_activity, create_client):
    """Factory: creates activity + client + record with 1 visit."""
    def factory(**overrides):
        activity = create_activity()
        client = create_client()
        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Test record",
            "visits": [{"price": 3500, "status": "waiting"}],
            **overrides,
        }
        resp = api_client.post("/api/v1/records", json=payload)
        assert resp.status_code == 201
        return resp.json()
    return factory
```

**Usage in tests — BEFORE vs AFTER:**

```python
# ❌ BEFORE: 40 lines of boilerplate per test
def test_create_record():
    from src.main import create_app
    app = create_app()
    with TestClient(app) as client:
        master = client.post("/api/v1/masters", json={...}).json()
        service = client.post("/api/v1/services", json={...}).json()
        location = client.post("/api/v1/locations", json={...}).json()
        client_obj = client.post("/api/v1/clients", json={...}).json()
        activity = client.post("/api/v1/activities", json={...}).json()
        # ... finally the actual test
        response = client.post("/api/v1/records", json={...})
        assert response.status_code == 201

# ✅ AFTER: 5 lines, readable
def test_create_record(create_record):
    record = create_record()
    assert record["status"] == "pending"
    assert record["seats"] == 1
```

### 1.4 Test Data Sets

**Static fixtures** — reference data loaded once per test session:

```
backend/tests/fixtures/
├── masters.json       # 2-3 test masters
├── services.json      # 2-3 test services with tariffs
├── locations.json     # 1-2 test locations
└── seed.py            # Loads fixtures into DB via API
```

**Dynamic factories** — per-test data (see §1.3 above).

### 1.5 DB Verification Helpers

**Two approaches — use the right one for the situation:**

| Approach | When to use | Speed | Reliability |
|----------|-------------|-------|-------------|
| **API verification** | Simple CRUD checks | Fast | High |
| **Direct SQL** | FK constraints, cascade, soft delete, concurrent state | Fast | Highest |

**API verification (default):**
```python
# After creating a record, verify via GET
resp = api_client.get(f"/api/v1/records/{record_id}")
assert resp.json()["status"] == "confirmed"
```

**Direct SQL (for deep checks):**
```python
import sqlite3

def query_db(sql: str, db_path: str | None = None) -> list[dict]:
    """Execute SQL against test database."""
    if db_path is None:
        # Read from conftest's temp file
        from tests.conftest import _db_file
        db_path = _db_file.name
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# Usage: verify soft delete at DB level
def test_delete_record_soft_deletes(create_record):
    record = create_record()
    api_client.delete(f"/api/v1/records/{record['id']}")
    
    rows = query_db(f"SELECT is_active FROM records WHERE id='{record['id']}'")
    assert rows[0]["is_active"] == 0  # SQLite stores bool as 0/1
```

**E2E DB verification (Playwright):**
```typescript
// e2e/fixtures/db-query.ts
import { execSync } from 'child_process';

const DB_PATH = process.env.TEST_DB_PATH || 'backend/test_memo.db';

export function queryDB(sql: string): string {
    return execSync(`sqlite3 "${DB_PATH}" "${sql}"`, { encoding: 'utf-8' }).trim();
}

export function queryDBRow(sql: string): Record<string, any> | null {
    const output = execSync(`sqlite3 -json "${DB_PATH}" "${sql}"`, { encoding: 'utf-8' }).trim();
    if (!output || output === '[]') return null;
    return JSON.parse(output)[0];
}

// Usage:
const row = queryDBRow(`SELECT is_active FROM records WHERE id='${recordId}'`);
expect(row?.is_active).toBe(0);
```

### 1.6 Enum Validation — PREREQUISITE (Phase 0)

**⚠️ BLOCKS ALL OTHER TEST WORK.**

**Current state:** All enum fields in schemas are `str` — no validation. Backend accepts `status="banana"`.

**Required state:** Use proper enum types from `models/enums.py`.

| Schema | Field | Current | Required |
|--------|-------|---------|----------|
| `RecordBase.status` | `status` | `str` | `RecordStatus` |
| `RecordUpdate.status` | `status` | `str` | `RecordStatus` |
| `VisitItem.status` | `status` | `str` | `VisitStatus` |
| `VisitStatusUpdate.status` | `status` | `str` | `VisitStatus` |
| `PaymentBase.method` | `method` | `str \| None` | `PaymentMethod \| None` |
| `ClientBase.channel` | `channel` | `str` | `Channel` (new enum) |

**New enum needed:**
```python
class Channel(str, enum.Enum):
    TELEGRAM = "telegram"
    PHONE = "phone"
    EMAIL = "email"
    WHATSAPP = "whatsapp"
    WEBSITE = "website"
```

**Seed data fix:** Replace invalid channel values ("instagram", "vk") with valid enum values.

**Verification:** After fix, `POST /api/v1/records` with `{"status": "banana"}` must return 422.

---

## Part 2: Backend API Tests

### 2.1 Test Organization

```
backend/tests/
├── conftest.py                    # Fixture factories (see §1.3)
├── fixtures/
│   ├── masters.json
│   ├── services.json
│   ├── locations.json
│   └── seed.py
├── test_api_records.py            # CRUD + phone flow
├── test_api_clients.py            # CRUD + phone search + channel validation
├── test_api_payments.py           # CRUD + amount validation
├── test_api_visitors.py           # CRUD + age edge cases
├── test_api_activities.py         # CRUD + date filtering + occupied
├── test_api_services.py           # CRUD + tariffs
├── test_api_masters.py            # CRUD
├── test_api_locations.py          # CRUD
├── test_edge_cases.py             # Cross-endpoint validation
├── test_record_creation_flow.py   # Integration: phone → client → record → visits
└── test_data_integrity.py         # FK constraints, soft delete, cascade
```

### 2.2 Edge Cases to Cover

See `backend-testing.md` for full checklist with code templates.

**Summary by endpoint:**

| Endpoint | Edge Cases | Priority |
|----------|-----------|----------|
| Records | 17 cases (validation, capacity, phone flow, concurrent) | P0 |
| Clients | 11 cases (duplicate phone, channel enum, search) | P0 |
| Payments | 7 cases (amount=0, negative, overpayment) | P1 |
| Activities | 5 cases (past date, capacity=0, occupied count) | P1 |
| Visitors | 5 cases (null age, age=0, cascade) | P2 |
| Services | 3 cases (tariff CRUD, duration change) | P2 |

---

## Part 3: Frontend Tests

### 3.1 Unit Tests (vitest)

See `frontend-testing.md` for full handbook.

**Key improvements:**
1. Shared mock modules in `__tests__/helpers/`
2. Custom render utility with providers
3. Test templates for components and hooks

### 3.2 E2E Tests (Playwright)

**Key improvements:**
1. Fixture extraction from spec files → `e2e/fixtures/`
2. Global setup for seed data
3. Dual verification (API + SQL)
4. Backend auto-start in CI

---

## Part 4: Implementation Plan — Three Tracks

### Overview

```
Week 1:  Track A (backend) ═══════════════════╗
         Track B (frontend) ══════════════════╣  parallel
                                               ║
Week 2:  Track C (cross-team) ════════════════╣  after A+B
         Polish & CI ═════════════════════════╝
```

### Track A: Backend (Backend Programmer)

**No dependencies on frontend. Can start immediately.**

| # | Task | Depends on | DoD | Est. |
|---|------|-----------|-----|------|
| A1 | **Enum validation in schemas** | — | `status="banana"` → 422 for all endpoints. Seed data fixed. | 2h |
| A2 | **Refactor conftest.py** — add fixture factories | A1 | `create_record()` works in any test. Old tests still pass. | 3h |
| A3 | **Create `tests/fixtures/`** — masters.json, services.json, seed.py | A2 | `seed.py` loads reference data. Tests can use `seed_reference` fixture. | 2h |
| A4 | **Edge case tests: Records** | A2 | 17 test cases from §2.2 pass. | 4h |
| A5 | **Edge case tests: Clients** | A1, A2 | 11 test cases pass. Channel enum validated. | 3h |
| A6 | **Edge case tests: Payments** | A2 | 7 test cases pass. Amount validation works. | 2h |
| A7 | **Edge case tests: Activities** | A2 | 5 test cases pass. Occupied computed correctly. | 2h |
| A8 | **Integration test: Record creation flow** | A2 | Full phone → client → record → visits flow tested. | 3h |
| A9 | **Data integrity tests** | A2 | FK constraints, soft delete, cascade verified via SQL. | 3h |
| A10 | **Edge case tests: Visitors, Services** | A2 | Remaining edge cases covered. | 2h |

**Total: ~26 hours (3.5 working days)**

**Definition of Done for Track A:**
- `pytest tests/ -v` — all tests pass (200+ tests)
- `ruff check .` — no lint errors
- `mypy src/` — no type errors
- Enum validation confirmed: invalid values → 422

### Track B: Frontend (Frontend Programmer)

**No dependencies on backend. Can start immediately.**

| # | Task | Depends on | DoD | Est. |
|---|------|-----------|-----|------|
| B1 | **Shared mock modules** — `__tests__/helpers/mockData.ts`, `mockContexts.ts` | — | All existing tests refactored to import from helpers. No duplication. | 4h |
| B2 | **Custom render utility** — `__tests__/helpers/renderWithProviders.tsx` | B1 | `renderWithProviders(<Component />)` wraps in all contexts. | 2h |
| B3 | **Refactor existing tests** to use shared mocks + custom render | B1, B2 | All 25 existing tests pass. No mock duplication. | 4h |
| B4 | **E2E fixture extraction** — `e2e/fixtures/factories.ts`, `helpers.ts` | — | Factories and helpers extracted from spec files. Existing E2E still pass. | 3h |
| B5 | **New E2E scenarios** (from testing-strategy §3.3) | B4 | Scenarios 1-20 implemented. | 8h |
| B6 | **E2E: DB verification** — `e2e/fixtures/db-query.ts` | B4 | SQL helper works. At least 3 E2E tests use direct SQL. | 2h |
| B7 | **Visual regression baselines** | B5 | Screenshots committed for key states. | 2h |
| B8 | **New unit tests** for uncovered components | B2 | Coverage ≥ 80%. | 4h |

**Total: ~29 hours (3.5 working days)**

**Definition of Done for Track B:**
- `vitest run` — all unit tests pass (50+ tests)
- `playwright test` — all E2E scenarios pass (12-20 scenarios)
- No mock duplication in unit tests
- At least 3 E2E tests verify DB state via SQL

### Track C: Cross-Team (Assign to One Person)

**Requires both backend and frontend to be partially done.**

| # | Task | Depends on | DoD | Est. | Who |
|---|------|-----------|-----|------|-----|
| C1 | **Playwright globalSetup** — seed masters/services/locations before E2E | A3, B4 | E2E tests start with pre-seeded reference data. | 3h | Backend |
| C2 | **Playwright config: dual webServer** — auto-start backend + frontend | A1 | `playwright test` starts both servers in CI. | 2h | Frontend |
| C3 | **CI workflow** — GitHub Actions for backend + frontend | A2, B3 | PR triggers pytest + vitest. Release triggers E2E. | 3h | Backend |
| C4 | **E2E: DB path coordination** — test_memo.db accessible from Playwright | A2, B6 | Playwright reads correct test DB. | 1h | Backend |
| C5 | **Integration verification** — run full suite end-to-end | All | `pytest && vitest && playwright` all green. | 2h | Either |

**Total: ~11 hours (1.5 working days)**

### Timeline

```
Day 1-2:  A1 (enum) → A2 (conftest)     B1 (mocks) → B2 (render)
Day 3-4:  A3-A7 (edge cases)            B3 (refactor) → B4 (E2E fixtures)
Day 5-6:  A8-A10 (integration)          B5-B6 (E2E scenarios + DB)
Day 7:    C1-C4 (cross-team)            B7-B8 (visual + coverage)
Day 8:    C5 (full suite verification)
```

**Deadline check:** 8 working days from start. If started by June 5 → done by June 16. Within May 20 deadline? **No — already past.** This is QA infrastructure, not feature work. Ship incrementally: Track A first (unblocks backend confidence), then B, then C.

### Dependencies Graph

```
A1 (enum) ──→ A2 (conftest) ──→ A3..A10 (all backend tests)
                  │
                  ├──→ C1 (globalSetup)
                  ├──→ C3 (CI)
                  └──→ C4 (DB path)

B1 (mocks) ──→ B2 (render) ──→ B3 (refactor) ──→ B8 (coverage)
    │
    └──→ B4 (E2E fixtures) ──→ B5 (scenarios) ──→ B6 (DB verify) ──→ B7 (visual)
                                    │                    │
                                    └──→ C1              └──→ C4
                                    │
                                    └──→ C2 (dual webServer)
```

---

## Part 5: File Structure Summary

```
memo/
├── backend/
│   ├── .env.test                          # Test DB config
│   ├── src/
│   │   └── models/enums.py               # + Channel enum (A1)
│   ├── src/schemas/                       # Updated with enum types (A1)
│   ├── tests/
│   │   ├── conftest.py                    # Fixture factories (A2)
│   │   ├── fixtures/
│   │   │   ├── masters.json               # (A3)
│   │   │   ├── services.json              # (A3)
│   │   │   ├── locations.json             # (A3)
│   │   │   └── seed.py                    # (A3)
│   │   ├── test_api_records.py            # Refactored with fixtures (A2)
│   │   ├── test_api_clients.py            # + channel enum tests (A5)
│   │   ├── test_api_payments.py           # + amount validation (A6)
│   │   ├── test_api_visitors.py           # + age edge cases (A10)
│   │   ├── test_api_activities.py         # + occupied tests (A7)
│   │   ├── test_api_services.py           # (A10)
│   │   ├── test_edge_cases.py             # Cross-endpoint validation (A4)
│   │   ├── test_record_creation_flow.py   # Integration test (A8)
│   │   └── test_data_integrity.py         # FK, cascade, soft delete (A9)
│   └── pyproject.toml
│
├── frontend/admin/
│   ├── __tests__/
│   │   ├── setup.ts                       # Enhanced setup (B1)
│   │   ├── helpers/
│   │   │   ├── mockData.ts               # Shared mock data (B1)
│   │   │   ├── mockContexts.ts            # Context mock factories (B1)
│   │   │   └── renderWithProviders.tsx    # Custom render (B2)
│   │   ├── ActivityDetailsModal.test.tsx  # Refactored (B3)
│   │   └── ... (other test files)
│   ├── e2e/
│   │   ├── activity-details-modal.spec.ts # Uses fixtures (B4)
│   │   ├── schedule.spec.ts              # (B5)
│   │   ├── fixtures/
│   │   │   ├── factories.ts              # createTestClient, etc. (B4)
│   │   │   ├── db-query.ts              # Direct SQLite (B6, C4)
│   │   │   ├── helpers.ts               # openModal, waitForReady (B4)
│   │   │   └── global-setup.ts          # Seed data (C1)
│   │   └── screenshots/
│   ├── playwright.config.ts              # + dual webServer (C2)
│   └── vitest.config.ts
│
├── .github/workflows/
│   └── test.yml                          # CI workflow (C3)
│
└── docs/specs/
    ├── 2026-06-03-testing-strategy.md    # This document
    ├── 2026-06-03-backend-testing.md     # Backend junior handbook
    └── 2026-06-03-frontend-testing.md    # Frontend junior handbook
```

---

## Appendix: Migration Checklist

### Phase 0: Prerequisites (Day 1)
- [ ] **A1:** Enum validation in all schemas
- [ ] **A1:** Channel enum created
- [ ] **A1:** Seed data fixed (invalid channels → valid)
- [ ] Verify: `POST /api/v1/records {"status":"banana"}` → 422

### Phase 1: Backend Infrastructure (Day 2)
- [ ] **A2:** conftest.py refactored with fixture factories
- [ ] **A2:** All existing tests pass with new fixtures
- [ ] **A3:** fixtures/ directory created with JSON + seed.py

### Phase 2: Frontend Infrastructure (Day 2-3, parallel)
- [ ] **B1:** `__tests__/helpers/mockData.ts` created
- [ ] **B1:** `__tests__/helpers/mockContexts.ts` created
- [ ] **B2:** `renderWithProviders.tsx` created
- [ ] **B3:** Existing tests refactored to use shared mocks

### Phase 3: Backend Tests (Day 3-5)
- [ ] **A4:** Record edge cases (17 tests)
- [ ] **A5:** Client edge cases (11 tests)
- [ ] **A6:** Payment edge cases (7 tests)
- [ ] **A7:** Activity edge cases (5 tests)
- [ ] **A8:** Record creation flow integration test
- [ ] **A9:** Data integrity tests
- [ ] **A10:** Visitor + Service edge cases

### Phase 4: Frontend E2E (Day 4-6)
- [ ] **B4:** E2E fixtures extracted
- [ ] **B5:** 20 E2E scenarios implemented
- [ ] **B6:** DB verification in 3+ tests
- [ ] **B7:** Visual regression baselines
- [ ] **B8:** Unit test coverage ≥ 80%

### Phase 5: Cross-Team (Day 7-8)
- [ ] **C1:** Playwright globalSetup with seed data
- [ ] **C2:** Dual webServer in playwright.config
- [ ] **C3:** CI workflow
- [ ] **C4:** DB path coordination
- [ ] **C5:** Full suite green
