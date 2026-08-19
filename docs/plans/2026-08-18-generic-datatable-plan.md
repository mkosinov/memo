# GH #139 — Generic DataTable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all shared table mechanics from 8 copy-paste admin tables (3897 lines) into one `<DataTable>` component + `PagedListState<T>` contract, migrate all 8 tables, and unify drifted behaviors — per spec `docs/specs/2026-08-18-generic-datatable-design.md`.

**Architecture:** DataTable (controlled presentational mechanics: column visibility+LS, sort headers, pager, skeleton/error/empty, action dropdown with APG menu a11y) consumes a `PagedListState<T>` interface. Dictionary entities (5) use the existing `createPagedListContext` factory (extended); Clients/Records keep hand-rolled contexts aligned to the interface; Photos gets a factory context with a client-side adapter fetcher (full array → sort/filter/slice locally) until #211 swaps internals. Per-entity code shrinks to `<entity>Columns.tsx` factories (columns + actions) and wiring-only wrappers.

**Tech Stack:** Next.js 14 / React 18 / TypeScript / Tailwind + inline CSS vars / TanStack React Query v5 / Vitest + Testing Library / Playwright.

**Spec:** `docs/specs/2026-08-18-generic-datatable-design.md` (commit 9a07e34, pushed to main). Locked — do not re-open decisions.

**Dependencies:** #206 merged (deef5e7). Photos endpoint still unpaginated (#211 open) → Task 7 uses the client-adapter approach (no gate).

---

## Behavioral Delta

How the admin UI changes for the user, mapped to spec acceptance criteria (spec §11 DoD + §5 scenarios + §10 visual checks):

- **DoD #1 — shared mechanics in one place** → All 8 CRUD pages look and behave identically: same 10-row skeleton on load, same `↕` sort glyphs, same pager, same ⚙️ column picker (now also on Tags), same `⋯` action menu with keyboard support (arrows/Esc).
- **DoD #2 — Tags status-filter bug cannot recur** → Tags page shows no status filter; DataTable renders it only when `withStatus: true`.
- **DoD #3 — existing tests stay green** → No user-facing regression beyond the intentional deltas below.
- **Scenario 1 — column customization** → ⚙️ picker on all 8 pages; visibility persists per entity under `<entity>-columns`; the last visible column's checkbox is disabled; a corrupted/empty saved value falls back to defaults.
- **Scenario 2 — sorting** → Inactive sortable headers show `↕` everywhere (Clients gains it); changing sort resets to page 1 everywhere (Clients/Records change — previously stayed on current page).
- **Scenario 3 — delete from the row menu** → Locations/Masters/Materials/Services/Clients and now Records: `⋯` → "Удалить" opens the shared DeleteDialog with dependency dry-run. Tags/Photos still get the browser `window.confirm` (unchanged).
- **Scenario 4 — record detail** → Records row click opens the detail panel as today; new `⋯` menu offers edit/delete without opening the panel. Selected row keeps its highlight.
- **Scenario 5 — async states** → All pages: 10-row skeleton on first load (replaces "Загрузка..." text and the Clients shimmer); query failure with no data shows "Ошибка загрузки: …" + "Повторить"; a failed refetch keeps existing rows on screen; empty pages keep their current per-entity copy ("Теги не найдены", "Записи не найдены", …).
- **Scenario 6 — keyboard menu** → `⋯` opens with `aria-haspopup="menu"`; ↑/↓/Home/End navigate; Esc closes and returns focus to the trigger.
- **Search (Tags/Photos only)** → the in-table search box becomes DataTable-owned with 300ms debounce + Enter submits immediately + always-available ✕ clear button. All other pages keep their existing search exactly as-is (dict `*Filters` bars, Clients page bar — untouched, instant/debounced behavior preserved).
- **localStorage hard cut** → `services-column-visibility` / `materials-column-visibility` keys abandoned silently; those two pages reset to default columns once.

## File Map

**Create:**
- `frontend/admin/app/components/shared/tableTypes.ts` — `ColumnDef<T>`, `RowAction<T>`, `PagedListState<T>` (the DataTable contract)
- `frontend/admin/app/components/shared/DataTable.tsx` — the shared table component
- `frontend/admin/__tests__/helpers/makeTableState.ts` — test fixture factory
- `frontend/admin/__tests__/DataTable.test.tsx` — new shared-mechanics unit suite
- `frontend/admin/app/(main)/tags/components/tagColumns.tsx` (+ 7 siblings, one per entity; `materialsColumns.tsx` in `services/components/`)
- `frontend/admin/contexts/PhotosContext.tsx` — factory + client-adapter fetcher

**Modify:**
- `frontend/admin/contexts/createPagedListContext.tsx` — `isPending` pass-through, optional `search`/`setSearch` + `searchPredicate` config + `visibleItems`, page-clamp effect
- `frontend/admin/app/components/shared/ColumnPicker.tsx` — controlled conversion
- `frontend/admin/contexts/ClientsContext.tsx`, `RecordsContext.tsx` — field alignment (spec §6.4)
- 8 × `<Entity>Table.tsx` → thin wrappers
- `frontend/admin/app/(main)/records/components/ClientCardModal.tsx` → renamed `ClientQuickCard.tsx` (+ ~87 refs)
- Per-entity unit suites (B2 audit edits only) + `records.spec.ts` (one new dropdown smoke test) + `visual-regression.spec.ts` (new table baselines)

**Unchanged:** `DeleteDialog.tsx` (`app/components/`), all e2e specs except the Records dropdown smoke addition, backend.

## Contract Addendum (pinned at plan time — small gaps surfaced while planning)

1. `PagedListState<T>` gains optional `visibleItems?: T[]` — DataTable renders `visibleItems ?? items`. This is how the spec §6.7 "derived filtered view" reaches the table without changing the `items` contract.
2. `DataTableProps` gains optional `rowKey?: (row: T) => string` (default: row index) — needed for `<tr>` keys and dropdown identity. All current entities have `id`; wrappers pass `rowKey={(r) => r.id}`.
3. `PagedListState<T>` in `tableTypes.ts` is the DataTable-facing interface (status/setStatus/search/setSearch optional per spec §6.4/§6.7). The factory's `PagedListContextValue<T>` stays its own exported interface; T1 adds a compile-time assignability assertion so drift between them fails the build.
4. Dropdown testid/labels unify on the existing Clients pattern: trigger `aria-label="Действия"`, menu `data-testid={dropdown-${rowKey}}` (ClientsTable.tsx:218,229 today).
5. Records delete dry-run: T8 first verifies `DeleteDialog`'s dry-run props cover the records endpoint (#207 delivered delete+deps). If a records dry-run endpoint is missing → STOP, report BLOCKED (backend follow-up needed); do not fake it.
6. `DataTableProps` gains optional `rowTestId?: (row: T) => string` — DataTable renders `data-testid={rowTestId(row)}` on each `<tr>` only when provided. Surfaced in T1 Part A: the locked props had no row-testid mechanism while spec §8 and current e2e suites require the per-row IDs preserved (`tags-crud.spec.ts:37-40` needs `tag-row-<id>`; same for `location-row-*`, `master-row-*`, etc. + the visual-baseline row locators). Every migrated wrapper passes `rowTestId={(r) => \`<entity>-row-${r.id}\`}` with that table's existing prefix (grep-verified per migration task). Explicit prop chosen over deriving the testid from `storageKey` — no string-munging coupling, consistent with how `rowKey` was added.
7. §6.5 last-visible-column protection ships as a BEHAVIORAL guard (toggling the last visible key is a no-op) + muted visual style, WITHOUT the native `disabled`/`aria-disabled` attributes. Surfaced in T1: a native-disabled checkbox makes its label unactionable for Playwright, breaking the frozen tags-crud picker e2e (Tags has exactly one column → always last-visible → always disabled). Frozen e2e (DoD) outranks the attribute; user-visible behavior is identical (last column cannot be hidden). Applies to ColumnPicker/DataTable for ALL 8 tables (T2–T8 reuse this wording).
8. ColumnPicker keeps its legacy props (`storageKey`/`onChange` + internal LS write) as an OPTIONAL shim during T1–T7: 7 unmigrated tables still consume the old API and each task's DoD requires `tsc clean`, so the plan's "self-managed API deleted" (G1a) applies to the FINAL state — the shim is deleted in T8 when the last consumer migrates (marked with a comment in the component). The controlled path performs zero LS writes from T1 on.
9. `DataTableProps` gains optional `toolbarLead?: ReactNode` — rendered in the toolbar's LEFT group (before the search/status controls). Surfaced in T2: the old dict tables render their `*Filters` bar in the SAME row as the ColumnPicker + add button; without a lead slot the wrapper-rendered bar splits the toolbar into two rows, producing pixel diffs in 5/7 baseline scenarios beyond the locked §9 deltas. Dict wrappers (T2–T5: Locations/Masters/Materials/Services) pass their `<*Filters>` bar via `toolbarLead` to preserve the single-row layout; Tags/Clients/Photos/Records do not use it (their search/status UI lives outside the table toolbar). Zero impact when absent.
10. `DataTableProps` gains optional `actionCellExtra?: (row: T) => ReactNode` — rendered in the actions cell BEFORE the ⋯ trigger. Surfaced in T2: Locations renders an inline 🗺 «Карта» link (`aria-label="Карта"`, from `yandex_map_url`) next to ⋯ (old LocationsTable.tsx:377-390) — neither a column nor a RowAction, unit-asserted, and no locked delta removes it (dropping it would be an unsanctioned user-facing removal). Only Locations uses it; zero impact when absent.
11. E2E shared fixtures (`e2e/fixtures/helpers.ts`) and individual spec assertions MAY be minimally broadened to accept the locked §6.14 APG `role="menuitem"` alongside the legacy `role="button"` on dropdown items (e.g. `.or(...)` role fallback), each site marked with a `#139 transition` comment. Surfaced in T3: the frozen-e2e DoD collides with the locked APG menu roles on menu-item selectors — broadening preserves the frozen suites' intent (same element, same action; NO assertion weakening). The legacy `button` fallback is removed at T8 once all 8 tables render menuitem (same "final state clean" rule as Addendum 8). Also surfaced in T3: DataTable restores the pre-#139 `overflow-x-auto` table wrapper (all 8 old tables had it; T1 dropped it, causing last-row dropdown clipping) — markup parity, not an API change.

## B2 Audit Checklist (15 categories — grep before each table migration)

Per-entity suites stay on the real Provider; edits below are the ONLY sanctioned intentional changes. Anything else breaking = investigate, not silent edit.

1. `window.confirm` assertions (Tags/Photos — kept; invocation path becomes RowAction)
2. Old LS keys (`services-column-visibility`, `materials-column-visibility`)
3. Old sort glyph (Clients no-`↕` assertions)
4. Old loading assertions ("Загрузка..." ×6; Clients shimmer → 10-row skeleton)
5. Records/Clients page-reset-on-sort behavior
6. Records sort-toggle sequences (single-arg → two-arg `setSort`)
7. Records button/row-count queries (new dropdown column, appended LAST)
8. ColumnPicker API (`onChange`→`onToggle`, `storageKey` removal, internal-LS assertions)
9. Query-key shape assertions — guard only, NO change expected (dict search is predicate-only)
10. Hand-rolled context alignment consumers/mocks (`useClients`/`useRecords` across test files)
11. `aria-label="Действия"` unification queries
12. `ClientCardModal` → `ClientQuickCard` rename refs (records side)
13. Tags/Photos search mechanics (instant → 300ms debounce + Enter + ✕; e.g. TagsTable.test.tsx:164-174). The 4 dict bars keep instant onChange — their suites need NO debounce edits.
14. Empty-label copy — no edits expected (per-entity copy preserved via `emptyLabel`)
15. Initial-sort assertions — guard only, no change expected (Records keeps `sort_by=date&sort_order=asc` initial fetch)

## Visual Baseline Matrix (Task 0)

7 states × 8 tables: skeleton, filled, empty, error, dropdown-open, picker-open, sort-active. Pass criterion after each Ti = parity EXCEPT locked deltas (spec §9): 10-row skeleton everywhere, `↕` on Clients, Records new dropdown column, Clients menu gains `role="menu"`/a11y attributes.

---

## Task 0: Capture visual baselines (pre-T1)
### Classification: standard
### Required Docs
- `docs/specs/2026-08-18-generic-datatable-design.md` §9, §10 — baseline states + pass criteria
- Skill: `vitest-playwright-patterns` — Playwright conventions in this repo
- `frontend/admin/e2e/visual-regression.spec.ts` — existing baseline pattern (records-default example)

### Task Description
Extend `frontend/admin/e2e/visual-regression.spec.ts` with baseline captures for all 8 table pages BEFORE any migration, so per-task visual diffs have a reference.

Current pattern reference: the spec's `records-default` scenario (visual-regression.spec.ts) navigates to a page, waits for stability, screenshots. Baselines live in `visual-regression.spec.ts-snapshots/`, updated via `npm run test:e2e:update`.

**Steps:**

- [ ] Read `visual-regression.spec.ts` fully; reuse its navigation/stabilization helpers (date-stable comment pattern).
- [ ] For each of the 8 pages (`/tags`, `/locations`, `/masters`, `/services` (services + materials tabs), `/clients`, `/photos`, `/records`) add scenarios named `<entity>-table-<state>`:
  - `filled` — default render with seed data.
  - `sort-active` — click one sortable header, capture with `↑`/`↓`.
  - `dropdown-open` — click a row's `⋯`/actions trigger (per current per-table markup).
  - `picker-open` — click the ⚙️ `Настроить колонки` button.
  - `empty` — Playwright `page.route` intercept of the entity list endpoint returning `{ items: [], total: 0, page: 1, per_page: 10 }` (photos: `[]`).
  - `error` — intercept returning HTTP 500.
  - `skeleton` — intercept with a never-resolving response, capture during load.
- [ ] For Clients/Records note current intentional-delta states in the scenario comment (Clients: no `↕`; Records: no dropdown column) — these snapshots are EXPECTED to change post-migration.
- [ ] Run `cd frontend/admin && npm run test:e2e:update -- visual-regression.spec.ts` to record the 56 baselines; then a plain `npm run test:e2e -- visual-regression.spec.ts` run to confirm all pass against fresh baselines.
- [ ] Commit: `test(#139): visual baselines for 8 tables (7 states each)`.

**DoD:** 56 snapshots committed; spec run green twice in a row (flake check); no production code touched.

---

## Task 1: Shared foundation + Tags migration
### Classification: large
### Required Docs
- `docs/specs/2026-08-18-generic-datatable-design.md` §6.1–§6.16, §8, §12 — the full contract
- `docs/domain-rules/tags.md` — entity fields
- Skill: `test-driven-development` (RED-GREEN-REFACTOR), `vitest-playwright-patterns`
- Existing sources of truth to extract from (read-only): `contexts/createPagedListContext.tsx`, `app/components/shared/ColumnPicker.tsx`, `app/components/error/ErrorState.tsx`, `app/(main)/tags/components/TagsTable.tsx`, `app/(main)/clients/components/ClientsTable.tsx` (dropdown + pager/testid patterns)

### Task Description

**Part A — API-freeze validation (before any code).** Validate the DataTable contract against all 8 entity configs:

- [ ] For each of the 8 tables grep the column markup (`key`, header label, cell content, sort wiring) and fill this worksheet in the task report: every column maps to `ColumnDef` fields (`render` for custom JSX cells; `accessor` for plain values; `sortField` where server key ≠ column key; `sortable: false` where unsortable — e.g. Services `tags`, ServicesTable.tsx:241-243); every row action maps to `RowAction`.
- [ ] Known mappings to confirm (verified at design time): Tags = 1 column `tag`; Services = `tariffs` render (ServicesTable.tsx:83-97), `age` (backend maps `min_age`, :243), `tags` non-sortable; Records = 9 sortable columns (`RecordSortField` union); Clients = existing dropdown (`aria-label="Действия"`, `data-testid=dropdown-<id>`).
- [ ] If ANY cell/action pattern does not fit `ColumnDef`/`RowAction` → STOP, report BLOCKED with the pattern. Do NOT extend the API ad hoc.

**Part B — types + factory additions.**

- [ ] Create `frontend/admin/app/components/shared/tableTypes.ts`:

```tsx
import type { ReactNode } from 'react';
import type { ArchiveFilter, SortOrder } from '../../../contexts/createPagedListContext';

export interface ColumnDef<T> {
  key: string;
  label: string;
  defaultVisible: boolean;
  sortable?: boolean;                    // default true
  width?: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode;        // custom cell; takes precedence over accessor
  accessor?: (row: T) => string | number; // default cell renderer only (NOT sort)
  sortField?: string;                     // server sort field if ≠ key
}

export type RowAction<T> = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  hidden?: (row: T) => boolean;
  onClick: (row: T) => void;
};

export interface PagedListState<T> {
  items: T[];
  visibleItems?: T[];                    // filtered view (dict client-search); render this ?? items
  total: number;
  page: number;
  perPage: number;
  sortBy: string | null;
  sortOrder: SortOrder;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  status?: ArchiveFilter;                // required iff withStatus
  search?: string;                       // required iff withSearch
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSort: (field: string, order: SortOrder) => void;
  setStatus?: (status: ArchiveFilter) => void;
  setSearch?: (s: string) => void;
  refetch: () => void;
}

export interface DataTableProps<T> {
  storageKey: string;                    // '<entity>-columns'
  columns: ColumnDef<T>[];
  tableState: PagedListState<T>;
  actions: (row: T) => RowAction<T>[];
  onRowClick?: (row: T) => void;
  emptyLabel?: string;                   // default "Нет записей"
  toolbarExtras?: ReactNode;
  withStatus?: boolean;                  // default false
  withSearch?: boolean;                  // default false
  searchPlaceholder?: string;            // default "Поиск..."
  rowClassName?: (row: T) => string | undefined;
  rowKey?: (row: T) => string;           // default: row index
  rowTestId?: (row: T) => string;        // per-row data-testid on <tr>, omitted when absent (Addendum 6)
}
```

- [ ] Extend `contexts/createPagedListContext.tsx` (keep `PagedListContextValue<T>` exported and assignable to `PagedListState<T>`):
  1. Destructure `isPending` from `useQuery` (line 66) and add it to the value object + interface.
  2. Add config `searchPredicate?: (item: T, q: string) => boolean`; state `const [search, setSearch] = useState('')`; expose `search`, `setSearch`, and `visibleItems = searchPredicate && search ? items.filter(i => searchPredicate(i, search)) : undefined` in the value. Do NOT add `search` to the query key or fetcher params (spec §6.7 — predicate-only).
  3. Add the page-clamp effect (spec §6.7):

```tsx
useEffect(() => {
  if (!isPending && !isFetching && items.length === 0 && page > 1) setPage(page - 1);
}, [isPending, isFetching, items.length, page]);
```

  4. Add a compile-time assertion (bottom of file): `const _assertAssignable: (v: PagedListContextValue<unknown>) => PagedListState<unknown> = (v) => v;` (import type from `app/components/shared/tableTypes` — type-only import, no runtime cycle).
- [ ] Update `__tests__/createPagedListContext.test.tsx` expectations for the new fields (additive: `isPending`, `search: ''`, `visibleItems: undefined` defaults); add tests: `isPending` true on first load; search predicate filters `visibleItems` without refetch (query key unchanged — B2 cat 9 guard); page-clamp effect fires on empty non-first page.

**Part C — ColumnPicker controlled conversion.**

- [ ] `app/components/shared/ColumnPicker.tsx`: new props `{ columns, visibleKeys, onToggle: (key: string) => void }`; delete `storageKey` prop and the `localStorage.setItem` (line 39); keep internal `open` state + outside-`mousedown` handler (lines 23-32); disable a checked checkbox when `visibleKeys.length === 1` (`disabled` attr + `aria-disabled` + muted style); title text on the trigger stays `aria-label="Настроить колонки"`.
- [ ] Update `__tests__/ColumnPicker.test.tsx` (B2 cat 8): onToggle called with key; no LS writes; last-visible checkbox disabled.

**Part D — DataTable component.**

- [ ] Create `__tests__/helpers/makeTableState.ts`: `export function makeTableState<T>(overrides: Partial<PagedListState<T>> & { items: T[] }): PagedListState<T>` — defaults: `total = items.length, page 1, perPage 10, sortBy null, sortOrder 'asc', isPending/isLoading/isFetching false, error null`, all setters + `refetch` as `vi.fn()`.
- [ ] Write `__tests__/DataTable.test.tsx` FIRST (RED), covering: skeleton (10 rows × visible columns only, when `isPending`); error row via ErrorState + "Повторить" → `refetch()`; error-with-rows keeps rows (no error row); empty row with default + custom `emptyLabel`; sort click computing `nextOrder` (inactive→asc, active-asc→desc, active-desc→asc) calling `setSort(sortField ?? key, order)`; `aria-sort` on active header; non-sortable column renders no button; column visibility toggle + last-column disabled + LS persistence under `storageKey` + corrupted/empty LS read → defaults; search input debounce (300ms fake timers), Enter submits immediately + cancels pending debounce, ✕ clear button; dropdown: opens with menuitems, `danger` styling, `hidden` filtering, outside-mousedown close, Esc close + focus return, ↑/↓/Home/End roving-tabindex nav; `onRowClick` fires on row click but NOT from clicks on `button`/`a`/`[role="button"]`/`input` inside cells; pager renders `page-size-select` and calls `setPage`/`setPerPage`; `withStatus`/`withSearch` false render neither control.
- [ ] Implement `app/components/shared/DataTable.tsx` (GREEN). Structural requirements (exact behavior per spec §6.1–§6.15):
  - Column visibility state: `useState(() => readVisibleKeys(storageKey, columns))`; `readVisibleKeys` parses LS, validates (array, non-empty, keys ⊆ column keys) else returns `columns.filter(c => c.defaultVisible).map(c => c.key)`; `toggle` writes LS. DataTable owns this — ColumnPicker is controlled.
  - Search: local `draft` state initialized from `tableState.search ?? ''`; 300ms `useRef` timer → `setSearch`; Enter → submit now + clear timer; ✕ button (rendered when draft non-empty) clears + submits `''`; `useEffect` cleanup clears the timer on unmount.
  - Sort header click: `const f = col.sortField ?? col.key; const next = tableState.sortBy === f && tableState.sortOrder === 'asc' ? 'desc' : 'asc'; tableState.setSort(f, next)`; inactive sortable headers render `' ↕'`, active `' ↑'`/`' ↓'`; header is a `<button aria-sort=…>`; `sortable === false` → plain `<th>`.
  - Rows: render `tableState.visibleItems ?? tableState.items`; `<tr key={rowKey?.(row) ?? i}>`; row click guard `if ((e.target as HTMLElement).closest('button, a, [role="button"], input')) return;` then `onRowClick?.(row)`; apply `rowClassName?.(row)`.
  - Cells: `col.render?.(row) ?? col.accessor?.(row) ?? ''`; respect `align`/`width` on `<th>`/`<td>`.
  - Dropdown (last column, APG menu-button, roving tabindex): trigger `<button aria-label="Действия" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}>`; menu `<div role="menu" data-testid={dropdown-${key}}>`; items `<button role="menuitem">` (danger → red style; `hidden?.(row)` filters); open state `openRowKey: string | null`; outside-`mousedown` closes; Esc closes + `triggerRef.focus()`; ↑/↓ move focus, Home/End first/last; focus menu first item on open.
  - States: `isPending` → 10 skeleton rows (`animate-pulse`, one `<td>` per VISIBLE column); `error && rows.length === 0` → single full-width row rendering the existing `<ErrorState title={\`Ошибка загрузки: ${error.message}\`} error={error} onRetry={refetch} />` (`app/components/error/ErrorState.tsx` — pass `title` explicitly; its default "Не удалось загрузить данные" (:18) does NOT match the §6.8/§10 copy); `rows.length === 0 && !isPending && !error` → full-width row `emptyLabel ?? 'Нет записей'`; `error && rows.length > 0` → rows shown, no error row.
  - Pager: extract the existing pager markup pattern from MastersTable.tsx:443 / ServicesTable.tsx:513 (they share it: `data-testid="page-size-select"` select + page buttons); preserve testids and add `aria-label` to prev/next buttons. Verify against RecordsTable/ClientsTable pagers in T6/T8 (they differ — B2 guard).
  - Toolbar: search input (when `withSearch`, `placeholder={searchPlaceholder ?? 'Поиск...'}`), status `<select>` (when `withStatus`, options Активные/Все/Архив wired to `status`/`setStatus` — implemented for contract completeness per locked DoD #2, but NO migrated table passes `withStatus` initially: the dict `*Filters` bars and the Clients page bar own status selects), `<ColumnPicker columns={…} visibleKeys={…} onToggle={toggle} />` ALWAYS, `toolbarExtras` slot.
  - Defensive rendering: no `useEffect`/`useRef` keyed on `columns`/`actions` prop identity (spec §6.15); dropdown keyed by resolved row key.
- [ ] `cd frontend/admin && npm run test` → DataTable suite + factory + ColumnPicker green; tsc clean.

**Part E — Tags migration.**

- [ ] Create `app/(main)/tags/components/tagColumns.tsx`: `export const tagColumns = (): ColumnDef<TagResponse>[] => [{ key: 'tag', label: 'Тег', defaultVisible: true, accessor: (t) => t.tag }]` and `export const tagActions = (cbs: { onDelete: (t: TagResponse) => void }): (row: TagResponse) => RowAction<TagResponse>[]` — delete action `danger: true`, `onClick` → `cbs.onDelete` (parent runs `window.confirm('Удалить тег?')` then `deleteTag.mutateAsync`, preserving TagsTable.tsx:143-152 logic incl. toasts).
- [ ] Add `searchPredicate: (t, q) => t.tag.toLowerCase().includes(q.toLowerCase())` to `TagsContext` factory config (replaces TagsTable local `search`/`filteredTags` useState/filter, :250).
- [ ] Rewrite `TagsTable.tsx` as thin wrapper: keeps `editTag`/`creatingTag` modal state, `deleteTag` mutation + confirm handler, renders `<DataTable storageKey="tags-columns" columns={useMemo(() => tagColumns(), [])} tableState={useTagsTable()} actions={useMemo(() => tagActions({ onDelete: handleDelete }), [])} onRowClick={setEditTag} emptyLabel="Теги не найдены" withSearch searchPlaceholder="Поиск тегов..." rowKey={(t) => t.id} />` + the existing TagModal (exact hook name per TagsContext.tsx — `useTagsTable`, :24). `useMemo` on both factory outputs is a §6.15 contract requirement — apply in every wrapper. No sort/pager/skeleton/LS/dropdown logic remains.
- [ ] B2 audit on `__tests__/tags/TagsTable.test.tsx` (237 ln, 9 tests): cat 1 (confirm — now via RowAction), cat 4 ("Загрузка..." → skeleton), cat 13 (search test :164-174 → fake timers/advance debounce), cat 14 (empty copy preserved — expect no edit). Update only those.
- [ ] `npm run test:all` (UI touched) → green incl. `tags-crud.spec.ts` e2e unchanged.
- [ ] Visual diff Tags page × 7 baseline states; expected deltas: skeleton rows, picker present (was already), ✕/debounce behavior. Investigate any other diff.
- [ ] Commit: `feat(#139): shared DataTable foundation + Tags migration (T1)`.

**DoD:** DataTable suite green; factory/ColumnPicker suites green; Tags suite green with B2-only edits; `tags-crud` e2e green; tsc clean; visual diff shows only locked deltas; E2E scenario anchor: spec §5 scenarios 1, 2, 5, 6 verified on Tags via existing `tags-crud.spec.ts` (unchanged) + new DataTable unit coverage.

---

## Task 2: Locations migration
### Classification: standard
### Required Docs
- Spec §6 (contract), §7 (template), §8 (B2)
- `docs/domain-rules/locations.md`
- Skills: `test-driven-development`, `vitest-playwright-patterns`
- Extract from: `app/(main)/locations/components/LocationsTable.tsx` (560 ln), `contexts/LocationsContext.tsx`

### Task Description
- [ ] B2 grep on `__tests__/LocationsTable.test.tsx` (~35 tests): expected categories = 4 ("Загрузка..." :241 → skeleton), 14 (empty "Локации не найдены" preserved — no edit). Search/filter assertions should pass UNCHANGED (state moves to context, behavior identical — instant onChange kept). Note anything else and report it before editing.
- [ ] **Move search into the factory:** add `searchPredicate: (l, q) => /* name+address match, per LocationFilters placeholder "Название или адрес..." */` to `LocationsContext` factory config; DELETE the table-local `search` useState (:64) + `filteredLocations` memo (:102). Rewire `<LocationFilters>` (:250) to read `search`/`setSearch` from `useLocationsTable()` — the bar's UI/markup is untouched (out of #139 scope, spec §3).
- [ ] Create `locationColumns.tsx`: extract every column verbatim from LocationsTable JSX into `ColumnDef<LocationResponse>[]` (custom cells → `render`); `locationActions({ onEdit, onDelete, onArchive/… })` matching existing menu items; delete → parent opens existing `DeleteDialog` (import unchanged from `app/components/DeleteDialog.tsx`).
- [ ] Thin `LocationsTable.tsx`: modal/dialog state + mutations + `<LocationFilters>` render stay; `<DataTable storageKey="locations-columns" tableState={useLocationsTable()} emptyLabel="Локации не найдены" … />` (exact hook name per LocationsContext.tsx — `useLocationsTable`, :22). **No `withStatus`/`withSearch`** — the bar owns both: its Статус select is already wired to context `setStatus` (:254, verified), its search input rewires to context `search`/`setSearch` (step above). `columns`/`actions` wrapped in `useMemo` (§6.15).
- [ ] Delete migrated mechanics from the wrapper (sort handlers, pager markup, skeleton/loading JSX, LS code, dropdown state, search/filter state) — same commit, no dead code.
- [ ] `npm run test:all` green (unit with B2-only edits + `locations-crud.spec.ts` e2e unchanged); tsc clean.
- [ ] Visual diff Locations × 7 states; only locked deltas (skeleton).
- [ ] Commit: `feat(#139): Locations migration (T2)`.

**DoD:** suite green with B2-only edits; e2e green; visual parity except skeleton; wrapper has zero table-mechanics logic.

---

## Task 3: Masters migration
### Classification: standard
### Required Docs
- Spec §6–§8; `docs/domain-rules/masters.md`; skills as T2
- Extract from: `app/(main)/masters/components/MastersTable.tsx` (531 ln), `contexts/MastersContext.tsx`

### Task Description
Identical template to Task 2, with:
- Entity files: `masterColumns.tsx`; empty copy "Мастера не найдены"; `storageKey="masters-columns"`.
- Factory search: `searchPredicate` into `MastersContext`; `<MasterFilters>` (:241-243) search rewires to context `search`/`setSearch` (UI untouched, instant onChange kept); table-local `search` useState (:58-61) + `filtered*` memo deleted. The bar's Статус select already wires to context `setStatus` — untouched; DataTable gets NO `withStatus`/`withSearch`.
- B2 grep `__tests__/MastersTable.test.tsx` (~33 tests): cat 4 (:234), cat 14 (no edit), plus 11 if any action-label queries exist.
- E2E guards: `masters-crud.spec.ts` + `masters-delete-blocked.spec.ts` + `masters-delete-auto-cascade.spec.ts` all unchanged & green (DeleteDialog flow preserved via RowAction → parent dialog).
- Visual diff Masters × 7 states.
- Commit: `feat(#139): Masters migration (T3)`.

**DoD:** same shape as T2; all 3 masters e2e specs green.

---

## Task 4: Materials migration
### Classification: standard
### Required Docs
- Spec §6–§8 (esp. §6.11 LS hard cut); `docs/domain-rules/materials.md`; skills as T2
- Extract from: `app/(main)/services/components/MaterialsTable.tsx` (517 ln — stays in `services/components/`, NO relocation)

### Task Description
Identical template to Task 2, with:
- Entity file: `materialsColumns.tsx` created in `app/(main)/services/components/` (colocated).
- **B2 cat 2 in play:** old LS key `materials-column-visibility` (MaterialsTable.tsx:77) abandoned silently → new `storageKey="materials-columns"`; update any suite assertions on the old key.
- Factory search: `searchPredicate` into `MaterialsContext`; the `ServiceFilters` instance rendered by MaterialsTable (:282-288) search rewires to context `search`/`setSearch` (UI untouched); table-local search state (:110-113) + `filtered*` memo deleted. The bar's Статус select stays context-wired; DataTable gets NO `withStatus`/`withSearch`.
- Empty copy "Материалы не найдены"; the FACTORY config keeps `withStatus: true` (query key/fetcher — unchanged); the DataTable prop is omitted (§6.1 matrix).
- E2E guard: `materials-delete.spec.ts` unchanged & green (⚠️ no materials-crud spec exists — unit suite + visual gate are the net, spec §8).
- Visual diff Materials × 7 states.
- Commit: `feat(#139): Materials migration (T4)`.

**DoD:** same shape as T2; old LS key fully removed from code.

---

## Task 5: Services migration
### Classification: standard
### Required Docs
- Spec §6–§8; `docs/domain-rules/services.md`; skills as T2
- Extract from: `app/(main)/services/components/ServicesTable.tsx` (602 ln)

### Task Description
Identical template to Task 2, with:
- Entity file: `serviceColumns.tsx` in `services/components/`.
- Column specifics (verified): `tariffs` → `render` (ServicesTable.tsx:83-97 markup verbatim); `age` sortable — backend maps `age`→`min_age` (:241-243), so `sortField` NOT needed (pass-through); `tags` column → `sortable: false`.
- **B2 cat 2 in play:** `services-column-visibility` (:150) → `storageKey="services-columns"`.
- Factory search: `searchPredicate` into `ServicesContext`; `<ServiceFilters>` (:364-374) search rewires to context `search`/`setSearch` (UI untouched); table-local search state (:183-186) + `filtered*` memo deleted. The bar's Статус select stays context-wired; DataTable gets NO `withStatus`/`withSearch`.
- Empty copy "Услуги не найдены"; B2 cat 4 (:357).
- E2E guard: `services-crud.spec.ts` unchanged & green.
- This is the largest dict table (602 ln) — expect a heavy diff; keep extraction strictly verbatim.
- Visual diff Services × 7 states.
- Commit: `feat(#139): Services migration (T5)`.

**DoD:** same shape as T2; tariffs/age/tags column behavior covered by updated unit assertions.

---

## Task 6: Clients migration + hand-rolled context alignment
### Classification: large
### Required Docs
- Spec §6.4 (delta table), §6.10, §8 cats 3, 5, 10, 11, 13, 15
- `docs/domain-rules/clients.md`
- Skills: `test-driven-development`, `vitest-playwright-patterns`
- Extract from: `app/(main)/clients/components/ClientsTable.tsx` (272 ln), `contexts/ClientsContext.tsx` (286 ln)

### Task Description

**Part A — ClientsContext alignment (spec §6.4, additive):**
- [ ] Expose alongside existing fields: `items` (alias of `clients`), `isFetching` + `isPending` (pass-through from the existing `useQuery`), `error: Error | null` (replace the `error?.message || null` stringification at :242 — keep old field name/type until consumers migrate, then retire within this task), page-clamp effect (spec §6.7 snippet), `setSort` gains `setPage(1)` (:120-123 — locked drift fix, §6.10.2). Do NOT add `status`/`setStatus`/`search`/`setSearch` — the page-level `ClientsFilters` bar owns search+status via `filters`/`setFilters` (out of scope; DataTable `withStatus`/`withSearch` are false for Clients, spec §6.1 matrix).
- [ ] Keep `sortBy: string` non-null (assignable to `string | null`; initial 'name' unchanged — B2 cat 15 guard).
- [ ] Update all `useClients` consumers + mocks (5 non-test + 7 test files — B2 cat 10) to the aligned fields where they touch table state; retire old duplicates within this task. `mockContexts.ts` typed `Partial<…>` — renames surface via tsc; fix every error until clean.
- [ ] Update `__tests__/ClientsContext.test.tsx` for the added fields + setSort page-reset (B2 cat 5).

**Part B — table migration:**
- [ ] B2 grep `__tests__/ClientsTable.test.tsx` (~38 tests): cat 3 (no-`↕` assertions :169), cat 4 (shimmer → 10-row skeleton :115), cat 5 (sort↔page), cat 10, 11 (dropdown labels already "Действия" :218 — likely no edit), 14 ("Ничего не найдено" preserved), 15. Cat 13 NOT expected (Clients search is the page bar's, debounced already, untouched).
- [ ] Create `clientColumns.tsx` (columns incl. existing custom cells; menu items edit/delete/archive/restore → `clientActions({...})` — archive/restore stays a LABEL toggle via `row.archived`, not `hidden`).
- [ ] Thin `ClientsTable.tsx`: `<DataTable storageKey="clients-columns" emptyLabel="Ничего не найдено" …>` — NO `withStatus`/`withSearch` (the page-level `ClientsFilters` bar owns both: search 🔍 + Статус select, wired to `setFilters`; out of scope); delete/archive/restore RowActions open existing DeleteDialog/flows; row-level dropdown markup (:218-229) deleted — DataTable owns it.
- [ ] Clients search/status stay exactly where they are (page-level `ClientsFilters` bar → `setFilters`, server-side) — the table migration does not touch them; no `search`/`setSearch` additions to ClientsContext.
- [ ] `npm run test:all` green (unit + `clients.spec.ts` + 2 delete e2e specs unchanged); tsc clean.
- [ ] Visual diff Clients × 7 states; expected deltas: `↕` glyphs, skeleton rows, menu a11y attributes.
- [ ] Commit: `feat(#139): Clients migration + context alignment (T6)`.

**DoD:** context exposes the aligned `PagedListState` shape per §6.4 (items/isFetching/isPending/error/page-clamp/setSort page-reset — NO status/search additions); suite green with B2-only edits; 3 clients e2e specs green; visual deltas limited to locked list.

---

## Task 7: Photos migration (client-adapter context)
### Classification: large
### Required Docs
- Spec §6.4, §6.7, §7, §8 cats 1, 4, 13, 14
- `docs/domain-rules/photos.md`
- Skills: `test-driven-development`, `vitest-playwright-patterns`
- Extract from: `app/(main)/photos/components/PhotosTable.tsx` (523 ln — local `useState` sort :64-65, client slice, `window.confirm` :195, search "Поиск фото..." :239)

### Task Description

> **⚠️ G2 DECISION POINT (spec §12.13b):** the locked spec gated T7 on a Photos server-paginated context "#206/#211". #206 merged without one; #211 (photos server pagination) is still OPEN. This task resolves the gap with a **client-adapter context** (factory + full-array fetcher → sort/filter/slice locally) — zero DataTable contract impact, #211 later swaps fetcher internals only. Alternatives if rejected at G2: gate T7 on #211, or defer T7 to a follow-up PR and ship T1–T6+T8.

**Part A — create `contexts/PhotosContext.tsx` via the factory with a CLIENT-ADAPTER fetcher** (photos endpoint is unpaginated — verified `getPhotos(): Promise<PhotoResponse[]>`; #211 will later swap internals; DataTable contract unaffected):
- [ ] `createPagedListContext<PhotoResponse>({ queryKeyPrefix: 'photos', searchPredicate: (p, q) => (p.title ?? '').toLowerCase().includes(q.toLowerCase()) /* confirm actual title/photo fields against schemas/photo type */, fetcher: async ({ page, per_page, sort_by, sort_order }) => { const all = await getPhotos(); /* apply client sort over sort_by when present; slice (page-1)*per_page … */ return { items, total: all.length, page, per_page }; } })` — no `status` (withStatus false). Preserve today's client sort fields/direction exactly (grep PhotosTable sort logic).
- [ ] Unit tests for the adapter: slicing math, total, client sort order, predicate filtering via `visibleItems`.

**Part B — table migration:**
- [ ] B2 grep `__tests__/photos/PhotosTable.test.tsx` (75 ln, ~3 tests): cat 1 (confirm :195 → RowAction), 4 (:220 → skeleton), 13 (search debounce), 14 ("Фото не найдены" preserved).
- [ ] Create `photoColumns.tsx` in `photos/components/`; `photoActions({ onDelete })` — delete keeps `window.confirm('Удалить фото?')` in the parent (locked, spec §6.9).
- [ ] Thin `PhotosTable.tsx`: `<DataTable storageKey="photos-columns" withSearch searchPlaceholder="Поиск фото..." emptyLabel="Фото не найдены" …>`; wrap page in the new `PhotosProvider`.
- [ ] `npm run test:all` green (unit + `photos-crud.spec.ts` unchanged); tsc clean.
- [ ] Visual diff Photos × 7 states.
- [ ] Commit: `feat(#139): Photos migration via client-adapter context (T7)`.

**DoD:** PhotosProvider exposes `PagedListState<PhotoResponse>`; suite + e2e green; comment in context file marks the adapter as interim until #211.

---

## Task 8: Records migration + context alignment + action dropdown + ClientQuickCard rename
### Classification: large
### Required Docs
- Spec §6.4, §6.9–§6.13, §8 cats 5, 6, 7, 10, 12, 15
- `docs/domain-rules/records.md`
- Skills: `test-driven-development`, `vitest-playwright-patterns`
- Extract from: `app/(main)/records/components/RecordsTable.tsx` (477 ln), `contexts/RecordsContext.tsx` (253 ln), `app/(main)/records/components/ClientCardModal.tsx` (173 ln)

### Task Description

**Part A — RecordsContext alignment (spec §6.4, additive):**
- [ ] Expose alongside: `items` (alias of `records`), `isLoading` (alias of `loading` :59), `isFetching` + `isPending` pass-throughs (extend the `useQuery` destructure :81), page-clamp effect, `setSort(field: string, order: SortOrder)` TWO-ARG with param widened from `RecordSortField` to `string` (:115-122) + `setPage(1)` inside (§6.10.2) + `useCallback` dep updated; toggle logic REMOVED from context (DataTable owns it, §6.10.4).
- [ ] Keep `sortBy: RecordSortField` non-null init 'date' (assignable; initial fetch `sort_by=date&sort_order=asc` preserved — B2 cat 15). Do NOT add `status`/`setStatus`/`search` (optional in the interface; booking status stays in `filters`, spec §6.4).
- [ ] Update all `useRecords` consumers + mocks (5 non-test + 6 test + `mockContexts.ts:75` — B2 cat 10) until tsc clean; retire old fields within this task.
- [ ] Update `__tests__/RecordsContext.test.tsx`: two-arg setSort, page-reset, toggle removal (B2 cat 6), isPending/isFetching presence.

**Part B — ClientQuickCard rename (spec §6.13):**
- [ ] `git mv app/(main)/records/components/ClientCardModal.tsx ClientQuickCard.tsx`; rename the component + all records-side imports (~87 grep matches across ≥6 test files incl. `RecordsClientCardModal.test.tsx` → renamed `ClientQuickCard.test.tsx`; `ClientsIntegration/ClientsPage/ClientInfoTab` test refs; `wave6-status-shared.spec.ts`; the `describe('ClientCardModal — Record tab integration')` block) — B2 cat 12. Clients-side `ClientCardModal` untouched.
- [ ] Repo-wide grep `ClientCardModal` at the end: remaining hits must be clients-side only. Report the final count.

**Part C — table migration + NEW action dropdown:**
- [ ] **Guard step (Contract Addendum 5):** grep `DeleteDialog.tsx` props + records delete endpoint for 409 dry-run support. Missing → STOP, report BLOCKED.
- [ ] B2 grep `__tests__/RecordsTable.test.tsx` (~20 tests): cats 5, 6, 7 (dropdown column appended LAST shifts cell indexes), 10, 12, 15. Note: loading "Загрузка..." never existed here (keepPreviousData) — skeleton appears only on true initial `isPending`.
- [ ] Create `recordsColumns.tsx`: 9 columns (keys = `RecordSortField` union members, all sortable) + client cell as button calling `onClientClick` factory param (replaces `stopPropagation` :215 — DataTable's `closest` guard handles it) + `recordsActions({ onEdit, onDelete })` — delete `danger: true` → parent opens DeleteDialog with records dry-run; NO "open detail" action (locked: `onRowClick` only).
- [ ] Thin `RecordsTable.tsx`: keeps detail panel (~100 ln), `selectedRecord` state, `clientModalId` state + `ClientQuickCard` render; `<DataTable storageKey="records-columns" tableState={useRecords()} onRowClick={(r) => setSelectedRecord(sel => sel?.id === r.id ? null : r)} rowClassName={(r) => selectedRecord?.id === r.id ? 'bg-surface' : undefined} emptyLabel="Записи не найдены" rowKey={(r) => r.id} …>` (final class per design-system surface token). Wrapper larger than others — expected (spec §6.12 caveat).
- [ ] New e2e smoke (ONLY e2e addition, spec §8): in `records.spec.ts` add a test — row `⋯` opens menu (`role="menu"`, `data-testid="dropdown-<id>"`), "Удалить" opens DeleteDialog; cancel closes. RED→GREEN.
- [ ] `npm run test:all` green (unit + `records.spec.ts` + `unify-caches.spec.ts` guards); tsc clean.
- [ ] Visual diff Records × 7 states; expected deltas: dropdown column, skeleton, `↕` already present.
- [ ] Commit: `feat(#139): Records migration + ClientQuickCard rename + action dropdown (T8)`.

**DoD:** context aligned (tsc clean across consumers); rename complete (clients-side `ClientCardModal` only remaining); dropdown e2e smoke green; all records e2e green; E2E scenario anchors: spec §5 scenarios 3, 4 verified via `records.spec.ts`.

---

## Final Gate (after Task 8)

- [ ] Full suite: `npm run test:all` from repo root (or per dev-workflow skill) — backend untouched, admin vitest + e2e green, tsc clean, build clean.
- [ ] Full visual pass: all 8 tables × 7 states diffed against Task 0 baselines; only locked deltas.
- [ ] Spec §10 Visual Compliance Checks — every checkbox verified via the running app (visual gate G4.5 procedure).
- [ ] DoD self-check against spec §11 (3 items).

## Self-Review Notes (architect)

- Spec coverage: every spec §6 subsection lands in T1 (foundation) or the per-table tasks; §6.13 rename in T8; §8 additive strategy honored (per-entity suites real Provider, new DataTable suite is the added layer); §9 baselines = Task 0; §10 checks = Final Gate.
- Task independence: T2–T5 depend only on T1; T6/T8 include their context alignment (no cross-task coupling); T7 self-contained via client adapter (no #211 gate).
- No placeholders: every task names exact files, verified line refs, exact snippets for shared pieces; per-entity extraction is verbatim-by-rule (source of truth = existing tables).
- Riskiest tasks: T1 (component birth) and T8 (rename ×87 refs + context alignment + new feature) — both classified large.
