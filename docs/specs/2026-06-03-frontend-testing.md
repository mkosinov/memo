# Frontend Testing Handbook — Memo Project

**Companion to:** `2026-06-03-testing-strategy.md`
**Audience:** Frontend developer (junior/middle)
**Last updated:** 2026-06-03

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Test Architecture Overview](#2-test-architecture-overview)
3. [Unit Tests — Mock Infrastructure](#3-unit-tests--mock-infrastructure)
4. [Unit Tests — Writing Tests](#4-unit-tests--writing-tests)
5. [E2E Tests — Infrastructure](#5-e2e-tests--infrastructure)
6. [E2E Tests — Writing Scenarios](#6-e2e-tests--writing-scenarios)
7. [E2E — DB Verification](#7-e2e--db-verification)
8. [Backend Startup (CI vs Local)](#8-backend-startup-ci-vs-local)
9. [Common Mistakes](#9-common-mistakes)
10. [Running Tests](#10-running-tests)

---

## 1. Quick Start

### Unit tests only (fast)
```bash
cd frontend/admin
npm run test          # vitest run (single pass)
npm run test:watch    # vitest (watch mode)
```

### E2E tests (needs backend + frontend running)
```bash
# Local development:
cd backend && uv run uvicorn src.main:app --port 8000 &   # start backend
cd frontend/admin && npm run dev &                          # start frontend (port 3001)
npm run test:e2e                                            # run playwright

# Or let Playwright start frontend automatically:
npm run test:e2e    # webServer in playwright.config starts frontend
                    # BUT backend must be started manually!
```

### All tests
```bash
npm run test:all    # vitest run && playwright test
```

---

## 2. Test Architecture Overview

```
frontend/admin/
├── __tests__/                    # Unit tests (vitest + jsdom)
│   ├── setup.ts                  # Global setup (jest-dom matchers)
│   ├── helpers/                  # ⭐ Shared test utilities
│   │   ├── mockData.ts          # Mock artists, services, locations
│   │   ├── mockContexts.ts      # Context mock factories
│   │   └── renderWithProviders.tsx  # Custom render with providers
│   ├── ActivityDetailsModal.test.tsx
│   ├── ActivityCard.test.tsx
│   └── ... (other component tests)
│
├── e2e/                          # E2E tests (Playwright + real browser)
│   ├── activity-details-modal.spec.ts
│   ├── week-view.spec.ts
│   ├── fixtures/                 # ⭐ Shared E2E utilities
│   │   ├── factories.ts         # createTestClient, createTestActivity
│   │   ├── db-query.ts          # Direct SQLite verification
│   │   ├── helpers.ts           # openModal, waitForScheduleReady
│   │   └── global-setup.ts     # Seed data before E2E suite
│   └── screenshots/             # Visual regression baselines
│
├── vitest.config.ts
└── playwright.config.ts
```

### Two layers, two tools

| Layer | Tool | What it tests | Speed |
|-------|------|---------------|-------|
| **Unit** | vitest + @testing-library/react | Component rendering, props, callbacks, state | ~100ms per test |
| **E2E** | Playwright | Full user flows in real browser, backend integration | ~5s per test |

**Rule of thumb:**
- Component renders correctly? → Unit test
- User clicks button and data persists in DB? → E2E test

---

## 3. Unit Tests — Mock Infrastructure

### Problem: Mock duplication

Currently, every test file defines its own `mockArtists`, `mockServices`, `mockLocations`, and mocks for `useSchedule`, `useRecords`, `useUI`. This is ~100 lines of boilerplate per file.

### Solution: Shared mock modules

#### `__tests__/helpers/mockData.ts`

```typescript
/**
 * Shared mock data for all unit tests.
 * Import this instead of defining mock data in each test file.
 */

import type { Activity } from '@memo/domain';

// ─── Reference Data ────────────────────────────────────────────────────────

export const mockArtists = [
  { id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова', shortName: 'Юлия', color: '#6B7E9C' },
];

export const mockServices = [
  {
    id: 's1', name: 'Картина маслом', duration: 2.5, maxCapacity: 8,
    minAge: '12', maxAge: '99',
    defaultAdultPrice: 3500, defaultChildPrice: 2500, defaultIndividualPrice: 5000,
    tariffs: [
      { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
      { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
    ],
  },
  {
    id: 's2', name: 'Картина акрилом', duration: 2, maxCapacity: 10,
    minAge: '6', maxAge: '99',
    defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000,
    tariffs: [
      { id: 't3', service_id: 's2', title: 'Взрослый', price: 2800, description: null },
    ],
  },
];

export const mockLocations = [
  { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж' },
  { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
];

export const mockActivity: Activity = {
  id: 'ev_1',
  day: 5,
  masterId: 'm1',
  startTime: 14,
  duration: 2.5,
  serviceId: 's1',
  serviceName: 'Картина маслом',
  minAge: '12',
  locationId: 'grand',
  occupied: 3,
  capacity: 8,
  isPrivate: false,
};

// ─── Factory Functions ─────────────────────────────────────────────────────

let counter = 0;

export function createMockActivity(overrides?: Partial<Activity>): Activity {
  counter++;
  return {
    ...mockActivity,
    id: `ev_test_${counter}`,
    ...overrides,
  };
}

export function createMockRecord(overrides?: Record<string, any>) {
  counter++;
  return {
    id: `r_test_${counter}`,
    activity_id: 'ev_1',
    client_id: 'c1',
    status: 'confirmed',
    seats: 1,
    comment: null,
    created_at: '2026-05-10T10:00:00',
    updated_at: '2026-05-10T10:00:00',
    is_active: true,
    visits: [],
    ...overrides,
  };
}

export function createMockClient(overrides?: Record<string, any>) {
  counter++;
  return {
    id: `c_test_${counter}`,
    name: `Test Client ${counter}`,
    phone: `+7999${String(counter).padStart(7, '0')}`,
    email: null,
    channel: 'telegram',
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    is_active: true,
    ...overrides,
  };
}
```

#### `__tests__/helpers/mockContexts.ts`

```typescript
/**
 * Factory functions for mocking React contexts.
 * Use these in beforeEach() to set up context mocks consistently.
 */

import { vi } from 'vitest';

// ─── ScheduleContext Mock ──────────────────────────────────────────────────

import { mockArtists, mockServices, mockLocations } from './mockData';

export function createScheduleContextMock(overrides?: Record<string, any>) {
  return {
    artists: mockArtists,
    services: mockServices,
    locations: mockLocations,
    activities: [],
    scheduleIndex: {
      byId: new Map(),
      byDate: new Map(),
      byMasterId: new Map(),
      byLocation: { all: { byDate: new Map(), byServiceId: new Map() } },
    },
    currentWeek: new Date(),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setCurrentWeek: vi.fn(),
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    setStamp: vi.fn(),
    copyLastWeek: vi.fn(),
    loading: false,
    error: null,
    filterMasterId: null,
    filterLocationId: null,
    setFilterMasterId: vi.fn(),
    setFilterLocationId: vi.fn(),
    ...overrides,
  };
}

// ─── RecordsContext Mock ───────────────────────────────────────────────────

export function createRecordsContextMock(overrides?: Record<string, any>) {
  return {
    records: [],
    clients: new Map(),
    payments: new Map(),
    activities: new Map(),
    masters: new Map(),
    services: new Map(),
    locations: new Map(),
    loading: false,
    error: null,
    ...overrides,
  };
}

// ─── UIContext Mock ────────────────────────────────────────────────────────

export function createUIContextMock(overrides?: Record<string, any>) {
  return {
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
    ...overrides,
  };
}
```

#### `__tests__/helpers/renderWithProviders.tsx`

```typescript
/**
 * Custom render that wraps component in necessary providers.
 * Use for integration-style unit tests where you want real context behavior.
 *
 * For most unit tests, prefer mocking contexts directly (see mockContexts.ts).
 * Use this when testing component interactions with real providers.
 */

import { render, type RenderOptions } from '@testing-library/react';
import React, { type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: ProviderOptions,
) {
  const queryClient = options?.queryClient ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  };
}
```

### How to use in tests

```typescript
// __tests__/MyComponent.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockActivity, mockArtists, mockServices, mockLocations } from './helpers/mockData';
import { createScheduleContextMock, createRecordsContextMock, createUIContextMock } from './helpers/mockContexts';

// Mock the context modules
vi.mock('@/contexts/ScheduleContext', () => ({ useSchedule: vi.fn() }));
vi.mock('@/contexts/RecordsContext', () => ({ useRecords: vi.fn() }));
vi.mock('@/contexts/UIContext', () => ({ useUI: vi.fn() }));

import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';

const mockUseSchedule = vi.mocked(useSchedule);
const mockUseRecords = vi.mocked(useRecords);
const mockUseUI = vi.mocked(useUI);

beforeEach(() => {
  mockUseSchedule.mockReturnValue(createScheduleContextMock());
  mockUseRecords.mockReturnValue(createRecordsContextMock());
  mockUseUI.mockReturnValue(createUIContextMock());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent activity={mockActivity} />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles custom context state', () => {
    // Override specific context values
    mockUseSchedule.mockReturnValue(
      createScheduleContextMock({ loading: true })
    );
    render(<MyComponent activity={mockActivity} />);
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });
});
```

---

## 4. Unit Tests — Writing Tests

### Template: Component test

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { mockActivity } from './helpers/mockData';
import { createScheduleContextMock, createUIContextMock } from './helpers/mockContexts';

// 1. Mock context modules
vi.mock('@/contexts/ScheduleContext', () => ({ useSchedule: vi.fn() }));
vi.mock('@/contexts/UIContext', () => ({ useUI: vi.fn() }));

import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';

const mockUseSchedule = vi.mocked(useSchedule);
const mockUseUI = vi.mocked(useUI);

// 2. Set up default mocks
beforeEach(() => {
  mockUseSchedule.mockReturnValue(createScheduleContextMock());
  mockUseUI.mockReturnValue(createUIContextMock());
});

afterEach(() => vi.restoreAllMocks());

// 3. Write tests
describe('MyComponent', () => {
  it('renders the component', () => {
    render(<MyComponent activity={mockActivity} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<MyComponent activity={mockActivity} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalled();
  });

  it('displays activity service name', () => {
    render(<MyComponent activity={mockActivity} onClose={vi.fn()} />);
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
  });
});
```

### Template: Testing user interactions

```typescript
describe('NewBookingTab', () => {
  it('adds a visitor row when button clicked', () => {
    render(<NewBookingTab {...defaultProps} />);
    
    // Initially no visitors
    expect(screen.queryAllByTestId('visitor-form-row').length).toBe(0);
    
    // Click add button
    fireEvent.click(screen.getByText(/\+ Добавить посетителя/));
    
    // Now 1 visitor row
    expect(screen.getAllByTestId('visitor-form-row').length).toBe(1);
  });

  it('validates name before submit', () => {
    const showToast = vi.fn();
    render(<NewBookingTab {...defaultProps} showToast={showToast} />);
    
    // Leave name empty, click submit
    fireEvent.click(screen.getByTestId('btn-create-record'));
    
    // Should show validation error
    expect(showToast).toHaveBeenCalledWith('Заполните имя');
  });
});
```

### Template: Testing API calls (mocked)

```typescript
// Mock the API client module
vi.mock('@memo/api-client', () => ({
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createPayment: vi.fn(),
}));

import { createRecord, deleteRecord } from '@memo/api-client';

beforeEach(() => {
  vi.mocked(createRecord).mockResolvedValue({
    id: 'r_new', status: 'pending', /* ... */
  });
});

describe('ClientTab — delete record', () => {
  it('shows undo toast on delete click', () => {
    vi.useFakeTimers();
    const showToast = vi.fn();
    render(<ClientTab {...defaultProps} showToast={showToast} />);
    
    fireEvent.click(screen.getByTestId('btn-delete-record'));
    
    expect(showToast).toHaveBeenCalledWith(
      'Запись удалена через 5 секунд',
      expect.any(Function),  // undo callback
    );
    
    vi.useRealTimers();
  });
});
```

---

## 5. E2E Tests — Infrastructure

### File structure

```
e2e/
├── fixtures/
│   ├── factories.ts      # Data creation via API
│   ├── helpers.ts        # UI interaction helpers
│   ├── db-query.ts       # Direct SQLite verification
│   └── global-setup.ts   # Seed reference data before suite
├── activity-details-modal.spec.ts
├── schedule.spec.ts
└── screenshots/          # Visual regression baselines
```

### `e2e/fixtures/factories.ts`

```typescript
import { type APIRequestContext, expect } from '@playwright/test';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

let testCounter = 0;
function uid(): string {
  testCounter++;
  return `e2e_${Date.now()}_${testCounter}`;
}

/**
 * Create a test client via backend API.
 * Always use this instead of hardcoding client data.
 */
export async function createTestClient(
  api: APIRequestContext,
  overrides?: { name?: string; phone?: string },
) {
  const name = overrides?.name || `Test Client ${uid()}`;
  const phone = overrides?.phone || `+7999${String(Date.now()).slice(-7)}`;
  const resp = await api.post(`${BACKEND}/api/v1/clients`, {
    data: { name, phone, channel: 'telegram' },
  });
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

/**
 * Create a test activity via backend API.
 * Uses first available master, service, location.
 */
export async function createTestActivity(
  api: APIRequestContext,
  overrides?: Record<string, any>,
) {
  const [mastersResp, servicesResp, locationsResp] = await Promise.all([
    api.get(`${BACKEND}/api/v1/masters`),
    api.get(`${BACKEND}/api/v1/services`),
    api.get(`${BACKEND}/api/v1/locations`),
  ]);
  const masters = await mastersResp.json();
  const services = await servicesResp.json();
  const locations = await locationsResp.json();

  const resp = await api.post(`${BACKEND}/api/v1/activities`, {
    data: {
      master_id: masters[0].id,
      service_id: services[0].id,
      location_id: locations[0].id,
      start: new Date().toISOString().slice(0, 19),
      duration: services[0].duration || 90,
      capacity: 8,
      is_private: false,
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

/**
 * Create a test record via backend API.
 */
export async function createTestRecord(
  api: APIRequestContext,
  activityId: string,
  clientId: string,
  overrides?: Record<string, any>,
) {
  const resp = await api.post(`${BACKEND}/api/v1/records`, {
    data: {
      activity_id: activityId,
      client_id: clientId,
      visits: [{ price: 3500 }],
      ...overrides,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

/**
 * Delete entity via API (ignore errors — used in cleanup).
 */
export async function cleanup(api: APIRequestContext, path: string) {
  try {
    await api.delete(`${BACKEND}${path}`);
  } catch {
    // Ignore cleanup errors
  }
}
```

### `e2e/fixtures/helpers.ts`

```typescript
import { type Page, expect } from '@playwright/test';

/**
 * Wait for schedule page to load with activity cards.
 */
export async function waitForScheduleReady(page: Page) {
  await page.goto('/schedule');
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });
}

/**
 * Open the activity details modal for the first visible activity.
 */
export async function openModal(page: Page) {
  const activity = await page.evaluate(() => {
    const card = document.querySelector('[data-testid^="activity-"]');
    if (!card) return null;
    const fiberKey = Object.keys(card).find((k: string) => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let current = (card as any)[fiberKey];
    while (current) {
      if (current.memoizedProps?.activity) return current.memoizedProps.activity;
      current = current.return;
    }
    return null;
  });
  if (!activity) throw new Error('No activity found on page');

  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-open-modal', { detail: { activity: act } }));
  }, activity);

  await page.waitForSelector('[data-testid="activity-details-modal"]', {
    state: 'visible',
    timeout: 10000,
  });
}

/**
 * Open the modal directly on the "new booking" (+) tab.
 */
export async function openAddTab(page: Page) {
  const activity = await page.evaluate(() => {
    const card = document.querySelector('[data-testid^="activity-"]');
    if (!card) return null;
    const fiberKey = Object.keys(card).find((k: string) => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let current = (card as any)[fiberKey];
    while (current) {
      if (current.memoizedProps?.activity) return current.memoizedProps.activity;
      current = current.return;
    }
    return null;
  });
  if (!activity) throw new Error('No activity found on page');

  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-quick-add', { detail: { activity: act } }));
  }, activity);

  await page.waitForSelector('[data-testid="activity-details-modal"]', {
    state: 'visible',
    timeout: 10000,
  });
  await expect(page.locator('[data-testid="new-booking-tab"]')).toBeVisible();
}
```

### `e2e/fixtures/global-setup.ts`

```typescript
/**
 * Playwright global setup — seeds reference data before E2E suite.
 * Runs once before all tests.
 *
 * Configure in playwright.config.ts:
 *   globalSetup: './e2e/fixtures/global-setup.ts'
 */

import { type FullConfig } from '@playwright/test';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

async function globalSetup(config: FullConfig) {
  // Seed masters
  await fetch(`${BACKEND}/api/v1/masters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first_name: 'Ольга', last_name: 'Середа',
      color: '#5B8C7A', position: 'мастер', specialty: 'живопись',
    }),
  });

  // Seed services
  await fetch(`${BACKEND}/api/v1/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Картина маслом', description: 'Масляная живопись',
      image_url: 'https://example.com/oil.jpg', specialty: 'живопись',
      min_age: 12, max_age: 99, duration: 90, record_info: 'Принести фартук',
    }),
  });

  // Seed locations
  await fetch(`${BACKEND}/api/v1/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Студия Альпика', address: 'Альпика, 1 этаж', capacity: 20,
    }),
  });
}

export default globalSetup;
```

---

## 6. E2E Tests — Writing Scenarios

### The Full Cycle Pattern

Every E2E test follows this exact pattern:

```
1. SETUP:     Create test data via API (factories)
2. ACTION:    User interaction in browser (click, type, navigate)
3. VERIFY UI: What the user SEES (toHaveText, toHaveValue)
4. VERIFY DB: What's STORED in backend (API GET or SQL)
5. CLEANUP:   Delete test data via API (cleanup helper)
```

### Template: E2E scenario

```typescript
import { test, expect } from '@playwright/test';
import { createTestClient, createTestActivity, createTestRecord, cleanup } from './fixtures/factories';
import { waitForScheduleReady, openModal, openAddTab } from './fixtures/helpers';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  test('Scenario description', async ({ page, request }) => {
    // 1. SETUP
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    // Reload to pick up new data
    await page.goto('/schedule');
    await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });

    // 2. ACTION
    await openModal(page);
    // ... user interactions ...

    // 3. VERIFY UI
    await expect(page.locator('[data-testid="some-element"]')).toBeVisible();
    await expect(page.locator('[data-testid="some-text"]')).toHaveText('Expected');

    // 4. VERIFY DB (via API)
    const resp = await request.get(`${BACKEND}/api/v1/records/${record.id}`);
    expect(resp.ok()).toBeTruthy();
    expect((await resp.json()).status).toBe('confirmed');

    // 5. CLEANUP
    await cleanup(request, `/api/v1/records/${record.id}`);
    await cleanup(request, `/api/v1/clients/${client.id}`);
  });
});
```

### Concrete example: Create record flow

```typescript
test('Create new record — data persists in backend', async ({ page, request }) => {
  const testPhone = `+7999${String(Date.now()).slice(-7)}`;

  // 1. SETUP — just navigate to add tab
  await openAddTab(page);

  // 2. ACTION — fill form
  await page.locator('[data-testid="input-phone"]').fill(testPhone);
  await page.locator('[data-testid="input-phone"]').blur();
  await page.locator('[data-testid="input-client-name"]').fill('E2E Client');
  await page.locator('[data-testid="btn-create-record"]').click();

  // 3. VERIFY UI — success toast
  await page.waitForFunction(() => {
    const toasts = document.querySelectorAll('[role="status"]');
    return toasts.length > 0;
  }, { timeout: 5000 });

  // 4. VERIFY DB — client was created with correct phone
  const clientsResp = await request.get(`${BACKEND}/api/v1/clients`);
  const clients = await clientsResp.json();
  const testClient = clients.find((c: any) => c.phone === testPhone);
  expect(testClient).toBeTruthy();
  expect(testClient.name).toBe('E2E Client');

  // 5. CLEANUP
  if (testClient) await cleanup(request, `/api/v1/clients/${testClient.id}`);
});
```

---

## 7. E2E — DB Verification

### When to use API vs SQL

| Check type | Use API | Use SQL |
|------------|---------|---------|
| Record was created | ✅ `GET /api/v1/records/{id}` | |
| Status was updated | ✅ `GET /api/v1/records/{id}` | |
| Soft delete flag set | | ✅ `SELECT is_active FROM records` |
| FK constraint | | ✅ `SELECT client_id FROM records` |
| Cascade behavior | | ✅ `SELECT COUNT(*) FROM visits WHERE record_id=...` |
| Payment total | | ✅ `SELECT SUM(amount) FROM payments WHERE record_id=...` |
| Concurrent state | | ✅ Direct read, no caching |

### `e2e/fixtures/db-query.ts`

```typescript
import { execSync } from 'child_process';

/**
 * Path to the test database.
 * In CI: set via environment variable.
 * Local: defaults to backend/test_memo.db.
 *
 * IMPORTANT: This must point to the SAME database the backend uses.
 * If backend uses a temp file, you need to coordinate the path.
 * See testing-strategy.md §C4 for details.
 */
const DB_PATH = process.env.TEST_DB_PATH || 'backend/test_memo.db';

/**
 * Execute a SQL query and return raw output.
 */
export function queryDB(sql: string): string {
  try {
    return execSync(`sqlite3 "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
    }).trim();
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}

/**
 * Execute a SQL query and return first row as object.
 * Returns null if no rows.
 */
export function queryDBRow(sql: string): Record<string, any> | null {
  try {
    const output = execSync(`sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
    }).trim();
    if (!output || output === '[]') return null;
    const rows = JSON.parse(output);
    return rows[0] || null;
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}

/**
 * Execute a SQL query and return all rows as array of objects.
 */
export function queryDBRows(sql: string): Record<string, any>[] {
  try {
    const output = execSync(`sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
    }).trim();
    if (!output || output === '[]') return [];
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}
```

### Usage examples

```typescript
import { queryDB, queryDBRow, queryDBRows } from './fixtures/db-query';

// Verify soft delete at DB level
test('Delete record — is_active set to 0', async ({ page, request }) => {
  // ... setup and delete action ...
  
  const row = queryDBRow(`SELECT is_active FROM records WHERE id='${recordId}'`);
  expect(row).not.toBeNull();
  expect(row!.is_active).toBe(0);  // SQLite stores bool as 0/1
});

// Verify cascade: visits deleted when record deleted
test('Delete record — visits also soft-deleted', async ({ page, request }) => {
  // ... setup and delete action ...
  
  const visits = queryDBRows(
    `SELECT * FROM visits WHERE record_id='${recordId}' AND is_active=1`
  );
  expect(visits.length).toBe(0);
});

// Verify payment total
test('Add payment — total is correct', async ({ page, request }) => {
  // ... setup and add payment action ...
  
  const total = queryDB(
    `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE record_id='${recordId}' AND is_active=1`
  );
  expect(Number(total)).toBe(1500);
});
```

---

## 8. Backend Startup (CI vs Local)

### Local development

Backend must be started **manually** before running E2E tests:

```bash
# Terminal 1: Start backend
cd backend
uv run uvicorn src.main:app --port 8000 --reload

# Terminal 2: Start frontend (or let Playwright do it)
cd frontend/admin
npm run dev  # starts on port 3001

# Terminal 3: Run E2E tests
cd frontend/admin
npm run test:e2e
```

**Playwright config** (`reuseExistingServer: true` in local):
```typescript
webServer: {
  command: 'pnpm exec next dev -p 3001',
  url: 'http://localhost:3001',
  reuseExistingServer: !process.env.CI,  // ← reuses your running dev server
  cwd: '.',
},
```

### CI (GitHub Actions)

Both backend and frontend are started automatically:

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Python deps
        run: cd backend && uv sync
      - name: Run backend tests
        run: cd backend && uv run pytest tests/ -v --tb=short

  frontend-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install deps
        run: cd frontend/admin && pnpm install
      - name: Run unit tests
        run: cd frontend/admin && pnpm run test

  e2e-tests:
    needs: [backend-tests, frontend-unit]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install backend deps
        run: cd backend && uv sync
      
      - name: Install frontend deps
        run: cd frontend/admin && pnpm install
      
      - name: Install Playwright browsers
        run: cd frontend/admin && npx playwright install chromium
      
      - name: Start backend
        run: cd backend && uv run uvicorn src.main:app --port 8000 &
      
      - name: Wait for backend
        run: npx wait-on http://localhost:8000/health --timeout 30000
      
      - name: Run E2E tests
        run: cd frontend/admin && npx playwright test
        env:
          CI: 'true'
          BACKEND_URL: http://localhost:8000
      
      - name: Upload screenshots on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-screenshots
          path: frontend/admin/test-results/
```

### Playwright config for dual webServer (CI)

```typescript
// playwright.config.ts — add backend webServer for CI
export default defineConfig({
  // ... existing config ...

  webServer: process.env.CI
    ? [
        // CI: start both backend and frontend
        {
          command: 'cd ../../backend && uv run uvicorn src.main:app --port 8000',
          url: 'http://localhost:8000/health',
          reuseExistingServer: false,
        },
        {
          command: 'pnpm exec next dev -p 3001',
          url: 'http://localhost:3001',
          reuseExistingServer: false,
          cwd: '.',
        },
      ]
    : [
        // Local: only start frontend (backend started manually)
        {
          command: 'pnpm exec next dev -p 3001',
          url: 'http://localhost:3001',
          reuseExistingServer: true,
          cwd: '.',
        },
      ],
});
```

---

## 9. Common Mistakes

### ❌ Mistake 1: Checking existence, not content

```typescript
// ❌ WRONG — passes if element exists but is empty
await expect(page.locator('[data-testid="activity-context"]')).toBeVisible();

// ✅ CORRECT — verifies element has actual content
const context = page.locator('[data-testid="activity-context"]');
await expect(context).toBeVisible();
const text = await context.textContent();
expect(text).toBeTruthy();
expect(text!.length).toBeGreaterThan(0);
```

### ❌ Mistake 2: Trusting HTTP 200 without DB check

```typescript
// ❌ WRONG — only checks API response
const resp = await request.post(`${BACKEND}/api/v1/records`, { data: payload });
expect(resp.ok()).toBeTruthy();
// But did the data actually persist correctly?

// ✅ CORRECT — verify in DB
const resp = await request.post(`${BACKEND}/api/v1/records`, { data: payload });
expect(resp.ok()).toBeTruthy();
const record = await resp.json();

// Verify via GET
const verifyResp = await request.get(`${BACKEND}/api/v1/records/${record.id}`);
expect(verifyResp.json().status).toBe('pending');

// Or verify via SQL for deep checks
const row = queryDBRow(`SELECT status FROM records WHERE id='${record.id}'`);
expect(row!.status).toBe('pending');
```

### ❌ Mistake 3: Hardcoded test data

```typescript
// ❌ WRONG — assumes specific masters/services exist
await api.post(`${BACKEND}/api/v1/activities`, {
  data: { master_id: 'specific-id', service_id: 'another-id', ... },
});

// ✅ CORRECT — use factories that fetch available data
const activity = await createTestActivity(request);
```

### ❌ Mistake 4: Not cleaning up

```typescript
// ❌ WRONG — test data accumulates, causes flaky tests
test('create record', async ({ request }) => {
  const client = await createTestClient(request);
  // ... test ...
  // No cleanup! Next test sees this client
});

// ✅ CORRECT — always clean up
test('create record', async ({ request }) => {
  const client = await createTestClient(request);
  try {
    // ... test ...
  } finally {
    await cleanup(request, `/api/v1/clients/${client.id}`);
  }
});
```

### ❌ Mistake 5: Mocking everything in unit tests

```typescript
// ❌ WRONG — mocks so much that test doesn't test anything real
vi.mock('@/contexts/ScheduleContext', () => ({ useSchedule: vi.fn() }));
vi.mock('@/contexts/RecordsContext', () => ({ useRecords: vi.fn() }));
vi.mock('@/contexts/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('@memo/api-client', () => ({ createRecord: vi.fn() }));
// Component renders but nothing works because everything is mocked

// ✅ CORRECT — mock only what the component directly depends on
// Use renderWithProviders for real QueryClient
// Mock only the API calls, let React state work normally
```

### ❌ Mistake 6: Using page.waitForTimeout() for synchronization

```typescript
// ❌ WRONG — fixed wait is flaky and slow
await page.locator('[data-testid="btn-submit"]').click();
await page.waitForTimeout(3000);  // hope it's enough...
await expect(page.locator('.toast')).toBeVisible();

// ✅ CORRECT — wait for specific condition
await page.locator('[data-testid="btn-submit"]').click();
await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 5000 });
```

### ❌ Mistake 7: Duplicating mock data across test files

```typescript
// ❌ WRONG — in every test file:
const mockArtists = [
  { id: 'm1', name: 'Ольга Середа', ... },
  { id: 'm2', name: 'Юлия Большакова', ... },
];

// ✅ CORRECT — import from shared module:
import { mockArtists } from './helpers/mockData';
```

---

## 10. Running Tests

### Commands

```bash
# Unit tests (fast, ~2s)
cd frontend/admin
npm run test              # single pass
npm run test:watch        # watch mode (re-runs on file change)

# E2E tests (slow, ~60s)
npm run test:e2e          # headless
npm run test:e2e:ui       # with browser UI (for debugging)
npm run test:e2e:update   # update screenshot baselines

# All tests
npm run test:all          # vitest run && playwright test
```

### Expected output

**Unit tests:**
```
 ✓ __tests__/ActivityDetailsModal.test.tsx (25 tests) 234ms
 ✓ __tests__/ActivityCard.test.tsx (8 tests) 120ms
 ...
 Test Files  25 passed (25)
 Tests       78 passed (78)
```

**E2E tests:**
```
 ✓  e2e/activity-details-modal.spec.ts:147:5 › 1. Admin opens activity (3.2s)
 ✓  e2e/activity-details-modal.spec.ts:181:5 › 2. Create new record (5.1s)
 ...
 12 passed (45.3s)
```

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Cannot find module '@memo/domain'` | Workspace not linked | Run `pnpm install` in project root |
| `Timeout 30000ms exceeded` | Backend not running | Start backend: `cd backend && uv run uvicorn src.main:app --port 8000` |
| `Error: page.goto: net::ERR_CONNECTION_REFUSED` | Frontend not running | Start frontend or check `webServer` config |
| `toHaveScreenshot: screenshot doesn't match` | UI changed | Run `npm run test:e2e:update` to update baselines |
| `vitest: Module not found` | Import path wrong | Check `vitest.config.ts` aliases |
| `sqlite3: command not found` | sqlite3 not installed | `apt-get install sqlite3` (should be in Docker image) |
| Test passes alone, fails in suite | Shared state between tests | Check `afterEach(() => vi.restoreAllMocks())` |
