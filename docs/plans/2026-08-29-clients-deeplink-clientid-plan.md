# Clients `?clientId=` Deep-Link Fix Implementation Plan (GH #216)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/clients?clientId={id}` open ClientCardModal for ANY client (page 2+, archived) by narrowing the table via the server `?q=` exact-UUID match — frontend-only fix, zero backend production change.

**Architecture:** A deep-link effect in `page.tsx` calls `setFilters({search: id, status: 'all'})` → the existing server search narrows the list to ≤1 row on page 1 → the existing find-effect opens the modal from the row. The search input in `ClientsFilters` becomes controlled (render-adjust + dirty-tracking) so the UUID is visible to the user. Backend gets only premise-guard contract tests (the `?q=` exact-id match already shipped in #212).

**Tech Stack:** Next.js 14 App Router (frontend/admin), React Query v5, vitest + @testing-library/react (fake timers), Playwright (e2e), FastAPI + pytest (backend contract tests only).

**Spec:** `docs/specs/2026-08-29-clients-deeplink-clientid-design.md` (approved at G1b, commit d1cd274).

**Worktree:** `/root/workspace/worktrees/clients-deeplink-216`, branch `feat/clients-deeplink-216`. Fresh worktree needs `uv sync --extra dev` in `backend/` before pytest. CI POLICY: local test runs only (GH Actions quota exhausted until 2026-09-01) — never gate on CI.

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Deep-link opens any client's card** → Clicking a client link (from the activity modal on /schedule) opens `/clients?clientId=…` in a new tab and the ClientCardModal appears within seconds — even if that client sits on page 2+ of the alphabetically sorted list or is archived. The table behind the modal is narrowed to exactly that one row.
- **The user sees why the table is narrowed** → The search box visibly contains the client's UUID; the status filter visibly shows «Все». Nothing hidden.
- **No auto-clear on close (concept point 4)** → Closing the modal (×, backdrop, Esc) leaves the table narrowed to the one row with the UUID still in the search box; the URL param is stripped. The user clears the search manually when done.
- **Dead links self-heal** → A link to a deleted client shows the standard «Нет записей» empty state; the URL param is stripped so a refresh returns the normal full list (no narrowing loop).
- **Search typing unchanged** → Typing in the search box keeps today's 300ms debounce behavior. «Сбросить фильтры» now also clears the search box immediately — and wins over an in-flight debounce (previously the box kept a stale string and could re-apply it).
- **Acceptance anchor** → The long-red e2e `unify-caches.spec.ts:408` (US-6) turns GREEN with no test edit.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/tests/test_client_stats.py` | modify (append 2 tests) | Premise-guard contract tests: `status=all`+UUID→archived row; uppercase UUID |
| `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx` | modify | Controlled search input: render-adjust sync, cancellable debounce, dirty-tracking |
| `frontend/admin/__tests__/ClientsFilters.test.tsx` | modify (append describe block) | Unit tests for the controlled input (fake timers) |
| `frontend/admin/app/(main)/clients/page.tsx` | modify | Deep-link effect + dead-link param cleanup |
| `frontend/admin/__tests__/ClientsPage.test.tsx` | modify | Unit tests for the deep-link effect (parameterized searchParams mock) |
| `frontend/admin/e2e/clients.spec.ts` | modify (append describe) | Deterministic page-2+ regression e2e incl. post-close contract |
| `docs/domain-rules/clients.md` | modify (1 bullet) | Deep-link contract documentation |

No new files at all — every touched file is modified in place. No backend production code. No api-client changes.

---

## Task 1: Backend premise-guard contract tests

### Classification: small

### Required Docs
- `docs/specs/2026-08-29-clients-deeplink-clientid-design.md` — §3 (re-grounding evidence), §5.4 (why zero backend code), §7 T1
- `docs/domain-rules/clients.md` — "List `?q=`" section (q semantics, status=all) and "Phone lookup" (separate path)
- `.opencode/skills/pytest-patterns/SKILL.md` — test conventions

### Task Description

These tests pin ALREADY-SHIPPED behavior (#212). They are a premise guard: they must pass IMMEDIATELY. If either fails, the spec's "zero backend production change" premise is wrong → report **BLOCKED** with the failing output. Do NOT write any backend implementation code in this task.

**TDD note:** this task intentionally has no RED phase — the code under contract exists on main (verified at `search.py:31-54`, `services/client.py:158-172`). RED here means premise failure, not work to do.

Steps:

- [ ] In `backend/tests/test_client_stats.py`, inside class `TestClientListQContract` (starts ~line 338; NOTE it does NOT end at the archived test — it continues with `test_q_with_stats_filter_combined` (~:416) and `test_old_search_param_is_ignored` (~:432), ending ~line 445). Append these two tests at the END of the class, verbatim:

```python
    def test_status_all_uuid_q_returns_archived_client_single_row(
        self, api_client, create_client
    ) -> None:
        """GH #216 deep-link combo: status=all + full UUID q → the archived
        target is the single row (id exact-match narrows; status floor lifted)."""
        target = create_client(name="DeeplinkArch Probe", phone="+79992100031")
        create_client(name="DeeplinkArch Decoy", phone="+79992100032")
        archive_resp = api_client.post(f"/api/v1/clients/{target['id']}/archive")
        assert archive_resp.status_code == 200

        resp = api_client.get(
            "/api/v1/clients", params={"q": target["id"], "status": "all"}
        )
        body = resp.json()
        assert [c["id"] for c in body["items"]] == [target["id"]]
        assert body["total"] == 1

    def test_uppercase_uuid_q_normalized_api_match(
        self, api_client, create_client
    ) -> None:
        """GH #216: pasted uppercase UUID still matches at the clients API
        level (lowercase normalization — mirrors unit/repo-level tests)."""
        probe = create_client(name="UuidUpperProbe", phone="+79992100033")

        resp = api_client.get("/api/v1/clients", params={"q": probe["id"].upper()})
        body = resp.json()
        assert [c["id"] for c in body["items"]] == [probe["id"]]
        assert body["total"] == 1
```

- [ ] Run: `cd backend && uv run pytest tests/test_client_stats.py::TestClientListQContract -q`
  - Expected: all pass (existing count + 2 new). Any failure → **BLOCKED** report, no code changes.
- [ ] Commit: `git commit -am "test(#216): clients API premise guards — status=all+UUID archived row, uppercase UUID normalization"`

---

## Task 2: ClientsFilters — controlled search input

### Classification: standard

### Required Docs
- `docs/specs/2026-08-29-clients-deeplink-clientid-design.md` — §5.3 (pattern contract), §5.5 E-cases, §7 T2
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — component unit test conventions, fake timers

### Task Description

Convert the uncontrolled debounced search input into a controlled input that (a) displays external `filters.search` commits (deep-link UUID pre-fill, reset), (b) preserves user's typed-ahead draft when our own debounced commit lands, (c) never lets a stale debounce timer resurrect a cleared/reset value.

**Spec §5.3 refinement (pinned here):** the spec's `pendingRef`-comparison sketch is replaced by **dirty-tracking** — it kills the type→reset race and the type-ahead-commit race the panel flagged (F1/F2), with less state:

- `dirtyRef` = true on every keystroke, false when our debounced send fires.
- Render-adjust during render (react.dev pattern, no `useEffect`): when `filters.search` changed since last render AND `!dirtyRef.current` → sync `draft` + cancel any timer (true external change: deep-link, reset, future programmatic). When `dirtyRef.current` → keep draft (our armed send is authoritative and will supersede).
- The «Сбросить фильтры» button lives in THIS component — it handles the race locally: cancel timer → clear draft → `resetFilters()`. Race-free by construction.

Steps:

- [ ] RED: `frontend/admin/__tests__/ClientsFilters.test.tsx` **already exists** (26 tests — status select, range inputs, debounce regressions; do NOT touch or replace them). Append ONLY the new `describe` block below to the END of the file, with these mandatory adaptations: **(a)** STRIP the sketch's header — its `import` lines, `vi.mock('@/contexts/ClientsContext')`, and `mockUseClients` are already declared at the top of the existing file (duplicate declarations = SyntaxError); keep only imports the existing file lacks (e.g. `act`); **(b)** the sketch's local `mockFiltersContext` helper stays local to the describe (renamed on purpose to avoid colliding with the file's existing helpers) — adapt its return shape if the file's `useClients` mock typing requires the full context shape:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { useClients } from '@/contexts/ClientsContext';
import { ClientsFilters } from '../app/(main)/clients/components/ClientsFilters';

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
}));

const mockUseClients = vi.mocked(useClients);

function mockFiltersContext(overrides: Partial<{ search: string; status: string }> = {}) {
  const ctx = {
    filters: { search: overrides.search ?? '', status: overrides.status ?? 'active' },
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
  };
  mockUseClients.mockReturnValue(ctx as ReturnType<typeof useClients>);
  return ctx;
}

describe('ClientsFilters — controlled search input (GH #216)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const searchInput = () => screen.getByPlaceholderText(/Поиск по имени или телефону/);

  it('displays an externally committed search value (deep-link UUID pre-fill)', () => {
    mockFiltersContext({ search: '11111111-2222-3333-4444-555555555555' });
    render(<ClientsFilters />);
    expect(searchInput()).toHaveValue('11111111-2222-3333-4444-555555555555');
  });

  it('typing updates the draft immediately and commits once after 300ms', () => {
    const ctx = mockFiltersContext();
    render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'иван' } });
    expect(searchInput()).toHaveValue('иван');
    expect(ctx.setFilters).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(ctx.setFilters).toHaveBeenCalledWith({ search: 'иван' });
  });

  it('each keystroke restarts the timer (debounce), single commit with final value', () => {
    const ctx = mockFiltersContext();
    render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'ив' } });
    act(() => { vi.advanceTimersByTime(250); });
    fireEvent.change(searchInput(), { target: { value: 'иван' } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(ctx.setFilters).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(250); });
    expect(ctx.setFilters).toHaveBeenCalledTimes(1);
    expect(ctx.setFilters).toHaveBeenCalledWith({ search: 'иван' });
  });

  it('type → «Сбросить фильтры» within 300ms: reset wins, timer cancelled, box cleared', () => {
    const ctx = mockFiltersContext();
    render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'а' } });
    fireEvent.click(screen.getByText('Сбросить фильтры'));
    expect(ctx.resetFilters).toHaveBeenCalled();
    expect(searchInput()).toHaveValue('');
    act(() => { vi.advanceTimersByTime(400); });
    expect(ctx.setFilters).not.toHaveBeenCalledWith({ search: 'а' });
  });

  it('external commit while user typed ahead keeps the draft (no clobber)', () => {
    const ctx = mockFiltersContext();
    const { rerender } = render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'ив' } });
    // an older commit lands (e.g. previous debounce fired) — draft must survive
    mockFiltersContext({ search: 'чужое' });
    rerender(<ClientsFilters />);
    expect(searchInput()).toHaveValue('ив');
    act(() => { vi.advanceTimersByTime(300); });
    expect(ctx.setFilters).toHaveBeenCalledWith({ search: 'ив' });
  });

  it('status select is controlled by filters.status', () => {
    mockFiltersContext({ status: 'all' });
    render(<ClientsFilters />);
    expect(screen.getByDisplayValue('Все')).toBeInTheDocument();
  });
});
```

- [ ] Run: `cd frontend/admin && npx vitest run __tests__/ClientsFilters.test.tsx`
  - Expected RED: `toHaveValue` fails (input is uncontrolled — displays external value fails), reset-clears-box fails, others may pass incidentally.
- [ ] GREEN: rewrite `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx`. Full new file:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useClients } from '@/contexts/ClientsContext';
import type { ClientFilters } from '@/contexts/ClientsContext';

function useDebouncedCallback(
  callback: (value: string) => void,
  delay: number,
): { debounced: (value: string) => void; cancel: () => void } {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useCallback(
    (value: string) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => callback(value), delay);
    },
    [callback, delay],
  );

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // GH #216: no setState-after-unmount from an armed timer
  useEffect(() => cancel, [cancel]);

  return { debounced, cancel };
}

export function ClientsFilters() {
  const { filters, setFilters, resetFilters } = useClients();
  // dirtyRef is declared BEFORE the debounce hook that closes over it
  const dirtyRef = useRef(false);
  const { debounced: debouncedSearch, cancel: cancelSearch } = useDebouncedCallback(
    (value: string) => {
      dirtyRef.current = false; // our send fired — the landing commit is expected
      setFilters({ search: value });
    },
    300,
  );

  // GH #216: controlled search input. Render-adjust pattern (react.dev
  // "adjust state during render", no effect): when the committed search
  // changes externally (deep-link ?clientId= pre-fill, reset) and the user
  // has NOT typed since our last send, sync the draft and cancel any armed
  // timer. If the user typed ahead (dirty), the armed send is authoritative.
  const [prevCommitted, setPrevCommitted] = useState(filters.search);
  const [draft, setDraft] = useState(filters.search);

  if (filters.search !== prevCommitted) {
    setPrevCommitted(filters.search);
    if (!dirtyRef.current) {
      setDraft(filters.search);
      cancelSearch();
    }
  }

  const handleReset = useCallback(() => {
    cancelSearch();
    dirtyRef.current = false;
    setDraft('');
    resetFilters();
  }, [cancelSearch, resetFilters]);

  const inputClass = 'rounded-lg border px-2 py-1.5 text-xs';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="🔍 Поиск по имени или телефону"
        className={`w-full ${inputClass}`}
        style={inputStyle}
        value={draft}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(value);
          dirtyRef.current = true;
          debouncedSearch(value);
        }}
      />
      <div className="flex flex-wrap gap-4">
        {/* … Статус / Записи / Пропущенные / Создан / Оплата blocks and the
            reset button: UNCHANGED from the current file — copy them verbatim,
            with one edit: the reset button onClick={handleReset} */}
      </div>
    </div>
  );
}
```

  - The `…` comment above marks the five filter `<div>` blocks (Статус, Записи, Пропущенные, Создан, Оплата) — copy them **verbatim** from the current file; the only change in them is nothing. The reset button becomes:
```tsx
      <button onClick={handleReset} className="text-xs text-brand hover:underline">
        Сбросить фильтры
      </button>
```
  - (The debounce callback and `dirtyRef` ordering in the block above are FINAL — no further edits to them.)

- [ ] Run: `cd frontend/admin && npx vitest run __tests__/ClientsFilters.test.tsx` → all 6 pass.
- [ ] Regression: `cd frontend/admin && npx vitest run __tests__/ClientsPage.test.tsx` → still green (ClientsFilters is mocked there; unaffected).
- [ ] Commit: `git commit -am "feat(#216): ClientsFilters controlled search input — external sync, cancellable debounce, reset race fix"`

---

## Task 3: page.tsx — deep-link effect + dead-link cleanup

### Classification: standard

### Required Docs
- `docs/specs/2026-08-29-clients-deeplink-clientid-design.md` — §5.1 (effect contract incl. no-match cleanup), §5.5 E-cases, §7 T3
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — component unit test conventions

### Task Description

Add the deep-link narrowing effect and the dead-link param cleanup to `ClientsPageContent`. The existing find-effect (lines 22-30) and the modal close handler stay **unchanged**.

Steps:

- [ ] RED: in `frontend/admin/__tests__/ClientsPage.test.tsx` make the navigation mock parameterizable. Replace the current mock (lines ~21-24):

```tsx
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
```

  with hoisted shared mocks:

```tsx
const mockRouter = { push: vi.fn(), replace: vi.fn() };
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => mockRouter,
}));
```

  and in the existing `beforeEach` add resets:

```tsx
    mockSearchParams = new URLSearchParams();
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
```

- [ ] Append this describe block (reuses existing `createMockClientsContext` + `createQueryClient` helpers from the file):

```tsx
describe('ClientsPage — ?clientId= deep-link (GH #216)', () => {
  it('deep-link param narrows the table: setFilters({search: id, status: all})', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'uuid-target-1']]);
    const ctx = createMockClientsContext({ items: [], clients: [] });
    mockUseClients.mockReturnValue(ctx);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(ctx.setFilters).toHaveBeenCalledWith({ search: 'uuid-target-1', status: 'all' }),
    );
  });

  it('no param: deep-link setFilters not called', async () => {
    const ctx = createMockClientsContext({ total: 25, page: 1, perPage: 20 });
    mockUseClients.mockReturnValue(ctx);

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(ctx.setFilters).not.toHaveBeenCalled();
  });

  it('find-effect opens the modal when the narrowed row arrives', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'c-deep-1']]);
    const target = { id: 'c-deep-1', name: 'Deep Target', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(
      createMockClientsContext({ items: [target], clients: [target] }),
    );

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    // Reuse the assertion idiom the existing create-mode modal tests use.
    await waitFor(() => {
      expect(screen.getByTestId('client-card-modal')).toBeInTheDocument();
    });
  });

  it('row not in items: modal stays closed (negative find branch)', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'c-missing']]);
    const other = { id: 'c-other', name: 'Other', archived: false } as ClientWithStats;
    mockUseClients.mockReturnValue(
      createMockClientsContext({ items: [other], clients: [other] }),
    );

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Клиенты')).toBeInTheDocument());
    expect(screen.queryByTestId('client-card-modal')).not.toBeInTheDocument();
  });

  it('dead link: settled empty list strips the param from the URL', async () => {
    mockSearchParams = new URLSearchParams([['clientId', 'c-gone']]);
    mockUseClients.mockReturnValue(
      createMockClientsContext({ items: [], clients: [], isPending: false, isFetching: false }),
    );

    const ClientsPage = (await import('../app/(main)/clients/page')).default;
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ClientsPage />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith('/clients', { scroll: false }),
    );
  });
});
```

  - Check `createMockClientsContext` (in `__tests__/helpers/mockContexts.ts`) accepts `items`/`clients`/`isPending`/`isFetching` overrides — the helper exposes them (per #139 grounding). If a key is not overridable, extend the helper minimally (test-infra change, allowed).
  - If the real `ClientCardModal` renders additional required providers under these mocks, follow whatever the existing create-mode modal tests in this file already do (they open the real modal under the same mocks — match their idiom for the modal-open assertion).

- [ ] Run: `cd frontend/admin && npx vitest run __tests__/ClientsPage.test.tsx` → expected RED: `setFilters` never called with the deep-link args; cleanup test fails (no replace call).

- [ ] GREEN: in `frontend/admin/app/(main)/clients/page.tsx`:

  1. Widen the context destructure (current line ~17 `const { clients } = useClients();`):

```tsx
  const { clients, setFilters, isPending, isFetching } = useClients();
```

  2. Insert ABOVE the existing find-effect (which stays verbatim):

```tsx
  // GH #216: deep-link ?clientId=N → narrow the table to that client.
  // Server q= matches a full UUID by exact id equality (GH #212) → ≤1 row →
  // always page 1 → the find-effect below sees the row regardless of its
  // position in the unfiltered list. status forced to 'all' so archived
  // clients are reachable (display default stays 'active').
  useEffect(() => {
    if (clientIdFromQuery) {
      setFilters({ search: clientIdFromQuery, status: 'all' });
    }
  }, [clientIdFromQuery, setFilters]);

```

  3. Insert AFTER the find-effect (dead-link cleanup — spec §5.1):

```tsx
  // GH #216: dead link — narrowed fetch settled with zero rows and the modal
  // never opened → strip the param so a manual search-clear + refresh cannot
  // re-trigger the narrowing (spec §5.5 E1).
  useEffect(() => {
    if (
      clientIdFromQuery &&
      !selectedClient &&
      !isPending &&
      !isFetching &&
      clients.length === 0
    ) {
      router.replace('/clients', { scroll: false });
    }
  }, [clientIdFromQuery, selectedClient, isPending, isFetching, clients, router]);
```

- [ ] Run: `cd frontend/admin && npx vitest run __tests__/ClientsPage.test.tsx` → all pass (existing + 5 new).
- [ ] Type-check + lint: `cd frontend/admin && npm run type-check && npm run lint` (use the script names from package.json — verify with `npm run` if named differently).
- [ ] Commit: `git commit -am "feat(#216): clients deep-link effect narrows table via q= + dead-link param cleanup"`

---

## Task 4: E2E — deterministic page-2+ regression test

### Classification: standard

### Required Docs
- `docs/specs/2026-08-29-clients-deeplink-clientid-design.md` — §6 S1-S3, §7 T4 (incl. panel ruling on why fillers are required), §9
- `.opencode/skills/dev-workflow/SKILL.md` — dev stack startup, e2e execution
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — Playwright Full Cycle pattern

### Task Description

New test 19 in `frontend/admin/e2e/clients.spec.ts`. It must be RED before Task 2+3 land (deep-linked page-2+ client → no modal) — run it RED first if Tasks 2-3 are already committed, verify it against a stash or trust the ordering note below.

**Ordering note:** if you execute this task AFTER Tasks 2-3 (recommended order), the RED check is: `git stash` the T2+T3 commits is NOT needed — instead verify RED by temporarily reverting only `page.tsx` (`git checkout HEAD~2 -- 'frontend/admin/app/(main)/clients/page.tsx'`), run, see it fail at the modal assertion, then restore (`git checkout HEAD -- ...`). If that's brittle, a filmed RED is not mandatory — the test's premise-guard + close-contract assertions give it standalone regression power. Use judgment; document what was done.

Steps:

- [ ] Locate in `frontend/admin/e2e/clients.spec.ts` the existing describe `'UUID search — #216 pre-flight'` (test 18, ~line 640) and the helper `closeByBackdrop` (~line 29). After that describe block, append:

```ts
// ---------------------------------------------------------------------------
// Tests — deep-link ?clientId= (GH #216)
// ---------------------------------------------------------------------------

test.describe('Deep-link ?clientId= — #216', () => {
  test('19. deep-link opens the client card for a client beyond page 1; close keeps the narrowed view', async ({
    page,
    request,
  }) => {
    // GH #216: 20 fillers (names sorting before the target) push the target
    // («ЯЯ-…» sorts last under SQLite BINARY collation — Cyrillic Я > А and
    // all Cyrillic > Latin) beyond page 1 of the default name-asc list.
    // The fix narrows via q=<uuid> exact-id → modal opens from the row.
    const ts = uid();
    const fillers: Awaited<ReturnType<typeof createTestClient>>[] = [];
    const target = await createTestClient(request, { name: `ЯЯ-deeplink-${ts}` });
    try {
      for (let i = 0; i < 20; i++) {
        fillers.push(await createTestClient(request, { name: `АА-filler-${i}-${ts}` }));
      }

      // Premise self-check (spec §7 T4): the target must NOT be on unfiltered
      // page 1 — otherwise this test silently degrades to the page-1 path.
      const resp = await request.get(
        `${BACKEND}/api/v1/clients?sort_by=name&sort_order=asc&per_page=20`,
      );
      expect(resp.ok()).toBeTruthy();
      const page1 = await resp.json();
      expect(page1.total).toBeGreaterThanOrEqual(21);
      expect(page1.items.some((c: { id: string }) => c.id === target.id)).toBe(false);

      // Deep-link: modal opens over the narrowed table.
      await page.goto(`/clients?clientId=${target.id}`);
      await expect(page).toHaveURL(new RegExp(`clientId=${target.id}`));
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expect(page.locator('input[placeholder*="Поиск"]')).toHaveValue(target.id);
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      await expect(statusSelect).toHaveValue('all');

      // Concept point 4: close → param stripped, NO auto-clear of the search.
      await closeByBackdrop(page);
      await expect(page).not.toHaveURL(/clientId=/);
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expect(page.locator('input[placeholder*="Поиск"]')).toHaveValue(target.id);
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
      for (const f of fillers) {
        await cleanup(request, `/api/v1/clients/${f.id}`);
      }
    }
  });
});
```

  - `uid`, `createTestClient`, `cleanup`, `closeByBackdrop` are already in scope; **`BACKEND` is already declared in `clients.spec.ts` (~line 11) — no import change needed.**
  - If the status-select locator `div:has(> label:text-is("Статус")) > select` does not match the rendered DOM, debug the live DOM (`page.pause()` or a temporary screenshot — traces are `on-first-retry` only) and adjust the locator; the assertion itself (select shows `all`) is the contract, the locator is mechanical.

- [ ] Ensure the dev stack is up per dev-workflow (backend :8000 + frontend :3000).
- [ ] Run just this test: `cd frontend/admin && npx playwright test e2e/clients.spec.ts --grep "19."` 
  - Expected after T2+T3: GREEN (modal visible ≤10s, 1 row, box=UUID, status=all, close-contract holds).
  - Expected on unfixed code: RED at `expect(modal).toBeVisible`.
- [ ] US-6 acceptance anchor: `cd frontend/admin && npx playwright test e2e/unify-caches.spec.ts --grep "US-6"` → GREEN (verify the grep matches the test name; if titled differently, run the whole file).
- [ ] Also run `npx playwright test e2e/admin-opens-profile.spec.ts` → stays GREEN.
- [ ] Commit: `git commit -am "test(#216): e2e — deterministic page-2+ deep-link regression + post-close contract"`

---

## Task 5: Domain-rules sync

### Classification: trivial

### Required Docs
- `docs/specs/2026-08-29-clients-deeplink-clientid-design.md` — §5.6
- `docs/domain-rules/clients.md` — Frontend section structure

### Task Description

- [ ] In `docs/domain-rules/clients.md`, `### Frontend` section, append after the existing "Channel select" / "Dirty-check" / "Empty display" bullets:

```markdown
- **Deep-link `?clientId=` (GH #216):** navigating to `/clients?clientId={id}` (producer: ActivityDetailsModal) programmatically narrows the table — `setFilters({ search: id, status: 'all' })` → server `q=` full-UUID exact-id match → ≤1 row on page 1 → the page find-effect opens ClientCardModal from the row. Status is force-set to `all` so archived clients are reachable (display default stays `active`). On modal close the search box is NOT auto-cleared — the user sees the narrowed table and clears manually. Dead links (client deleted) strip the param once the narrowed fetch settles empty (no refresh re-narrowing loop). The ClientsFilters search input is controlled: external commits render in the box; user typing is debounced 300ms and never clobbered by its own commits; «Сбросить фильтры» cancels pending debounce and clears the box.
```

- [ ] Commit: `git commit -am "docs(#216): clients domain-rules — deep-link contract"`

---

## Full-Suite Verification (after Task 5, before reporting DONE)

- [ ] Backend: `cd backend && uv run pytest -q` → 0 fail (6 skips pre-existing allowed)
- [ ] Frontend unit: `cd frontend/admin && npm run test` (or the vitest script per package.json) → 0 fail
- [ ] Type-check + lint: clean
- [ ] E2E: `cd frontend/admin && npx playwright test` (full suite, dev stack up; serial mode if the suite config requires it) → only pre-existing classified failures allowed (none expected to touch clients)
- [ ] api-client untouched: `git diff --stat main -- packages/api-client` → empty
- [ ] G4.5 visual gate (spec §8), dev stack on :3000: `./scripts/visual-compliance-check.sh http://localhost:3000 docs/specs/2026-08-29-clients-deeplink-clientid-design.md /tmp/visual-compliance-216 desktop` and the same with `mobile` → all checks pass (run by the architect at IMPL Step 4.5; listed here so the gate is not lost)

## Self-Review (architect, recorded)

- Spec coverage: §5.1→T3, §5.2→T3 (status force-set; select already controlled — no task code, verified by T4 assertion), §5.3→T2, §5.4/T1→T1, §5.5 E1→T3 cleanup test + T4, E2→T1 test (a), §6 S1→US-6+T4, S2→T1(a), S3→T4 close-contract, S4→T2 debounce tests, §5.6→T5, §8→T4 assertions + G4.5 at IMPL end, §9→Full-Suite Verification. No gaps.
- Placeholder scan: none (the two "verify/adjust" notes in T4 are bounded mechanical checks with pinned contracts, not open TODOs).
- Type consistency: `useDebouncedCallback` return shape `{debounced, cancel}` used consistently; `ClientFilters['status']` values match 'all'|'active'|'archived'.
- Required Docs: present on all 5 tasks.
- Task ordering: T1 first (premise gate before any frontend work), T2 before T3 (controlled box is asserted in T4 only, but T3's setFilters is independent — order T2→T3 keeps the e2e RED/GREEN story clean).
