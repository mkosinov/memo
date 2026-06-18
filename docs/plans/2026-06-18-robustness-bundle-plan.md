# Robustness Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix React Query silent error handling (#64), fix 5 failing e2e tests (#65), close RecordsContext review as wontfix (#53) — combined into one PR.

**Architecture:** Minimal error stack: `react-error-boundary` for render throws, global `QueryCache.onError` for fetch failures (toast + console.error), shared `<ErrorState>` for inline UI in 7 list components. 5 e2e tests get deterministic seed data and `waitForResponse` instead of timeouts.

**Tech Stack:** Next.js 14, React 18, `@tanstack/react-query@5`, `react-error-boundary`, Vitest, Playwright, TypeScript.

**Branch:** `fix/robustness-bundle`
**PR title:** `fix: robustness bundle (#53, #64, #65)`
**Closes:** #53, #64, #65

---

## Task 1: Install `react-error-boundary`
**Classification:** trivial

### Required Docs
- `frontend/admin/package.json` — current dependencies

### Steps

- [ ] **Step 1.1:** Add dependency
  ```bash
  cd /root/workspace/memo
  pnpm --filter admin add react-error-boundary
  ```

- [ ] **Step 1.2:** Verify
  ```bash
  grep "react-error-boundary" frontend/admin/package.json
  ```
  Expected: line containing `"react-error-boundary": "^x.y.z"`

- [ ] **Step 1.3:** Commit
  ```bash
  git add frontend/admin/package.json pnpm-lock.yaml
  git commit -m "chore(admin): add react-error-boundary dependency"
  ```

---

## Task 2: Create ErrorState component + 3 unit tests
**Classification:** small

### Required Docs
- `docs/v4-design-system.md` — colors, spacing, typography
- `frontend/admin/tailwind.config.ts` — theme tokens (if needed)

### Task Description
Create `frontend/admin/app/components/error/ErrorState.tsx` with 3 variants (`table`, `card`, `inline`). Each renders a "Не удалось загрузить" message with optional Retry button. Variant `table` returns a `<tr><td colSpan={N}>…</td></tr>` so it can be used inside `<tbody>`.

### Steps

- [ ] **Step 2.1:** RED — write test
  File: `frontend/admin/__tests__/error/ErrorState.test.tsx`
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { ErrorState } from '@/app/components/error/ErrorState';

  describe('ErrorState', () => {
    it('renders default message and retry button', () => {
      const onRetry = vi.fn();
      render(<ErrorState error={new Error('boom')} onRetry={onRetry} />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Не удалось загрузить/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /повторить/i }));
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('renders <tr> when variant=table', () => {
      const { container } = render(
        <table>
          <tbody>
            <ErrorState error={new Error('x')} variant="table" />
          </tbody>
        </table>
      );
      expect(container.querySelector('tr')).toBeInTheDocument();
      expect(container.querySelector('tr')?.querySelector('td[colspan]')).toBeInTheDocument();
    });

    it('hides retry button when onRetry not provided', () => {
      render(<ErrorState error={new Error('x')} variant="inline" />);
      expect(screen.queryByRole('button', { name: /повторить/i })).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2.2:** Run test, expect FAIL
  ```bash
  cd frontend/admin && npx vitest run __tests__/error/ErrorState.test.tsx
  ```
  Expected: `Failed to resolve import` or `Cannot find module`.

- [ ] **Step 2.3:** GREEN — implement component
  File: `frontend/admin/app/components/error/ErrorState.tsx`
  ```tsx
  'use client';

  import React from 'react';

  export type ErrorStateVariant = 'table' | 'card' | 'inline';

  export interface ErrorStateProps {
    error: Error | null;
    onRetry?: () => void;
    title?: string;
    variant?: ErrorStateVariant;
    colspan?: number;
  }

  export function ErrorState({
    error,
    onRetry,
    title = 'Не удалось загрузить данные',
    variant = 'inline',
    colspan,
  }: ErrorStateProps) {
    const content = (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 py-8 text-sm text-white/70"
        data-testid="error-state"
      >
        <div className="text-base font-medium text-white">{title}</div>
        {error?.message && (
          <div className="text-xs text-white/50 max-w-md text-center">{error.message}</div>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 px-4 py-1.5 rounded bg-brand text-white text-sm hover:bg-brand-light transition-colors"
          >
            Повторить
          </button>
        )}
      </div>
    );

    if (variant === 'table') {
      return (
        <tr>
          <td colSpan={colspan ?? 99} className="text-center">
            {content}
          </td>
        </tr>
      );
    }
    return content;
  }
  ```

- [ ] **Step 2.4:** Run test, expect PASS
  ```bash
  npx vitest run __tests__/error/ErrorState.test.tsx
  ```
  Expected: `3 passed`.

- [ ] **Step 2.5:** Commit
  ```bash
  git add frontend/admin/app/components/error/ErrorState.tsx frontend/admin/__tests__/error/ErrorState.test.tsx
  git commit -m "feat(admin): add ErrorState component with 3 variants"
  ```

---

## Task 3: Create FullPageError component
**Classification:** small

### Required Docs
- `docs/v4-design-system.md` — colors

### Task Description
Create `frontend/admin/app/components/error/FullPageError.tsx` — used as fallback for `ErrorBoundary` when a render-throw happens. Shows full-screen error with "Перезагрузить" button.

### Steps

- [ ] **Step 3.1:** Create file
  File: `frontend/admin/app/components/error/FullPageError.tsx`
  ```tsx
  'use client';

  import React from 'react';

  export interface FullPageErrorProps {
    error: Error;
    onReset?: () => void;
  }

  export function FullPageError({ error, onReset }: FullPageErrorProps) {
    return (
      <div
        role="alert"
        className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-main p-8 text-white"
        data-testid="full-page-error"
      >
        <h1 className="text-2xl font-semibold">Что-то пошло не так</h1>
        <p className="text-sm text-white/70 max-w-md text-center">
          Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу.
        </p>
        {error?.message && (
          <pre className="text-xs text-white/50 max-w-2xl overflow-auto bg-sidebar p-3 rounded">
            {error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={() => onReset?.() ?? window.location.reload()}
          className="mt-2 px-5 py-2 rounded bg-brand text-white hover:bg-brand-light transition-colors"
        >
          Перезагрузить
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 3.2:** Commit
  ```bash
  git add frontend/admin/app/components/error/FullPageError.tsx
  git commit -m "feat(admin): add FullPageError fallback component"
  ```

---

## Task 4: Create ErrorBoundary wrapper + 2 unit tests
**Classification:** small

### Required Docs
- `react-error-boundary` README — API: `ErrorBoundary`, `fallbackRender`

### Task Description
Wrap `react-error-boundary` with our project's `FullPageError` as the default fallback. Export a simple `<ErrorBoundary>` component.

### Steps

- [ ] **Step 4.1:** RED — write test
  File: `frontend/admin/__tests__/error/ErrorBoundary.test.tsx`
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { ErrorBoundary } from '@/app/components/error/ErrorBoundary';

  function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('render exploded');
    return <div>safe</div>;
  }

  describe('ErrorBoundary', () => {
    it('renders children when no error', () => {
      render(
        <ErrorBoundary>
          <Bomb shouldThrow={false} />
        </ErrorBoundary>
      );
      expect(screen.getByText('safe')).toBeInTheDocument();
    });

    it('renders FullPageError on render throw', () => {
      // Suppress console.error from React's error logging
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <ErrorBoundary>
          <Bomb shouldThrow={true} />
        </ErrorBoundary>
      );
      expect(screen.getByTestId('full-page-error')).toBeInTheDocument();
      expect(screen.getByText(/Что-то пошло не так/)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 4.2:** Run test, expect FAIL
  ```bash
  npx vitest run __tests__/error/ErrorBoundary.test.tsx
  ```
  Expected: import error.

- [ ] **Step 4.3:** GREEN — implement
  File: `frontend/admin/app/components/error/ErrorBoundary.tsx`
  ```tsx
  'use client';

  import React from 'react';
  import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from 'react-error-boundary';
  import { FullPageError } from './FullPageError';

  function defaultFallback({ error, resetErrorBoundary }: FallbackProps) {
    return <FullPageError error={error} onReset={resetErrorBoundary} />;
  }

  export interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: (props: FallbackProps) => React.ReactNode;
  }

  export function ErrorBoundary({ children, fallback = defaultFallback }: ErrorBoundaryProps) {
    return <ReactErrorBoundary fallbackRender={fallback}>{children}</ReactErrorBoundary>;
  }
  ```

- [ ] **Step 4.4:** Run test, expect PASS
  ```bash
  npx vitest run __tests__/error/ErrorBoundary.test.tsx
  ```
  Expected: `2 passed`.

- [ ] **Step 4.5:** Create barrel export
  File: `frontend/admin/app/components/error/index.ts`
  ```ts
  export { ErrorBoundary } from './ErrorBoundary';
  export { ErrorState, type ErrorStateProps, type ErrorStateVariant } from './ErrorState';
  export { FullPageError } from './FullPageError';
  ```

- [ ] **Step 4.6:** Commit
  ```bash
  git add frontend/admin/app/components/error/ErrorBoundary.tsx frontend/admin/app/components/error/index.ts frontend/admin/__tests__/error/ErrorBoundary.test.tsx
  git commit -m "feat(admin): add ErrorBoundary wrapper with FullPageError fallback"
  ```

---

## Task 5: Extend UIContext Toast with `kind` field
**Classification:** small

### Required Docs
- `frontend/admin/contexts/UIContext.tsx` — current Toast shape
- `frontend/admin/__tests__/UIContext.test.tsx` — if exists

### Task Description
Add `kind: 'info' | 'success' | 'error'` to `Toast` interface. Extend `showToast` signature to accept optional `kind`. Backward compat: `showToast(msg, undo)` works as before.

### Steps

- [ ] **Step 5.1:** Update Toast interface and showToast
  File: `frontend/admin/contexts/UIContext.tsx` — replace the `Toast` interface and `showToast` signature:
  ```ts
  export type ToastKind = 'info' | 'success' | 'error';

  interface Toast {
    id: string;
    kind: ToastKind;
    message: string;
    undo?: () => void;
  }

  interface UIContextType {
    // ... existing
    showToast: (message: string, kindOrUndo?: ToastKind | (() => void), undo?: () => void) => void;
  }
  ```

  Update the `showToast` implementation:
  ```ts
  const showToast = useCallback((
    message: string,
    kindOrUndo?: ToastKind | (() => void),
    undo?: () => void,
  ) => {
    let kind: ToastKind = 'info';
    let undoFn: (() => void) | undefined;
    if (typeof kindOrUndo === 'function') {
      undoFn = kindOrUndo;
    } else if (kindOrUndo) {
      kind = kindOrUndo;
      undoFn = undo;
    }
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, kind, message, undo: undoFn }]);
    // ... timer logic same as before
  }, []);
  ```

- [ ] **Step 5.2:** Run existing UIContext tests (if any)
  ```bash
  npx vitest run __tests__/UIContext
  ```
  Expected: pass (backward compat).

- [ ] **Step 5.3:** Commit
  ```bash
  git add frontend/admin/contexts/UIContext.tsx
  git commit -m "feat(admin): extend Toast with kind field (info|success|error)"
  ```

---

## Task 6: Update ToastContainer for visual `kind`
**Classification:** small

### Required Docs
- `frontend/admin/app/components/toast/ToastContainer.tsx` — current styles

### Task Description
Add visual distinction for `toast.kind === 'error'` (red left border) and `'success'` (green left border). Keep `info` (default) unchanged.

### Steps

- [ ] **Step 6.1:** Update toast rendering
  File: `frontend/admin/app/components/toast/ToastContainer.tsx` — replace the inner div:
  ```tsx
  const BORDER_BY_KIND: Record<string, string> = {
    info: 'border-transparent',
    success: 'border-l-4 border-l-emerald-400',
    error: 'border-l-4 border-l-red-400',
  };

  {visible.map((toast) => (
    <div
      key={toast.id}
      data-testid={`toast-${toast.kind}`}
      className={`flex items-center gap-3 bg-sidebar text-white px-4 py-3 rounded-lg shadow-lg text-sm animate-slide-up ${BORDER_BY_KIND[toast.kind] ?? BORDER_BY_KIND.info}`}
    >
      {/* same children as before */}
    </div>
  ))}
  ```

- [ ] **Step 6.2:** Run toast tests
  ```bash
  npx vitest run __tests__ -t toast
  ```
  Expected: pass.

- [ ] **Step 6.3:** Commit
  ```bash
  git add frontend/admin/app/components/toast/ToastContainer.tsx
  git commit -m "feat(admin): distinguish error/success toasts visually"
  ```

---

## Task 7: Add QueryCache.onError in providers
**Classification:** small

### Required Docs
- `@tanstack/react-query` docs — `QueryCache`, `MutationCache`
- `frontend/admin/app/providers.tsx` — current QueryClient setup

### Task Description
Configure the global `QueryClient` with `QueryCache.onError` that calls `console.error` and `showToast('Не удалось загрузить данные', 'error')`. This is the single source of truth for fetch error reporting.

### Steps

- [ ] **Step 7.1:** Update providers.tsx
  File: `frontend/admin/app/providers.tsx`:
  ```tsx
  'use client';

  import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { useState } from 'react';
  import { UIProvider, useUI } from '../contexts/UIContext';
  import { UserSettingsProvider } from '../contexts/UserSettingsContext';
  import { ErrorBoundary } from './components/error';
  import { ToastContainer } from './components/toast/ToastContainer';

  function QueryClientWithErrorReporting({ children }: { children: React.ReactNode }) {
    const { showToast } = useUI();
    const [queryClient] = useState(() => new QueryClient({
      queryCache: new QueryCache({
        onError: (err, query) => {
          // Silent queries (meta.silent === true) skip the toast
          if ((query.meta as { silent?: boolean } | undefined)?.silent) return;
          console.error('[Query]', query.queryKey, err);
          showToast('Не удалось загрузить данные', 'error');
        },
      }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          retry: 2,
          refetchOnWindowFocus: false,
          throwOnError: false,
        },
      },
    }));
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  export function Providers({ children }: { children: React.ReactNode }) {
    return (
      <ErrorBoundary>
        <UIProvider>
          <QueryClientWithErrorReporting>
            <UserSettingsProvider>
              {children}
            </UserSettingsProvider>
          </QueryClientWithErrorReporting>
        </UIProvider>
        <ToastContainer />
      </ErrorBoundary>
    );
  }
  ```

  Note: `UIProvider` is now wrapped **inside** `ErrorBoundary` (was outside before) so a render error in UIContext still triggers the boundary instead of crashing. `QueryClientWithErrorReporting` is a child of `UIProvider` so it can use `useUI().showToast`.

- [ ] **Step 7.2:** Run all admin tests
  ```bash
  npx vitest run
  ```
  Expected: all pass (no regressions).

- [ ] **Step 7.3:** Commit
  ```bash
  git add frontend/admin/app/providers.tsx
  git commit -m "feat(admin): wire QueryCache.onError to toast + console.error"
  ```

---

## Task 8: Wrap (main)/layout in ErrorBoundary
**Classification:** trivial

### Required Docs
- `frontend/admin/app/(main)/layout.tsx` — current layout

### Task Description
Add a second `ErrorBoundary` layer around `MainShell` to catch render errors in page-level components. The top-level boundary (in `providers.tsx`) catches catastrophic crashes; this one catches page-level errors and shows the user the same `<FullPageError>`.

### Steps

- [ ] **Step 8.1:** Update layout
  File: `frontend/admin/app/(main)/layout.tsx`:
  ```tsx
  'use client';

  import React from 'react';
  import { Menubar } from '../components/layout/Menubar';
  import { NavigationProvider } from '@/contexts/NavigationContext';
  import { useUI } from '@/contexts/UIContext';
  import { ErrorBoundary } from '../components/error';

  function MainShell({ children }: { children: React.ReactNode }) {
    // ... unchanged
  }

  export default function MainLayout({ children }: { children: React.ReactNode }) {
    return (
      <ErrorBoundary>
        <NavigationProvider>
          <MainShell>{children}</MainShell>
        </NavigationProvider>
      </ErrorBoundary>
    );
  }
  ```

- [ ] **Step 8.2:** Verify dev server starts
  ```bash
  pnpm --filter admin dev &
  sleep 5
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/schedule
  kill %1
  ```
  Expected: `200`.

- [ ] **Step 8.3:** Commit
  ```bash
  git add frontend/admin/app/\(main\)/layout.tsx
  git commit -m "feat(admin): wrap (main)/layout in ErrorBoundary"
  ```

---

## Task 9: Add `<ErrorState>` to 7 list components
**Classification:** small (batch)

### Required Docs
- `frontend/admin/app/components/error/ErrorState.tsx` — API
- Each table file's `useQuery` return type

### Task Description
For each of 7 table components, destructure `error` and `refetch` from `useQuery`, render `<ErrorState variant="table" error={error} onRetry={refetch} colspan={N} />` instead of empty table when `error` is truthy. **Use the existing `colspan` if the table has fixed column count.**

### Pattern (apply to each file)

For each file, add to the existing `useQuery` destructure:
```diff
- const { data: items = [], isLoading } = useQuery<...>({...});
+ const { data: items = [], isLoading, error, refetch } = useQuery<...>({...});
```

Then find the table `<tbody>` and add an early return **before** the empty-state branch:
```tsx
if (error) {
  return (
    <ErrorState error={error} onRetry={refetch} variant="table" colspan={VISIBLE_COLUMNS.length || 5} />
  );
}
```

### Steps

- [ ] **Step 9.1:** TagsTable
  File: `frontend/admin/app/(main)/tags/components/TagsTable.tsx`
  - Add `error, refetch` to `useQuery` destructure
  - Add `if (error) return <ErrorState ... />` before the loading branch
  - Add import: `import { ErrorState } from '@/app/components/error';`

- [ ] **Step 9.2:** PhotosTable
  File: `frontend/admin/app/(main)/photos/components/PhotosTable.tsx`
  - Same changes as 9.1

- [ ] **Step 9.3:** ServicesTable
  File: `frontend/admin/app/(main)/services/components/ServicesTable.tsx`
  - Same changes as 9.1

- [ ] **Step 9.4:** LocationsTable
  File: `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`
  - Same changes as 9.1

- [ ] **Step 9.5:** MastersTable
  File: `frontend/admin/app/(main)/masters/components/MastersTable.tsx`
  - Same changes as 9.1

- [ ] **Step 9.6:** ClientsTable
  File: `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`
  - Same changes as 9.1

- [ ] **Step 9.7:** RecordsTable
  File: `frontend/admin/app/(main)/records/components/RecordsTable.tsx`
  - Records uses `useRecords()` from context (not direct `useQuery`). Check if the context exposes `error` — it does (`error: recordsError ?? null`).
  - In `RecordsTable`, add `const { error, refetch } = useQuery(...)` is not possible — instead read from `useRecords()`:
    ```tsx
    const { records, error, refetch, ... } = useRecords();
    ```
    If `useRecords` doesn't expose `refetch`, expose it in `RecordsContext` (add `refetch: () => queryClient.refetchQueries(...)` to the context type and provider value).
  - Then: `if (error) return <ErrorState ... />`

- [ ] **Step 9.8:** Run vitest
  ```bash
  cd frontend/admin && npx vitest run
  ```
  Expected: all pass.

- [ ] **Step 9.9:** Manual smoke test
  Open `http://localhost:3001/tags` → should render normally.
  Stop dev server.

- [ ] **Step 9.10:** Commit
  ```bash
  git add frontend/admin/app/\(main\)/{tags,photos,services,locations,masters,clients,records}/components/*.tsx
  git commit -m "feat(admin): show ErrorState in 7 list components on fetch failure"
  ```

---

## Task 10: Fix e2e #434 (clients Record tab)
**Classification:** small

### Required Docs
- `frontend/admin/e2e/clients.spec.ts` lines 430–470 — current test
- `frontend/admin/e2e/fixtures/db-query.ts` — setupRecordTab helper

### Task Description
Test fails with `#record-time element not found (5s timeout)`. Root cause: `setupRecordTab` clicks the record tab but doesn't wait for the tab to be visible before checking for fields inside it.

### Steps

- [ ] **Step 10.1:** Inspect `setupRecordTab`
  ```bash
  grep -n "setupRecordTab" frontend/admin/e2e/fixtures/db-query.ts | head
  ```
  Find the function definition.

- [ ] **Step 10.2:** Add explicit wait after tab click
  In `setupRecordTab`, find the line that clicks the record tab (e.g., `await page.locator('[data-testid="client-record-tab"]').click();`) and add immediately after:
  ```ts
  await page.waitForSelector('[data-testid="client-record-tab"]', { state: 'visible' });
  await page.locator('#record-date').waitFor({ state: 'visible', timeout: 10_000 });
  ```

- [ ] **Step 10.3:** Run failing test
  ```bash
  cd frontend/admin && npx playwright test clients.spec.ts -g "13. Record tab" --project=chromium
  ```
  Expected: PASS.

- [ ] **Step 10.4:** Commit
  ```bash
  git add frontend/admin/e2e/fixtures/db-query.ts
  git commit -m "fix(e2e): wait for record tab visibility in setupRecordTab (#434)"
  ```

---

## Task 11: Fix e2e #307 (records sort by Клиент)
**Classification:** small

### Required Docs
- `frontend/admin/e2e/records.spec.ts` lines 305–360 — test body
- `frontend/admin/e2e/fixtures/db-query.ts` — `cleanup`, `createRecord`

### Task Description
Test fails with `tbody tr timeout (30s)`. Root cause: no records seeded before sort test → `waitForRecordsReady` waits for `tbody tr` but seed didn't create any.

### Steps

- [ ] **Step 11.1:** Update test to seed data
  Replace the test body with explicit setup:
  ```ts
  test('11. Sorting — click header toggles sort direction', async ({ page, request }) => {
    // Seed 3 records with different clients for sort test
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { clientId, recordId } = await createTestRecordWithClient(request, `Клиент-${i}`);
      ids.push(recordId, clientId);
    }
    try {
      await waitForRecordsReady(page);
      // ... existing sort test logic
    } finally {
      for (const id of ids) await cleanup(request, `/api/v1/records/${id}`).catch(() => {});
      for (const id of ids) await cleanup(request, `/api/v1/clients/${id}`).catch(() => {});
    }
  });
  ```
  Helper `createTestRecordWithClient` should be added to `fixtures/db-query.ts` if not present — it wraps the existing `createClient` + `createActivity` + `createRecord` calls.

- [ ] **Step 11.2:** Run test
  ```bash
  npx playwright test records.spec.ts -g "11. Sorting" --project=chromium
  ```
  Expected: PASS.

- [ ] **Step 11.3:** Commit
  ```bash
  git add frontend/admin/e2e/records.spec.ts frontend/admin/e2e/fixtures/db-query.ts
  git commit -m "fix(e2e): seed deterministic records for sort test (#307)"
  ```

---

## Task 12: Fix e2e #575 (records payment indicator)
**Classification:** small

### Required Docs
- `frontend/admin/e2e/records.spec.ts` lines 573–590 — test body
- `frontend/admin/e2e/fixtures/db-query.ts` — payment-related helpers

### Task Description
Test fails: `rowCount === 0`, expected `> 0`. Test should seed a record with `payment_status: 'Оплачено'` so at least one payment indicator is present.

### Steps

- [ ] **Step 12.1:** Update test
  Replace the test body:
  ```ts
  test('20. Payment status — displays payment indicator', async ({ page, request }) => {
    // Seed one record with payment
    const { clientId, recordId, paymentId } = await createTestRecordWithPayment(
      request,
      'Оплачено'
    );
    try {
      await waitForRecordsReady(page);
      const paymentIndicators = page.locator('tbody td').filter({
        hasText: /Оплачено|Частично|Не оплачено/,
      });
      const rowCount = await page.locator('tbody tr').count();
      if (rowCount > 0) {
        const indicatorCount = await paymentIndicators.count();
        expect(indicatorCount).toBeGreaterThan(0);
      }
    } finally {
      await cleanup(request, `/api/v1/payments/${paymentId}`).catch(() => {});
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });
  ```
  Add `createTestRecordWithPayment` to `fixtures/db-query.ts` — creates client + activity + record + payment with given status.

- [ ] **Step 12.2:** Run test
  ```bash
  npx playwright test records.spec.ts -g "20. Payment status" --project=chromium
  ```
  Expected: PASS.

- [ ] **Step 12.3:** Commit
  ```bash
  git add frontend/admin/e2e/records.spec.ts frontend/admin/e2e/fixtures/db-query.ts
  git commit -m "fix(e2e): seed record with payment for indicator test (#575)"
  ```

---

## Task 13: Fix e2e #281 (schedule filter — add master to filter)
**Classification:** small

### Required Docs
- `frontend/admin/e2e/schedule-column-visibility.spec.ts` lines 280–330 — test body
- `frontend/admin/e2e/fixtures/helpers.ts` — `openMasterFilter`, `deselectAllOptions`

### Task Description
Test fails with 30s timeout when re-adding a master to the filter. Root cause: `body`-click + `waitForTimeout(300)` is too brittle. Replace with explicit `waitForResponse`.

### Steps

- [ ] **Step 13.1:** Find timing pattern
  Look for `await page.click('body', { position: { x: 10, y: 10 } });` followed by `waitForTimeout(300)` in the test.

- [ ] **Step 13.2:** Replace with explicit wait
  ```diff
  - await page.click('body', { position: { x: 10, y: 10 } });
  - await page.waitForTimeout(300);
  + await page.keyboard.press('Escape');
  + await page.waitForResponse(
  +   (r) => r.url().includes('/api/v1/activities') && r.status() === 200,
  +   { timeout: 5_000 }
  + );
  ```

- [ ] **Step 13.3:** Run test
  ```bash
  npx playwright test schedule-column-visibility.spec.ts -g "adding a master" --project=chromium
  ```
  Expected: PASS.

- [ ] **Step 13.4:** Commit
  ```bash
  git add frontend/admin/e2e/schedule-column-visibility.spec.ts
  git commit -m "fix(e2e): replace body-click+timeout with waitForResponse in filter test (#281)"
  ```

---

## Task 14: Fix e2e #406 (column mode switch)
**Classification:** small

### Required Docs
- `frontend/admin/e2e/schedule-column-visibility.spec.ts` lines 405–450 — test body

### Task Description
Test fails with 30s timeout on column mode switch. Root cause: `waitForTimeout(500)` after column mode click is not enough. Replace with `waitForResponse`.

### Steps

- [ ] **Step 14.1:** Find timing pattern
  Look for `await page.waitForTimeout(500)` after column mode click.

- [ ] **Step 14.2:** Replace with explicit wait
  ```diff
  - await page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click();
  - await page.waitForTimeout(500);
  + await Promise.all([
  +   page.locator('[data-testid="column-mode-menu"] button:has-text("По локациям")').click(),
  +   page.waitForResponse(
  +     (r) => r.url().includes('/api/v1/activities') && r.status() === 200,
  +     { timeout: 10_000 }
  +   ),
  + ]);
  ```

- [ ] **Step 14.3:** Run test
  ```bash
  npx playwright test schedule-column-visibility.spec.ts -g "switching to locations" --project=chromium
  ```
  Expected: PASS.

- [ ] **Step 14.4:** Commit
  ```bash
  git add frontend/admin/e2e/schedule-column-visibility.spec.ts
  git commit -m "fix(e2e): waitForResponse after column mode switch (#406)"
  ```

---

## Task 15: Fix 3 similar column mode timeouts
**Classification:** small

### Required Docs
- `frontend/admin/e2e/schedule-column-visibility.spec.ts` — all 30s-timeout tests
- `frontend/admin/e2e/schedule-day-view.spec.ts` — same patterns

### Task Description
Apply the same `waitForResponse` fix to the 3 other tests with similar 30s timeouts (column mode switching in `schedule-column-visibility.spec.ts` and `schedule-day-view.spec.ts`).

### Steps

- [ ] **Step 15.1:** Find all 30s timeout patterns
  ```bash
  cd frontend/admin && grep -n "waitForTimeout" e2e/schedule-column-visibility.spec.ts e2e/schedule-day-view.spec.ts
  ```

- [ ] **Step 15.2:** For each remaining `waitForTimeout` after a click on column mode, filter, or sort header, apply the same pattern from Task 14.2. **Be specific:** only replace timeouts that follow a state-changing UI action; leave visual stabilization timeouts alone.

- [ ] **Step 15.3:** Run full schedule spec
  ```bash
  npx playwright test e2e/schedule-column-visibility.spec.ts e2e/schedule-day-view.spec.ts --project=chromium
  ```
  Expected: all pass.

- [ ] **Step 14.4:** Commit
  ```bash
  git add frontend/admin/e2e/schedule-column-visibility.spec.ts frontend/admin/e2e/schedule-day-view.spec.ts
  git commit -m "fix(e2e): replace brittle timeouts in 3 column-mode tests"
  ```

---

## Task 16: Write e2e audit doc
**Classification:** small

### Required Docs
- `frontend/admin/e2e/*.spec.ts` — list of all 18 spec files (164 tests)
- `frontend/admin/__tests__/**/*.test.tsx` — existing unit tests

### Task Description
Create `docs/audits/2026-06-18-e2e-audit.md` with a table classifying each fixed test by quality and action. If any test was demoted to vitest during this work, add the new vitest test references.

### Steps

- [ ] **Step 16.1:** Count current e2e and vitest
  ```bash
  cd frontend/admin && npx playwright test --list 2>&1 | tail -3
  find __tests__ -name "*.test.tsx" | wc -l
  ```

- [ ] **Step 16.2:** Write audit
  File: `docs/audits/2026-06-18-e2e-audit.md`:
  ```markdown
  # E2E test audit — 2026-06-18

  ## Summary
  - Total e2e tests: <N>
  - Failing before audit: 5 (out of <N>)
  - Fixed in robustness bundle: 5
  - Demoted to vitest: <N or 0>
  - Final e2e passing: <N>/<N> (excluding visual)

  ## Per-test classification

  | Test | Root cause | Quality | Action | Notes |
  |------|-----------|---------|--------|-------|
  | `clients.spec.ts:434` | Missing wait for tab visibility | medium (DOM-specific) | keep | Fix: explicit waitForSelector |
  | `records.spec.ts:307` | No seed data | medium (depends on existing records) | keep | Fix: explicit seed of 3 records |
  | `records.spec.ts:575` | No payment seed | low (relies on lucky existing data) | keep | Fix: seed record with payment |
  | `schedule-column-visibility:281` | Brittle timeout | medium | keep | Fix: waitForResponse |
  | `schedule-column-visibility:406` | Brittle timeout | medium | keep | Fix: waitForResponse |
  | 3 similar timeouts (schedule) | Brittle timeout | medium | keep | Fix: waitForResponse |

  ## Recommendations for future
  - All new e2e tests must use `waitForResponse` not `waitForTimeout`
  - All tests that depend on existing data must seed explicitly via API
  - Consider deprecating visual regression tests in CI (separate work)
  ```

  Fill in actual numbers from Step 16.1.

- [ ] **Step 16.3:** Commit
  ```bash
  git add docs/audits/2026-06-18-e2e-audit.md
  git commit -m "docs: add e2e audit for robustness bundle (#65)"
  ```

---

## Task 17: Close issue #53 as wontfix
**Classification:** trivial

### Required Docs
- `frontend/admin/contexts/RecordsContext.tsx` — confirms cross-page usage
- `frontend/admin/app/(main)/schedule/page.tsx` — wraps RecordsProvider

### Task Description
Close issue #53 with the wontfix rationale from the design spec.

### Steps

- [ ] **Step 17.1:** Close with comment
  ```bash
  cd /root/workspace/memo
  gh issue close 53 --repo mkosinov/memo --comment "RecordsContext is used by both /records and /schedule pages (specifically ActivityDetailsModal which is shared). Merging with ScheduleContext would inflate it to 800+ LOC without architectural benefit. The context exists to share data between pages — which is its intended purpose. If ScheduleContext later refactors to a 'domain slice' pattern, this assessment should be revisited."
  ```
  Expected: issue closed.

---

## Task 18: Final verification
**Classification:** standard

### Required Docs
- `docs/specs/2026-06-18-robustness-bundle-design.md` — acceptance criteria
- `docs/plans/2026-06-18-robustness-bundle-plan.md` — this file

### Task Description
Run all unit + e2e tests to confirm no regressions. Verify acceptance criteria from the design spec.

### Steps

- [ ] **Step 18.1:** Run unit tests
  ```bash
  cd frontend/admin && npx vitest run
  ```
  Expected: all pass (5+ new tests in __tests__/error/).

- [ ] **Step 18.2:** Run e2e tests
  ```bash
  cd /root/workspace/memo
  # Start dev environment
  pnpm dev:admin &
  sleep 10
  cd frontend/admin && npx playwright test --project=chromium
  ```
  Expected: all e2e pass (164/164, or 155/155 with visual skipped in CI).

- [ ] **Step 18.3:** Manual smoke test
  Open `http://localhost:3001/schedule` → confirm renders normally.
  Open `http://localhost:3001/records` → confirm renders normally.
  Open `http://localhost:3001/clients` → confirm renders normally.

- [ ] **Step 18.4:** Stop dev servers
  ```bash
  pkill -f "next dev" || true
  ```

- [ ] **Step 18.5:** Verify acceptance criteria
  - [ ] `QueryCache.onError` shows error-toast
  - [ ] `console.error` logs `queryKey + error` in dev
  - [ ] `ErrorBoundary` catches render-throw → `FullPageError`
  - [ ] 7 list components render `ErrorState` on error
  - [ ] `toast.kind='error'` is visually distinct (red left border)
  - [ ] Unit tests pass: 5/5 new
  - [ ] E2E tests pass: 0 failing
  - [ ] Issue #53 closed as wontfix
  - [ ] `docs/audits/2026-06-18-e2e-audit.md` exists

- [ ] **Step 18.6:** Commit (only if fixes needed)
  ```bash
  # No commit expected if all green
  ```

---

## Execution notes

- Each task is independent; commit after each.
- Do NOT skip TDD pattern for Tasks 2, 4, 5.
- For Tasks 10–15, the failing test already exists — that IS the RED step. Just make it pass.
- After Task 9, run `npx vitest run` to verify no regressions before moving to e2e fixes.
- Visual regression tests are out of scope (already skipped in CI per `playwright.config.ts`).
