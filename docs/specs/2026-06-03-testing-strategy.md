# Testing Strategy — Memo Project

**Date:** 2026-06-03
**Status:** Draft

## Problem Statement

E2E tests passed but real bugs went undetected. Tests checked element existence, not content. No database verification. No test isolation. Mock data disconnected from real data pipeline.

## Goals

1. Every test verifies **what the user sees** AND **what's stored in DB**
2. Every test is **isolated** — own data, no cross-test dependencies
3. Backend API tests come **before** frontend E2E
4. Test infrastructure is **deterministic** — same inputs → same results

---

## Part 1: Test Infrastructure

### 1.1 Test Database

**Decision:** Separate SQLite file for tests, not dev DB.

```
backend/memo.db          ← dev database (NEVER touched by tests)
backend/test_memo.db     ← test database (created/destroyed per run)
```

**Configuration:**
- `backend/.env.test`: `DATABASE_URL=sqlite+aiosqlite:///./test_memo.db`
- Backend reads `.env.test` when `ENV_FILE=.env.test`
- pytest conftest already sets `ENV_FILE=.env.test`

**Lifecycle:**
```
Before suite:  rm -f test_memo.db && create tables + seed reference data
Before each test:  truncate all tables (or recreate)
After suite:  rm -f test_memo.db
```

### 1.2 Data Cleanup Strategy

**Approach: Truncate + reseed per test.**

```python
@pytest.fixture(autouse=True)
def reset_db():
    """Truncate all tables before each test."""
    # Delete in FK order: visits → records → payments → clients → ...
    # Then reseed reference data (masters, services, locations, tariffs)
    yield
    # No cleanup needed — truncation happens at start
```

**Why truncate, not rollback:**
- Tests use separate DB file — no interference with dev
- Truncate is fast on SQLite
- Each test starts from known state
- No transaction isolation issues between async clients

### 1.3 Test Data Factories

**Backend (pytest):** Fixture-based factories.

```python
@pytest.fixture
def create_client(db):
    """Factory fixture — creates a client with unique data."""
    created = []
    def factory(**overrides):
        data = {
            "name": f"Test Client {uuid4().hex[:8]}",
            "phone": f"+7999{random.randint(1000000, 9999999)}",
            "channel": "website",
            **overrides,
        }
        client = Client(**data)
        db.add(client)
        db.commit()
        created.append(client)
        return client
    yield factory
    # Cleanup not needed — truncation handles it
```

**Frontend (Playwright):** API-based factories via `page.request`.

```typescript
// e2e/fixtures/factories.ts
export async function createTestClient(api: APIRequestContext, overrides?) {
    const resp = await api.post(`${BACKEND}/api/v1/clients`, {
        data: {
            name: `E2E Client ${uid()}`,
            phone: `+7999${Date.now()}`,
            channel: 'website',
            ...overrides,
        },
    });
    return resp.json();
}
```

### 1.4 Test Data Sets

**Static fixtures** (for reference data that doesn't change):
```
backend/tests/fixtures/
├── masters.json       # 2-3 test masters
├── services.json      # 2-3 test services with tariffs
├── locations.json     # 1-2 test locations
└── seed.py            # Loads fixtures into DB
```

**Dynamic factories** (for business data that must be unique per test):
```
e2e/fixtures/
├── factories.ts       # createTestClient, createTestActivity, createTestRecord
├── db-query.ts        # queryDB(sql) — direct SQLite verification
└── helpers.ts         # openModal, waitForScheduleReady, etc.
```

### 1.5 DB Verification Helper

**Frontend E2E tests** verify DB state via direct SQL:

```typescript
// e2e/fixtures/db-query.ts
import { execSync } from 'child_process';

const DB_PATH = 'backend/test_memo.db';

export function queryDB(sql: string): string {
    return execSync(`sqlite3 ${DB_PATH} "${sql}"`, { encoding: 'utf-8' }).trim();
}

export function queryDBRow(sql: string): Record<string, string> {
    const output = queryDB(`${sql} -json`);
    return output ? JSON.parse(output) : {};
}

// Usage in tests:
const count = queryDB("SELECT COUNT(*) FROM records WHERE client_id = 'c1'");
expect(count).toBe('1');
```

---

## Part 2: Backend API Tests

### 2.1 Test Organization

```
backend/tests/
├── conftest.py                    # DB fixtures, client fixtures
├── fixtures/
│   ├── masters.json
│   ├── services.json
│   ├── locations.json
│   └── seed.py
├── test_api_records.py            # CRUD + edge cases
├── test_api_clients.py            # CRUD + phone search
├── test_api_payments.py           # CRUD + edge cases
├── test_api_visitors.py           # CRUD + edge cases
├── test_api_activities.py         # CRUD + date filtering + occupied
├── test_api_services.py           # CRUD + tariffs
├── test_record_creation_flow.py   # Integration: phone → client → record → visits
├── test_edge_cases.py             # Validation, boundary values, error handling
└── test_data_integrity.py         # FK constraints, soft delete, cascade
```

### 2.2 Edge Cases to Cover

#### Records (test_api_records.py + test_edge_cases.py)

| # | Edge Case | Expected |
|---|-----------|----------|
| 1 | Create record with valid data | 201, record in DB |
| 2 | Create record with non-existent activity_id | 404 or FK error |
| 3 | Create record with non-existent client_id | 404 or FK error |
| 4 | Create record with empty visits array | 201, seats=0 |
| 5 | Create record with phone (new client) | 201, client created |
| 6 | Create record with phone (existing client) | 201, client reused |
| 7 | Update record status | 200, status changed in DB |
| 8 | Update record with invalid status value | 422 validation error |
| 9 | Delete record (soft delete) | 204, is_active=false in DB |
| 10 | Get deleted record | 404 |
| 11 | List records with date filter | Only records in range |
| 12 | Create record exceeding activity capacity | 400 or business error |
| 13 | Update record concurrently | Last write wins or conflict |
| 14 | Create record with missing required fields | 422 validation error |

#### Clients (test_api_clients.py)

| # | Edge Case | Expected |
|---|-----------|----------|
| 1 | Create client with duplicate phone | 409 or error |
| 2 | Create client without phone | 201 (phone optional) |
| 3 | Search by phone — found | 200 + client data |
| 4 | Search by phone — not found | 404 |
| 5 | Search by phone — inactive client | 404 |
| 6 | Update client name | 200, name changed |
| 7 | Delete client with active records | 400 or cascade behavior |
| 8 | List clients with special characters in name | 200, no SQL injection |

#### Payments (test_api_payments.py)

| # | Edge Case | Expected |
|---|-----------|----------|
| 1 | Create payment with amount=0 | 422 validation error |
| 2 | Create payment with negative amount | 422 validation error |
| 3 | Create payment for non-existent record | 404 |
| 4 | Delete payment | 204, is_active=false |
| 5 | Create multiple payments for same record | 201, all stored |
| 6 | Total payments exceed record cost | 201 (overpayment allowed) |
| 7 | Payment method validation | Only cash/card/transfer |

#### Activities (test_api_activities.py)

| # | Edge Case | Expected |
|---|-----------|----------|
| 1 | Create activity with past date | 201 (allowed) |
| 2 | Create activity with capacity=0 | 422 |
| 3 | Patch partial update | 200, only changed fields |
| 4 | Get activity with occupied count | 200, occupied=actual records |
| 5 | Date range filter | Only activities in range |

#### Visitors (test_api_visitors.py)

| # | Edge Case | Expected |
|---|-----------|----------|
| 1 | Create visitor without age | 201, age=null |
| 2 | Create visitor with age=0 | 201 (child) |
| 3 | Create visitor with age=100 | 201 (elderly) |
| 4 | Delete visitor with active visits | 400 or cascade |
| 5 | Update visit status to invalid value | 422 |

### 2.3 Record Creation Flow (Integration Test)

```python
# test_record_creation_flow.py
def test_full_record_creation_via_phone():
    """
    Simulates real user flow:
    1. Admin enters phone → API finds existing client
    2. Admin adds visitor → API creates visitor
    3. Admin submits → API creates record + visits
    4. Verify: DB has correct records, visits, client link
    """
    # Setup: create activity, service, master
    activity = create_test_activity()
    
    # Step 1: Create record with phone
    resp = api.post("/api/v1/records", json={
        "activity_id": activity.id,
        "phone": "+79991234567",
        "visits": [{"price": 3500}]
    })
    assert resp.status_code == 201
    
    # Step 2: Verify client was created
    client = query_db("SELECT * FROM clients WHERE phone = '+79991234567'")
    assert client is not None
    
    # Step 3: Verify record links to client
    record = query_db(f"SELECT * FROM records WHERE id = '{resp.json()['id']}'")
    assert record["client_id"] == client["id"]
    
    # Step 4: Verify visits exist
    visits = query_db(f"SELECT * FROM visits WHERE record_id = '{record['id']}'")
    assert len(visits) >= 1
```

---

## Part 3: Frontend E2E Tests

### 3.1 Test Organization

```
frontend/admin/e2e/
├── activity-details-modal.spec.ts    # Full user scenarios
├── schedule.spec.ts                  # Week view, DnD, navigation
├── records.spec.ts                   # Records table
├── fixtures/
│   ├── factories.ts                  # createTestClient, etc.
│   ├── db-query.ts                   # Direct SQLite verification
│   └── helpers.ts                    # openModal, waitForReady
└── screenshots/                      # Visual regression baselines
```

### 3.2 Test Pattern: Full Cycle

Every E2E test follows this pattern:

```
1. SETUP:     Create test data via API (page.request.post)
2. ACTION:    User interaction in browser (click, type, navigate)
3. VERIFY UI: What the user SEES (toHaveText, toHaveValue)
4. VERIFY DB: What's STORED in database (sqlite3 query)
5. CLEANUP:   Delete test data via API (page.request.delete)
```

### 3.3 Scenarios to Cover

#### ActivityDetailsModal (activity-details-modal.spec.ts)

**Scenario 1: View Activity Settings**
```
1. Open modal on activity
2. VERIFY UI: Context header shows service name + date
3. VERIFY UI: Duration shows "HH:MM" format (not decimal)
4. VERIFY UI: Age shows "N–M" or "N+" (no "++")
5. VERIFY UI: Service select has selected value (not empty)
6. VERIFY UI: Master select has selected value
```

**Scenario 2: Create Record — Full Flow**
```
1. SETUP: Create test client via API
2. Open modal on "+" tab
3. Fill phone → VERIFY name auto-fills
4. Add visitor → fill name
5. Click "Создать запись"
6. VERIFY UI: Toast "Запись создана"
7. VERIFY DB: SELECT FROM records WHERE client_id = ?
8. VERIFY DB: SELECT FROM visits WHERE record_id = ?
9. VERIFY DB: SELECT FROM clients WHERE phone = ?
10. CLEANUP: Delete record, client via API
```

**Scenario 3: Create Record — No Phone**
```
1. Open modal on "+" tab
2. Leave phone empty
3. Fill name
4. Submit
5. VERIFY UI: Success toast
6. VERIFY DB: Client created with phone=''
7. CLEANUP
```

**Scenario 4: Delete with Undo**
```
1. SETUP: Create record via API
2. Open client tab
3. Click "Удалить запись"
4. VERIFY UI: Toast "Запись удалена через 5 секунд"
5. Click "Отмена" within 5s
6. VERIFY DB: record.is_active = 1 (still exists)
7. CLEANUP
```

**Scenario 5: Delete — Timeout**
```
1. SETUP: Create record via API
2. Open client tab
3. Click "Удалить запись"
4. Wait 7 seconds
5. VERIFY DB: SELECT FROM records WHERE id = ? → empty
6. CLEANUP client
```

**Scenario 6: Add Payment**
```
1. SETUP: Create record via API
2. Open client tab
3. Fill amount, select method
4. Click "Добавить оплату"
5. VERIFY UI: Toast "Оплата добавлена"
6. VERIFY DB: SELECT FROM payments WHERE record_id = ? → amount correct
7. VERIFY DB: Financial summary updated (total_paid, remaining)
8. CLEANUP
```

**Scenario 7: Delete Payment**
```
1. SETUP: Create record + payment via API
2. Open client tab
3. Click × on payment
4. VERIFY UI: Toast "Оплата удалена"
5. VERIFY DB: SELECT FROM payments WHERE id = ? → is_active=0
6. CLEANUP
```

**Scenario 8: Settings — Service Change Auto-Fills**
```
1. Open modal on Settings tab
2. Note current duration/capacity
3. Select different service
4. VERIFY UI: Duration changed to service's duration
5. VERIFY UI: Capacity changed to service's capacity
6. VERIFY UI: Age display updated
7. VERIFY DB: SELECT FROM activities WHERE id = ? → service_id updated
```

**Scenario 9: Validation — Cannot Submit Without Name**
```
1. Open modal on "+" tab
2. Leave name empty
3. Click submit
4. VERIFY UI: Toast "Заполните имя"
5. VERIFY DB: No new records created
```

**Scenario 10: Tab Navigation — Content Changes**
```
1. Open modal
2. VERIFY UI: Settings tab visible
3. Click "+" tab
4. VERIFY UI: New booking tab visible
5. Click Settings tab
6. VERIFY UI: Settings tab visible again
```

**Scenario 11: Private Toggle**
```
1. Open modal on Settings tab
2. Note current aria-checked state
3. Click toggle
4. VERIFY UI: aria-checked changed
5. VERIFY DB: SELECT is_private FROM activities WHERE id = ?
```

**Scenario 12: Channel Select Always Visible**
```
1. Open modal on "+" tab
2. VERIFY UI: Channel select visible WITHOUT checking notifications checkbox
3. VERIFY UI: Checkbox unchecked by default
```

**Scenario 13: Financial Summary Updates**
```
1. SETUP: Create record with price=3500
2. Open modal
3. VERIFY UI: Footer shows "К оплате: 3 500 ₽"
4. Add payment 1500
5. VERIFY UI: Footer shows "К оплате: 2 000 ₽"
6. VERIFY DB: payments table has correct total
7. CLEANUP
```

**Scenario 14: Visitor Management**
```
1. Open modal on "+" tab
2. Initially: no visitor rows
3. Click "Добавить посетителя"
4. VERIFY UI: 1 visitor row appears
5. Fill visitor name
6. Add another visitor
7. VERIFY UI: 2 visitor rows
8. Remove first visitor
9. VERIFY UI: 1 visitor row remains
```

**Scenario 15: Age Display — All Formats**
```
1. SETUP: Create activity with service minAge=6, maxAge=12
2. Open modal
3. VERIFY UI: Age shows "6–12"
4. SETUP: Create activity with service minAge=6, maxAge=0
5. VERIFY UI: Age shows "6+"
6. CLEANUP
```

**Scenario 16: Master Color Dot**
```
1. Open modal on Settings tab
2. Select a master
3. VERIFY UI: Color dot visible next to master name
4. VERIFY UI: Dot color matches master's color hex
```

#### Edge Cases

**Scenario 17: Create Record — Invalid Duration**
```
1. Open modal on Settings tab
2. Type "99:99" in duration field
3. VERIFY UI: No crash, modal still visible
4. VERIFY UI: Duration shows the typed value
```

**Scenario 18: Empty Activity — No Client Tabs**
```
1. SETUP: Create activity with no records
2. Open modal
3. VERIFY UI: Only "Настройка" and "+" tabs visible
4. No client tabs
```

**Scenario 19: Network Error on Create**
```
1. Open modal on "+" tab
2. Mock network failure (page.route intercept)
3. Fill form, submit
4. VERIFY UI: Error toast "Ошибка создания записи"
5. VERIFY DB: No new records
```

**Scenario 20: Data Persistence After Reload**
```
1. SETUP: Create record via API
2. Open modal, verify client tab exists
3. Close modal
4. Reload page
5. Open modal again
6. VERIFY UI: Client tab still visible
7. VERIFY DB: Record still exists
8. CLEANUP
```

### 3.4 Visual Regression

**Screenshots for key states:**
```
e2e/screenshots/
├── modal-settings-tab.png
├── modal-client-tab.png
├── modal-new-booking-tab.png
├── modal-footer-with-balance.png
├── modal-footer-zero-balance.png
└── age-display-range.png
```

---

## Part 4: Test Execution Order

```
Phase 1: Backend API Tests (pytest)
  ├── Run: cd backend && uv run pytest tests/ -v
  ├── Verify: All 194+ tests pass
  └── Gate: MUST pass before Phase 2

Phase 2: Frontend E2E Tests (Playwright)
  ├── Run: cd frontend/admin && npx playwright test
  ├── Verify: All scenarios pass
  ├── Verify: DB checks pass
  └── Gate: MUST pass before merge
```

### 4.1 CI Integration

```yaml
# .github/workflows/test.yml
jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install deps
        run: cd backend && uv sync
      - name: Run tests
        run: cd backend && uv run pytest tests/ -v --tb=short
  
  frontend-e2e:
    needs: backend-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install deps
        run: cd frontend/admin && pnpm install
      - name: Start backend
        run: cd backend && uv run uvicorn src.main:app --port 8000 &
      - name: Start frontend
        run: cd frontend/admin && pnpm dev &
      - name: Wait for services
        run: npx wait-on http://localhost:8000 http://localhost:3001
      - name: Run E2E tests
        run: cd frontend/admin && npx playwright test
      - name: Upload screenshots
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-screenshots
          path: frontend/admin/test-results/
```

---

## Part 5: File Structure Summary

```
memo/
├── backend/
│   ├── .env.test                          # Test DB config
│   ├── test_memo.db                       # Test database (auto-created)
│   ├── tests/
│   │   ├── conftest.py                    # DB reset, fixtures
│   │   ├── fixtures/
│   │   │   ├── masters.json
│   │   │   ├── services.json
│   │   │   ├── locations.json
│   │   │   └── seed.py
│   │   ├── test_api_records.py
│   │   ├── test_api_clients.py
│   │   ├── test_api_payments.py
│   │   ├── test_api_visitors.py
│   │   ├── test_api_activities.py
│   │   ├── test_api_services.py
│   │   ├── test_record_creation_flow.py
│   │   ├── test_edge_cases.py
│   │   └── test_data_integrity.py
│   └── pytest.ini
│
├── frontend/admin/
│   ├── e2e/
│   │   ├── activity-details-modal.spec.ts
│   │   ├── schedule.spec.ts
│   │   ├── fixtures/
│   │   │   ├── factories.ts
│   │   │   ├── db-query.ts
│   │   │   └── helpers.ts
│   │   └── screenshots/
│   ├── playwright.config.ts
│   └── package.json
│
└── docs/
    └── specs/
        └── 2026-06-03-testing-strategy.md  # This document
```

---

## Part 6: Migration Plan

### Phase 1: Backend Tests (this week)
- [ ] Verify existing 194 tests pass on test DB
- [ ] Add missing edge case tests (validation, boundary values)
- [ ] Add integration test for record creation flow
- [ ] Add data integrity tests (FK, soft delete, cascade)

### Phase 2: Test Infrastructure (this week)
- [ ] Create `db-query.ts` helper for Playwright
- [ ] Create `factories.ts` with API-based test data creation
- [ ] Configure Playwright to use `test_memo.db` for DB verification
- [ ] Add cleanup hooks (afterEach deletes test data)

### Phase 3: Frontend E2E (next week)
- [ ] Rewrite existing tests with DB verification
- [ ] Add full-cycle scenarios (UI → DB check)
- [ ] Add edge case scenarios
- [ ] Add visual regression screenshots

### Phase 4: CI Integration (next week)
- [ ] GitHub Actions workflow for backend tests
- [ ] GitHub Actions workflow for E2E tests
- [ ] Screenshot artifact upload on failure
