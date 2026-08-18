# GH #139 — Generic DataTable — Design Spec

- **Issue:** #139 — `refactor(admin): generic DataTable (8 copy-paste tables ~3500 lines → shared <DataTable> + unified mechanics)`
- **Date:** 2026-08-18
- **Status:** G1a PASSED (brainstorming concept approved; all decisions locked). Awaiting G1b.
- **Depends on:** #206 IMPL (Photos + Records server pagination) for migration tasks T7/T8 only; T1–T6 independent.

---

## 1. Problem

The admin has 8 CRUD tables (Tags, Locations, Masters, Materials, Services, Clients, Photos, Records) implemented as copy-paste variants — measured **3897 lines** across the 8 `*Table.tsx` files (issue estimate "~3500"). Shared mechanics (column visibility, sorting, paging, loading, delete UX, action dropdowns) are duplicated with drifted behavior:

- 2 divergent localStorage key formats (`services-column-visibility`, `materials-column-visibility` vs `<entity>-columns` ×6).
- 3 loading patterns: "Загрузка..." text ×6, shimmer skeleton ×1 (Clients), none ×1 (Records).
- 2 sort-indicator patterns: neutral `↕` ×7, arrow-only-when-active ×1 (Clients).
- Inconsistent page-reset-on-sort: factory contexts reset page→1; Clients/Records don't.
- 2 delete patterns: `window.confirm` (Tags, Photos) vs `DeleteDialog` ×5; Records has no table-level delete at all.
- Two different components both named `ClientCardModal` (records read-only viewer, 173 ln; clients full editor, 286 ln) — import confusion and duplicate test describe blocks.

Every mechanics change (e.g. a11y, skeleton, delete flow) currently costs 8 edits and drifts again.

## 2. Goals

1. All shared table mechanics live in ONE place: `<DataTable>` in `app/components/shared/` + `PagedListState<T>` from `createPagedListContext`.
2. Per-entity code reduced to config only: `ColumnDef<T>[]` + `RowAction<T>[]` factories in `<entity>Columns.tsx`.
3. Unify all drifted behaviors (locked decisions, §6.10–6.11) across all 8 tables.
4. Migrate all 8 tables; existing unit + e2e suites stay green (with documented intentional edits).
5. Menu/a11y becomes shared mechanics (arrow-key nav, Esc, focus return, `aria-*`) — in scope as DoD.
6. Records table gains an action dropdown (NEW additive feature); detail panel preserved.

## 3. Non-Goals (Out of Scope — follow-up issues)

- #212 — server-side search `?q=` for all tables (search **mechanics** unify here; dict server search does not).
- #206 — Photos + Records server pagination (parallel work; gates only migration tasks T7/T8).
- #213 — display-lookup composite read endpoint.
- #214 — dict combobox over `/all`.
- ClientCardModal **merge** (only rename, §6.13) — follow-up after #139.
- Test-suite dedup across per-entity suites — cleanup PR after #139 IMPL.
- `*Filters.tsx` shared component — #139 is about tables, not filter bars.
- Screen-reader page announcements — follow-up issue.
- Materials file relocation — `materialsColumns.tsx` colocates in `services/components/` (no moves, consistent with no-relocation principle).

## 4. Current State (verified 2026-08-18)

### 4.1 Tables (8) and sizes

| Entity | File | Lines | Pagination | Loading | Sort glyph | Delete |
|---|---|---|---|---|---|---|
| Tags | `app/(main)/tags/components/TagsTable.tsx` | 415 | server (factory, #205) | "Загрузка..." | ↕/↑/↓ | `window.confirm` (:145) |
| Locations | `app/(main)/locations/components/LocationsTable.tsx` | 560 | server (factory) | "Загрузка..." | ↕/↑/↓ | DeleteDialog |
| Masters | `app/(main)/masters/components/MastersTable.tsx` | 531 | server (factory) | "Загрузка..." | ↕/↑/↓ | DeleteDialog |
| Materials | `app/(main)/services/components/MaterialsTable.tsx` | 517 | server (factory) | "Загрузка..." | ↕/↑/↓ | DeleteDialog |
| Services | `app/(main)/services/components/ServicesTable.tsx` | 602 | server (factory) | "Загрузка..." | ↕/↑/↓ | DeleteDialog |
| Clients | `app/(main)/clients/components/ClientsTable.tsx` | 272 | server (hand-rolled ctx) | shimmer skeleton | ↑/↓ active-only (:169) | DeleteDialog |
| Photos | `app/(main)/photos/components/PhotosTable.tsx` | 523 | **client-side slice** (#206 migrates) | "Загрузка..." | ↕/↑/↓ | `window.confirm` (:195) |
| Records | `app/(main)/records/components/RecordsTable.tsx` | 477 | server (hand-rolled ctx) | none (keepPreviousData) | ↕/↑/↓ | **none in table** |

Total: 3897 lines. Contexts: factory-backed ×5 (Tags, Locations, Masters, Services, Materials); hand-rolled ×2 (Clients, Records — same shape, server-paginated); Photos has **no context** (local `useState` sort, PhotosTable.tsx:64–65).

### 4.2 Shared pieces

- `frontend/admin/contexts/createPagedListContext.tsx` (121 ln) — already **exports interface `PagedListContextValue<T>`** (items/total/page/perPage/sortBy/sortOrder/status/isLoading/isFetching/error + setPage/setPerPage/setSort/setStatus/**refetch**, lines 7–35). Factory `setSort` already resets page→1 (:83–87).
- `frontend/admin/app/components/shared/ColumnPicker.tsx` (78 ln) — props `{columns, visibleKeys, onChange, storageKey}`; owns the `localStorage` write internally (:39). Only popover open/close is internal state.
- `frontend/admin/app/components/DeleteDialog.tsx` (335 ln) — parent-owned, 409 dry-run pre-flight support; used by 5 tables + clients modal. **Note:** lives at `app/components/`, NOT `shared/` (see §12).
- Naming precedent for config files: `tagFields.tsx` (15 ln), `serviceFields.tsx` (137 ln), plus `locationFields.tsx`, `masterFields.tsx`, `photoFields.tsx` — camelCase `<entity>X.tsx` colocated in `components/`.

### 4.3 Tests

- Unit suites (real Provider + fetch spy): LocationsTable (724 ln, ~35t), ClientsTable (560 ln, ~38t), RecordsTable (335 ln, ~20t), MastersTable (690 ln, ~33t), MaterialsTable (496 ln, ~24t), ServicesTable (671 ln, ~33t), tags/TagsTable (237 ln, ~9t), photos/PhotosTable (75 ln, ~3t). Plus `createPagedListContext.test.tsx`, `ColumnPicker.test.tsx`, `DeleteDialog.test.tsx`.
- E2E: `tags-crud`, `locations-crud`, `masters-crud` (+2 delete specs), `services-crud`, `materials-delete` (⚠️ no materials-crud spec), `photos-crud`, `clients.spec` (+2 delete specs), `records.spec`.

## 5. User Scenarios

Each scenario = an admin task the refactor preserves or unifies; each maps to E2E coverage (existing specs unchanged unless noted).

1. **Customize columns on any entity page.** Admin opens "Настроить колонки", toggles columns, reloads — visibility persists per entity (`<entity>-columns`). Maps to: existing column-picker checks in `*-crud.spec.ts` (all 8 pages; Tags now ALSO shows the picker).
2. **Sort a column.** Admin clicks a sortable header on any of the 8 pages → neutral `↕` on inactive sortable headers, `↑`/`↓` when active, page resets to 1. Maps to: sort checks in `*-crud.spec.ts` / `records.spec.ts` / `clients.spec.ts` (intentional deltas for Clients glyph + Records/Clients page-reset — §6.10).
3. **Delete an entity from the row action menu.** Admin opens `⋯` → "Удалить" → DeleteDialog with 409 dependency dry-run (Locations/Masters/Materials/Services/Clients, and Records via the NEW dropdown). Maps to: `masters-delete-blocked`, `masters-delete-auto-cascade`, `clients-delete-cascade`, `clients-delete-invalid-resolution`, `materials-delete` specs. Tags/Photos keep `window.confirm` (existing `tags-crud` / `photos-crud` delete checks unchanged).
4. **Open a record's detail.** Admin clicks a Records row → detail panel opens; clicks `⋯` in the same row → quick actions (edit/delete) without opening the panel. Maps to: `records.spec.ts` row-click checks (testids/aria preserved).
5. **See consistent async states.** Initial load → 10-row skeleton (visible columns only) on all 8 pages; query failure → "Ошибка загрузки: …" + "Повторить" retry; zero rows → "Нет записей" (or `emptyLabel`). Maps to: loading/empty assertions in existing crud specs (intentional skeleton delta, §6.8).
6. **Operate the action menu by keyboard.** Admin focuses the `⋯` trigger, opens menu, navigates with ↑/↓, closes with Esc, focus returns to trigger. Maps to: a11y assertions added to the new DataTable unit suite (§8); e2e smoke in one crud spec if a stable hook exists.

## 6. Design

### 6.1 Component API — `<DataTable>`

```tsx
interface DataTableProps<T> {
  storageKey: string;                    // required, format '<entity>-columns'
  columns: ColumnDef<T>[];
  tableState: PagedListState<T>;         // interface, not hook return type
  actions: (row: T) => RowAction<T>[];
  onRowClick?: (row: T) => void;
  emptyLabel?: string;                   // default "Нет записей"
  toolbarExtras?: ReactNode;             // escape hatch (per-table extras)
  withStatus?: boolean;                  // render status filter; default false (DoD #2)
}
```

- DataTable renders: toolbar (ColumnPicker **always** + search input + conditional status filter + `toolbarExtras`), head (sortable buttons with `↕`), body (rows + action dropdown), skeleton/empty/error states, pager.
- DataTable owns: column-visibility state + localStorage persistence (read/write `storageKey`), dropdown open/close + outside-click + menu a11y, sort-header rendering, pager rendering.
- DataTable has **zero delete awareness**: no `onDelete`/`onEdit` seam; delete/edit are RowActions whose `onClick` the parent wires (e.g. open `DeleteDialog`).
- `onRowClick` ignores clicks originating from `button, a, [role="button"], input` inside cells — implemented ONCE in DataTable (not per-render closure).
- `withStatus: false` → status filter not rendered (Tags status-filter bug of DoD #2 cannot recur: TagsTable is server-paginated since #205 and its dead state is gone).

### 6.2 `ColumnDef<T>`

```tsx
interface ColumnDef<T> {
  key: string;                            // field identifier (matches sort field)
  label: string;                          // Russian header text
  defaultVisible: boolean;
  sortable?: boolean;                     // default true
  width?: string;
  align?: 'left' | 'right' | 'center';    // totals, counts
  render?: (row: T) => ReactNode;         // custom cell (client button, swatch, link, badge)
  accessor?: (row: T) => string | number; // default CELL renderer only (NOT sort — sort is server-side)
  sortField?: string;                     // server sort field if ≠ key (e.g. 'min_age' for 'age')
}
```

- `render` takes precedence over `accessor` when both present.
- Sort is server-side via `sortField ?? key`; `accessor` never participates in sorting.
- Column-config files are **factories** (closures capture parent callbacks): `recordsColumns({ onClientClick }): ColumnDef<Record>[]`.

### 6.3 `RowAction<T>` and dropdown ownership (Option A — inside DataTable)

```tsx
type RowAction<T> = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  hidden?: (row: T) => boolean;
  onClick: (row: T) => void;
};
```

- DataTable renders the dropdown from `actions(row)`; owns open/close, outside-click, `role="menu"`, `data-testid="dropdown-*"`, trigger `aria-label="Действия"`, `aria-haspopup="menu"`, `aria-expanded`.
- Parent opens `DeleteDialog` from the RowAction's `onClick` (DeleteDialog stays parent-owned).

### 6.4 State architecture (Approach 2)

- DataTable consumes `tableState: PagedListState<T>` directly — the return shape of `createPagedListContext<T>(config)`.
- `PagedListState<T>` must be an **exported interface** (so test fixtures and mock contexts type-check). Grounding: the factory already exports `PagedListContextValue<T>` (incl. `refetch`); the change is a **type alias** `export type PagedListState<T> = PagedListContextValue<T>` in `createPagedListContext.tsx`, re-exported from `tableTypes.ts`. No runtime change.
- Hand-rolled `ClientsContext` / `RecordsContext` must structurally satisfy `PagedListState<T>` (they already expose the same fields; Records gets the locked two-arg `setSort(field, order)`, §6.10).
- Parents wire ~5 props; zero wiring copy-paste.

### 6.5 ColumnPicker → controlled presentational

- New API: `{ columns, visibleKeys, onToggle }` — fully controlled; `storageKey` prop and the internal `localStorage` write are **deleted** (visibility state + persistence move up to DataTable). Consistent with the LS hard cut (§6.11).
- Shown **always**, even TagsTable with 1 column (uniformity).
- The last-visible-column checkbox is **disabled** (prevents an empty table with no way back).

### 6.6 File layout

```
app/components/shared/
├── DataTable.tsx              ← NEW
├── ColumnPicker.tsx           ← exists (78 ln), becomes controlled presentational
└── tableTypes.ts              ← NEW: ColumnDef<T>, RowAction<T>, PagedListState<T> (re-export)

contexts/
└── createPagedListContext.tsx ← exists (121 ln): + PagedListState<T> alias, + page-clamp, + search state (§6.7)

app/(main)/<entity>/components/
├── <Entity>Table.tsx          ← thin wrapper (wiring only, NO logic)
├── <entity>Columns.tsx        ← NEW camelCase (tagColumns.tsx, recordsColumns.tsx …):
│                                columns factory + actions factory
└── <Entity>Modal.tsx          ← exists, unchanged
```

- `materialsColumns.tsx` colocates in `services/components/` (no relocation).
- `DeleteDialog.tsx` stays at `app/components/DeleteDialog.tsx` (unchanged, parent-owned; see §12 note).
- Thin wrapper is enforced: `<Entity>Table.tsx` = `<DataTable storageKey columns tableState={useXTable()} actions onRowClick? />` — wiring only.

### 6.7 Data flow

```
createPagedListContext<T>(config)
  → React Query useQuery, key [entity, { page, perPage, status, search, sort }]
  → placeholderData: keepPreviousData
      (skeleton = isPending initial-load ONLY; rows persist during isFetching refetch)
  → get<Entity>({ page, per_page, status, search, sort_by, sort_order })
  → PaginatedResponse<T> = { items, total, page, per_page }
  → PagedListState<T> (incl. refetch)
  → <DataTable tableState={…}>
  → toolbar (ColumnPicker + search + conditional status) · head (↕ sort)
    · body (rows + action dropdown) · skeleton/empty/error · pager
```

- **Search mechanics (D3, locked):** debounce 300ms + Enter-to-submit-immediately. DataTable owns the input; `PagedListState` gains `search` / `setSearch`. Per-entity search **semantics unchanged**: dictionary tables keep client-side filtering over the loaded page (#205 G1b amendment Q1; server `?q=` is #212, out of scope); Clients/Records wire to their existing context search. The dict client-filter moves from table components into the factory as part of extraction.
- **No optimistic updates.** Parent calls `queryClient.invalidateQueries([entity])` on delete/archive/edit success → React Query refetches → DataTable does nothing.
- **Page-clamp:** `items.length === 0 && page > 1 && !isLoading` → `setPage(page - 1)` — implemented in the CONTEXT (factory + the two hand-rolled contexts), NOT in DataTable.

### 6.8 Loading / Error / Empty (unified)

| State | Condition | Render |
|---|---|---|
| Initial load | `isPending` | 10-row skeleton, visible columns only — **all 8 tables** (replaces "Загрузка..." ×6, shimmer ×1, none ×1) |
| Query failure | `error` | Error row: `Ошибка загрузки: {message}` + "Повторить" button → `tableState.refetch()`. Unified UX (today: silent empty/toast). No 4xx/5xx branching — retry is meaningful for network/5xx and harmless for 4xx |
| Empty | `items.length === 0 && !isPending && !error` | Empty row: `emptyLabel ?? "Нет записей"` |

### 6.9 Delete pattern (unified)

- Shared `DeleteDialog` + 409 dry-run pre-flight for all tables that delete: Locations, Masters, Materials, Services, Clients (existing) + **Records** (new, via the added dropdown).
- **Tags/Photos keep `window.confirm`** (locked) — their delete RowAction's `onClick` calls `window.confirm` in the parent.
- DataTable itself never knows what "delete" is.

### 6.10 Sorting & pagination unification (locked drift fixes — intentional behavior changes)

1. **Sort indicator:** neutral `↕` on all inactive sortable headers, all 8 tables (Clients today: arrow-only-when-active).
2. **Page-reset-on-sort:** ALL 8 reset page→1 on sort change (Records/Clients today don't — intentional change; factory contexts already do this; the two hand-rolled contexts gain `setPage(1)` in `setSort`). Toggle semantics locked: same field → flip order; new field → asc.
3. **Records `setSort(field)` → `setSort(field, order)`** (matches Clients/factory two-arg signature; internal toggle logic moves to the caller/DataTable contract).

### 6.11 localStorage keys — hard cut

- Single format: `<entity>-columns` (already true for 6/8). `services-column-visibility` and `materials-column-visibility` are **abandoned silently** (project not in prod — no migration code). Users of those two tables reset to `defaultVisible` once.
- Keys per entity: `tags-columns`, `locations-columns`, `masters-columns`, `materials-columns`, `services-columns`, `clients-columns`, `photos-columns`, `records-columns`.

### 6.12 Records table (variant B)

- Migrates to DataTable **and gains an action dropdown** (NEW, additive): `⋯` → quick actions (edit/delete).
- Detail panel **preserved** via `onRowClick`; row click → panel, `⋯` → actions. Both coexist.
- "Open detail" is `onRowClick` ONLY — NOT also a RowAction (no duplicate entry points).
- Record delete (new at table level) uses shared `DeleteDialog` + 409 dry-run (§6.9).

### 6.13 ClientCardModal disambiguation (variant A — rename, no merge)

- Records-version `ClientCardModal.tsx` (173 ln, read-only viewer) → **renamed to `ClientQuickCard`** (final name confirmed here; file + imports + test describe blocks updated).
- Clients-version `ClientCardModal.tsx` (286 ln, full editor) keeps its name.
- Merge of the two components is a follow-up issue, not #139.

### 6.14 Accessibility (in scope — DoD)

Dropdown moving into DataTable makes menu a11y shared mechanics:

- Arrow-key navigation + Esc in the action menu; focus returns to the trigger on close.
- Trigger: `aria-haspopup="menu"`, `aria-expanded`, `aria-label="Действия"`.
- Sort headers: keyboard-focusable `<button>` with `aria-sort`.
- Pager controls: labeled (`aria-label`).
- Screen-reader page announcements: follow-up issue (no gold-plating).

### 6.15 Performance / memoization contract

- The 8 instances never co-render (separate pages) — no cross-table concern.
- Contract: parents MUST `useMemo` the outputs of columns/actions factories; DataTable MUST NOT depend on referential stability (defensive rendering).
- 300ms debounce is sufficient; no virtualization in scope.

### 6.16 TypeScript rules

- `DataTable<T>` infers `T` from `tableState: PagedListState<T>` — works with `ColumnDef<T>` + `RowAction<T>`.
- Entity config files annotate **explicitly**: `ColumnDef<Tag>[]`, `(row: Tag) => RowAction<Tag>[]` — no inference cleverness (standalone factories degrade to `unknown`).
- `sortField: string` (type-safe field-key machinery not worth it).

## 7. Migration Order & Per-Table Template

**Order (locked):** Tags → Locations → Masters → Materials → Services → Clients → Photos → Records.

- Rationale: #206-blocked tables (Photos T7, Records T8) at the TAIL — six tables land before the #206 dependency is ever checked. T1–T6 merge regardless of #206; rollback is trivial.
- Per-table (stacked) PRs.
- **API freeze at design time:** the DataTable contract is validated against all 8 entity configs BEFORE T1. T1 is implementation start, not API discovery.

**Per-table template (4 steps):**

1. **Extract config** → create `<entity>Columns.tsx` (columns factory + actions factory).
2. **Thin the wrapper** → `<Entity>Table.tsx` = `<DataTable … />` wiring only.
3. **Update tests** → B2-audit intentional edits (§8); wiring/contract assertions stay on the real Provider.
4. **Verify** → unit suite green, e2e spec green, visual check vs baseline.

## 8. Testing Strategy (locked: additive — option b)

- **Per-entity suites STAY on the real Provider** (with B2 intentional edits). Do NOT rewrite to mocks.
- **New layer:** DataTable unit suite using a `makeTableState<T>({ items, total, isLoading, error, page, … })` fixture (spy setters, partial overrides) in `__tests__/helpers/`. Covers: skeleton/error/empty states, sort headers + `aria-sort`, column visibility + disabled last column, dropdown mechanics + a11y (arrows/Esc/focus return), `onRowClick` interactive-element filtering, pager.
- **Dedup** of duplicated mechanics assertions across per-entity suites → separate cleanup PR AFTER #139 IMPL.
- **B2 audit (grep before each migration):** categories of intentional per-suite edits:
  1. `window.confirm` assertions (Tags/Photos — kept, but invocation path changes to RowAction).
  2. Old LS keys (`services-column-visibility`, `materials-column-visibility`).
  3. Old sort glyph (Clients no-`↕` assertions).
  4. Old loading assertions ("Загрузка..." ×6 suites) → 10-row skeleton.
  5. Records/Clients page-reset-on-sort behavior.
  6. Records sort-toggle sequences (`setSort(field)` single-arg → two-arg).
  7. Records button/row-count queries (new dropdown column shifts cell indexes).
  - Exhaustive per-suite line edits = plan level, not spec.
- Context tests keep `createMock*Context` helpers (different level — fetch mapping/state transitions, not rendering).
- **E2E specs: unchanged** — testids/aria-labels preserved: `page-size-select`, `dropdown-*`, `Настроить колонки`, `Действия`, `tag-row-*`.

## 9. Visual Gate (G4.5)

- Capture baselines for **all 8 tables BEFORE T1** (states: skeleton / filled / empty / error / dropdown-open).
- Visual diff after each migration task Ti.
- Pass = parity EXCEPT locked intentional deltas: 10-row skeleton everywhere, `↕` on Clients, DeleteDialog path unchanged for Tags/Photos (`window.confirm` kept), Clients action-dropdown presentation, Records new dropdown column.
- Full pass after T8.

## 10. Visual Compliance Checks

- [ ] All 8 entity pages render `<DataTable>` (thin wrappers; no per-table mechanics remain).
- [ ] ColumnPicker ("Настроить колонки") visible on ALL 8 pages, including Tags (1 column).
- [ ] ColumnPicker: last visible column's checkbox is disabled.
- [ ] Initial load shows a 10-row skeleton (visible columns only) on all 8 pages.
- [ ] Query failure shows "Ошибка загрузки: …" + "Повторить" button; clicking retry refetches.
- [ ] Empty result shows "Нет записей" (or `emptyLabel`).
- [ ] Inactive sortable headers show neutral `↕` on all 8 pages (incl. Clients); active header shows ↑/↓ with `aria-sort`.
- [ ] Sort change resets the pager to page 1 on all 8 pages (incl. Records/Clients).
- [ ] Row `⋯` trigger has `aria-label="Действия"`, `aria-haspopup="menu"`; menu has `role="menu"`, `data-testid="dropdown-*"`; Esc closes and returns focus.
- [ ] Delete via menu opens shared DeleteDialog (Locations/Masters/Materials/Services/Clients/Records); Tags/Photos still use `window.confirm`.
- [ ] Records: row click opens the detail panel; `⋯` opens quick actions; no "open detail" menu item.
- [ ] Column visibility persists across reload under `<entity>-columns` keys (old `*-column-visibility` keys gone).
- [ ] Pager controls (incl. `page-size-select`) have labels and work on all 8 pages.

## 11. Definition of Done (from issue #139)

1. **"Общая механика живёт в одном месте, per-entity код — только колонки/ячейки/действия"** → `<DataTable>` in `shared/` owns all mechanics; `<entity>Columns.tsx` contains only `ColumnDef[]` + `RowAction[]` factories; `<Entity>Table.tsx` is a wiring-only thin wrapper.
2. **"Баг с фильтром статуса в TagsTable устранён"** → already satisfied structurally: TagsTable is server-paginated (#205), dead state gone; DataTable `withStatus: false` does not render a status filter — the bug cannot recur.
3. **"Существующие unit- и e2e-тесты CRUD-страниц зелёные"** → additive strategy: per-entity suites green (with B2 intentional edits), new DataTable unit suite as an added layer, E2E unchanged.

## 12. Grounding Adjustments & Notes (code facts vs. concept wording)

Non-decision documentation fixes found during 2026-08-18 grounding (no locked decision changed):

1. `createPagedListContext` **already exports** `PagedListContextValue<T>` incl. `refetch` — the "typing/export change" reduces to adding the `PagedListState<T>` alias (§6.4).
2. ColumnPicker is already prop-controlled for columns/visibility but **owns the LS write** — the conversion removes `storageKey` + the internal write (§6.5).
3. `DeleteDialog.tsx` lives at `app/components/DeleteDialog.tsx`, not `shared/` — it stays there (no relocation, consistent with the materialsColumns no-move rule); the §6.6 tree reflects this.
4. LS keys: 6/8 already use `<entity>-columns`; only Services + Materials drift (§6.11).
5. Clients/Records contexts are hand-rolled (not factory) — they must satisfy `PagedListState<T>` structurally and gain page-clamp + page-reset-on-sort + (Records) two-arg `setSort` (§6.4, §6.10).
6. Records table has no delete UX today; the delete RowAction is new (part of variant B dropdown).
7. Search state is not currently in the factory — `search`/`setSearch` is added to `PagedListState` and the dict client-filter moves into the factory; semantics per entity unchanged (§6.7).
8. `withStatus` prop added to the DataTableProps list — it is required by locked DoD #2 wording (§6.1).
9. Measured table total is 3897 lines (issue says "~3500").

## 13. Risks / Open Questions

| Risk | Mitigation |
|---|---|
| Photos/Records migration blocked on #206 | Locked order puts them T7/T8; T1–T6 merge independently |
| Per-entity test suites break in non-obvious spots | B2 audit grep categories (§8) before each migration; per-table PRs keep blast radius small |
| Records new dropdown column shifts cell indexes in tests | B2 category 7; plan-level per-suite line edits |
| Hand-rolled Clients/Records contexts drift from `PagedListState<T>` | Structural typing + context tests; interface is the contract |
| Visual regressions in 8 pages | Baselines before T1 + diff after each Ti (§9) |

No open questions — all design decisions were locked at G1a.
