# GH #214 — Searchable Combobox for Dictionary Dropdowns (client-side filter over /all)

- **Issue:** #214 — Searchable combobox для дропдаунов справочников
- **Date:** 2026-09-03
- **Status:** DESIGN — awaiting G1b
- **Depends on:** #205 (bare `/all` endpoints — merged, feeds the combobox arrays), #212 (server `?q=` — merged; separate mechanism, see §9)
- **G1a concept:** approved 2026-09-03 (locked — this spec refines it, does not re-open it)

---

## 1. Problem

Dictionary dropdowns in forms and filter bars are full lists with no search. With 90 masters, finding the right entry by scrolling is painful. All dictionary data is already fully loaded client-side (bare `/all` arrays from #205), so filtering can and should happen locally — instant, no server round-trip.

**User scenario:** admin creates a record → opens the master dropdown → wants to find the master by typing part of the name/surname.

## 2. Goals

1. New shared `Combobox` component: client-side instant filter over an in-memory options array.
2. Migrate every in-scope dictionary dropdown (§6) to `Combobox` / `MasterPicker`.
3. Rename `SearchableSelect` → `RemoteSearchSelect` to make the two select mechanisms distinguishable.
4. Delete `CustomSelect` (all consumers are in scope — hard cut, pre-production policy).
5. Unify the master display label across all dropdowns to «Фамилия Имя» (`displayMasterName`).

## 3. Non-Goals (locked at G1a)

- **Tariff dropdowns** (ActivityDetailsModal/NewBookingTab, ActivityDetailsModal tariffs) — short per-service lists, YAGNI.
- **Topbar `MultiSelect`** (schedule filters) — multi-select, different interaction model.
- **Static enum selects** (channel telegram/max/whatsapp, statuses via StatusFiltersPicker/StatusPicker) — tiny fixed lists.
- **Table search fields** — server `?q=` mechanism (#212), already delivered.
- **PhotoModal server typeaheads** (client/activity/service/tags via `SearchableSelect`→`RemoteSearchSelect`) — growing entities, server search is correct there.
- **StampPanel location checkboxes** — not a dropdown.
- **New server endpoints / API changes** — none. Pure frontend feature.
- **#221 phone-partial typeahead** — future consumer of this work, not included.

## 4. Component Landscape

### 4.1 NEW: `app/components/shared/Combobox.tsx`

Client-side searchable dropdown. Absorbs `CustomSelect`'s option shape and visual language (color swatch, icon, chevron trigger). The project has no `ui/` directory — the codebase convention for shared controls is `app/components/shared/` (CustomSelect, SearchableSelect, MasterPicker, StatusPicker, ColumnPicker all live there), so Combobox goes there too (the issue body's "(ui/)" sketch maps onto `shared/`).

### 4.2 RENAME: `SearchableSelect` → `RemoteSearchSelect`

`git mv app/components/shared/SearchableSelect.tsx → RemoteSearchSelect.tsx`; rename the default export and `SearchableSelectProps` → `RemoteSearchSelectProps`; `git mv __tests__/SearchableSelect.test.tsx → RemoteSearchSelect.test.tsx`. Update imports and name references in exactly: `PhotoModal.tsx` (3 usages), `PhotosFilters.tsx` (3 usages), `PhotosFilters.test.tsx` (comment references). **Behavior UNTOUCHED** — it stays the server-coupled typeahead (300 ms debounce + min-2 clamp are its distinguishing semantics vs Combobox's instant local filter). No other file imports it (verified by grep).

### 4.3 DELETE: `CustomSelect` — consumer inventory (verified by repo-wide grep)

Production-code consumers of `CustomSelect` — complete list:

| Consumer | File | In #214 scope? |
|---|---|---|
| `MasterPicker` | `app/components/shared/MasterPicker.tsx` | ✅ internals switch to Combobox |
| `ClientRecordTab` (location, service) | `app/(main)/clients/components/ClientRecordTab.tsx` | ✅ migrates to Combobox |
| *(component itself)* | `app/components/shared/CustomSelect.tsx` | deleted |

**No out-of-scope production consumer exists** — not DataTable page-size, not StatusPicker/StatusFiltersPicker, not FilterDropdown (each is an independent implementation; verified by repo-wide grep for the import path and `custom-select` testids). Decision per G1a + pre-production policy: **hard delete** `CustomSelect.tsx` and `__tests__/CustomSelect.test.tsx`. No follow-up needed.

Files referencing `custom-select-*` testids that must be updated (complete list from grep):

- `__tests__/MasterPicker.test.tsx` — testids → `combobox-*`
- `__tests__/ClientRecordTab.layout.test.tsx:179-182` — testids → `combobox-*`
- `__tests__/ClientsIntegration.test.tsx:417-418` — comment + trigger testid
- `__tests__/ActivityDetailsModal.test.tsx:250,257,723-753` — MasterPicker trigger/dropdown/option testids + color-swatch assertions (`data-color` attribute must survive in Combobox)
- `e2e/clients.spec.ts:472-484` — `custom-select-trigger` inside `select-service`/`select-master`/`select-location` wrappers
- `e2e/activity-details-modal.spec.ts:339-341` — `settings-tab` master trigger
- `e2e/wave6-record-status-derived.spec.ts:33` — comment only ("either native `<select>` or CustomSelect") — update comment
- `e2e/wave6-status-snapshots.spec.ts:75` — builds its **own inline HTML** with `custom-select-option-*` testids for a self-contained snapshot page; **no dependency on the real component — left untouched**

## 5. Combobox Contract

```ts
export interface ComboboxOption {
  value: string;              // entity id
  label: string;              // display label
  searchText?: string;        // filter haystack; default: label
  icon?: React.ReactNode;     // rendered colored via `color` (CustomSelect parity)
  color?: string;             // renders the 3×3 swatch (see §5.3)
}

export interface ComboboxProps {
  value: string | null;                 // null = nothing selected
  options: ComboboxOption[];
  onChange: (value: string | null) => void;  // null emitted only via the clear option
  allowClear?: boolean;                 // renders the clear option pinned first
  clearLabel?: string;                  // default: 'Не выбран'
  emptyText?: string;                   // default: 'Ничего не найдено'
  placeholder?: string;                 // search input placeholder, default: 'Поиск...'
  disabled?: boolean;
  className?: string;                   // applied to the trigger (CustomSelect parity)
}
```

Contract notes:

- `value: string | null` / `onChange(string | null)` per the locked G1a concept. Consumers whose form state uses the `''` sentinel adapt at the call site: `value={id || null}` / `onChange={(v) => setId(v ?? '')}`. `MasterPicker` does the same mapping internally so its external API stays `value: string; onChange: (value: string) => void` with `''` = «Не выбран» — **byte-compatible with today**.
- The clear option is a **synthetic pinned option** (testid `combobox-option-clear`), always visible at the top of the dropdown regardless of the active query, emitting `onChange(null)`. It is not filtered, not highlight-targetable out of turn (ArrowDown from search input lands on it first when present).
- `CustomSelect`'s `iconOnly` prop has **zero consumers** (verified) and is dropped with the deletion.

### 5.1 Filtering semantics (locked at G1a)

- **Instant:** filtering happens synchronously in render — NO debounce, NO minimum query length. Active from the first typed character.
- **Match rule:** case-insensitive **substring anywhere in the haystack**. Query is trimmed + lowercased; haystack = `(option.searchText ?? option.label).toLowerCase()`. This makes either word of a multi-word haystack findable regardless of order (typing «иванова» or «анна» both find «Анна Иванова»).
- Empty query → all options. The `searchText` override lets consumers pack extra fields (e.g. `short_title`, `shortName`) into the haystack without touching the label.
- **Search input is always visible** at the top of the open dropdown. Query resets to `''` when the dropdown closes (reopening starts from the full list).
- Zero visible options (excluding the pinned clear option) → non-interactive `emptyText` row (testid `combobox-empty`).

### 5.2 Dropdown behavior

- Trigger = `<button type="button">` (CustomSelect visual parity: selected `icon` colored via `style={{color}}`, color swatch, label, chevron SVG). Trigger shows `clearLabel` when `value === null && allowClear`, otherwise `selected?.label ?? '—'`.
- Open/close: trigger click toggles; outside-`mousedown` closes (CustomSelect pattern); selecting an option closes.
- Opening moves focus into the search input; `Esc` closes and **returns focus to the trigger**; value unchanged on Esc.

### 5.3 Rendering parity requirements (absorbed from CustomSelect)

- Color swatch: `<span data-color={color} className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />` — in trigger (selected option) and in every matching option row. **`data-color` must survive** — `ActivityDetailsModal.test.tsx:753` asserts swatch rendering for MasterPicker options.
- Icon: `<span style={{ color: option.color }}>{option.icon}</span>` before the label when present.
- Selected option row highlighted (`bg-gray-100`), hover `hover:bg-gray-50`, same paddings/typography as CustomSelect rows.
- Dropdown panel: `absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg` (CustomSelect styling) + search input row on top (`px-3 py-2 border-b`, `text-sm`, full width, `type="text"`).

### 5.4 Accessibility (bar set by #139 ColumnPicker — same contract)

- Trigger: `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` → listbox id.
- Dropdown: `role="listbox"`; each option `role="option"` + `aria-selected`; clear option included.
- Search input: `aria-label="Поиск"`, `aria-controls` → listbox id, `aria-activedescendant` → highlighted option id.
- Keyboard: `ArrowDown`/`ArrowUp` move highlight among visible options (wrapping; clear option participates when present); `Home`/`End` first/last; `Enter` selects the highlighted option (closes, emits); `Escape` closes without change, focus → trigger; click selects. Typing in the search input resets highlight to the first visible option.
- Works as a plain dropdown without typing: open → click an option. All of the above is exercised by the unit suite (§8.1) — no screen-reader announcements beyond `aria-activedescendant` (out of scope, same as #139).

### 5.5 Testids

`combobox-trigger` · `combobox-dropdown` · `combobox-search` · `combobox-option-{value}` · `combobox-option-clear` · `combobox-empty`.

## 6. Surface Migration (scope LOCKED at G1a)

Data semantics per surface do **not** change: the same queries, keys, archived filtering (or its absence) stay exactly as today. Only the control changes.

| # | Surface | Field | Today | After | Copy (clearLabel) |
|---|---|---|---|---|---|
| 1 | ClientRecordTab | location | `CustomSelect`, raw `useRecordData` (`['locations']`→`getAllLocations`), label `l.name`, «Не выбрана» | `Combobox` | «Не выбрана» |
| 2 | ClientRecordTab | service | `CustomSelect`, raw (`['services']`→`getAllServices`), label `s.title`, «Не выбрана» | `Combobox` | «Не выбрана» |
| 3 | ClientRecordTab | master | `MasterPicker` (CustomSelect), raw masters | `MasterPicker` — external API unchanged, internals → Combobox | «Не выбран» |
| 4 | SettingsTab (ActivityDetailsModal) | service | native `<select data-testid="select-service">`, domain `useSchedule()` services, label `s.name`, «Выберите» | `Combobox` | «Выберите» |
| 5 | SettingsTab | location | native `<select data-testid="select-location">`, domain locations, label `l.name`, «Выберите» | `Combobox` | «Выберите» |
| 6 | SettingsTab | master | `MasterPicker`, domain masters | unchanged externally | «Не выбран» |
| 7 | StampPanel | master | **native** `<select id="stamp-master">` (verified — CustomSelect claim in explore was wrong), domain masters, label `a.shortName`, «Выберите мастера» | **route through `MasterPicker`** (unification per G1a) | «Не выбран» (copy change, see below) |
| 8 | StampPanel | service | native `<select id="stamp-service">`, domain services, label `s.name`, «Выберите услугу» | `Combobox` | «Выберите услугу» |
| 9 | PhotoModal | location | native `<select>` in the generic `field.type === 'select'` renderer, raw `['locations']`→`getAllLocations` (cache-hit), label `l.name`, `field.emptyLabel` | `Combobox` with `clearLabel={field.emptyLabel}` | field config (unchanged) |
| 10 | BookingFilters (records) | location | native `<select aria-label="Фильтр по локации">`, raw own `useQuery` canonical keys + `!archived` filter, label `l.name`, «Все локации» | `Combobox` | «Все локации» |
| 11 | BookingFilters | service | native `<select aria-label="Фильтр по услуге">`, raw + `!archived`, label `s.title`, «Все услуги» | `Combobox` | «Все услуги» |
| 12 | BookingFilters | master | native `<select aria-label="Фильтр по мастеру">`, raw + `!archived`, label `m.first_name` ⚠️, «Все мастера» | `Combobox`, label `displayMasterName(m)`, swatch from `m.color` | «Все мастера» |

Notes:

- **StampPanel master (row 7):** label changes `shortName` («Анна») → MasterPicker's «Фамилия Имя», and empty-option copy «Выберите мастера» → «Не выбран». Both are intended unification consequences of routing through MasterPicker (G1a decision), consistent with rows 3/6. The summary line at StampPanel.tsx:164 (`selectedMaster?.shortName`) keeps working — it reads from the masters array, not from the select.
- **BookingFilters master (row 12) does NOT route through MasterPicker:** MasterPicker's external API is frozen («Не выбран» hardcoded), while the filter bar needs «Все мастера». Direct `Combobox` with `color: m.color` preserves the swatch. Label unifies from `m.first_name` to `displayMasterName(m)`.
- **BookingFilters search input + StatusFiltersPicker + date inputs are untouched** — only the three dictionary selects swap.
- Archived data: BookingFilters keeps its own `!archived` filters; ClientRecordTab/PhotoModal keep showing everything `/all` returns (no filter added — not a behavior change of this feature; `useSchedule` domain arrays are already archived-stripped by transformers).
- Wrapper testids (`select-service`, `select-master`, `select-location`, `settings-tab`, `stamp-master` label/`for` wiring) stay; only the inner control changes. `aria-label`s «Фильтр по …» move onto the Combobox trigger (needed by updated e2e, §8.3).

### 6.1 Master label unification (spec decision, manager-flagged)

Today three formats coexist: MasterPicker raw «Имя Фамилия», domain `name` «Фамилия Имя» (= `displayMasterName`, `lib/utils.ts:4` — the same string the records view backend produces byte-identically, `docs/domain-rules/records.md:218`), BookingFilters `first_name` only. **Convention: «Фамилия Имя» via `displayMasterName` everywhere.**

- `MasterPicker.getMasterLabel`: raw masters → `displayMasterName(m)` (was `${first_name} ${last_name}`); domain masters → `m.name` (already the same format). This is the only MasterPicker behavior change; its props/types are untouched.
- BookingFilters master options → `displayMasterName(m)` (row 12).
- `docs/domain-rules/masters.md` gets a one-line addendum in this feature (dropdown display = `displayMasterName`, «Фамилия Имя»; it already references the #214 combobox mechanism).

### 6.2 Search-field matrix

| Entity | Source | label | searchText |
|---|---|---|---|
| Master (raw `MasterResponse`) | MasterPicker, BookingFilters | `displayMasterName(m)` | `` `${first_name} ${last_name}` `` |
| Master (domain `Master`) | MasterPicker (SettingsTab, StampPanel) | `m.name` | `` m.shortName ? `${m.name} ${m.shortName}` : m.name `` |
| Service (raw `ServiceResponse`) | ClientRecordTab, BookingFilters | `s.title` | default (label) |
| Service (domain `Service`) | SettingsTab, StampPanel | `s.name` | default (label) |
| Location (raw `LocationResponse`) | ClientRecordTab, PhotoModal, BookingFilters | `l.name` | `` `${l.name} ${l.short_title ?? ''}`.trim() `` |
| Location (domain `Location`) | SettingsTab | `l.name` | `` l.shortTitle ? `${l.name} ${l.shortTitle}` : l.name `` |

Substring-anywhere matching (§5.1) + these haystacks deliver the G1a requirement "search by first_name+last_name, either word order" for a single typed word in any position.

## 7. What each consumer change looks like

- **ClientRecordTab:** `locationOptions`/`serviceOptions` drop the manual `{value:'',label:'Не выбрана'}` head and become plain maps → `<Combobox allowClear clearLabel="Не выбрана" value={locationId || null} onChange={(v) => { setLocationId(v ?? ''); markChanged(); }} … />` (same for service). MasterPicker call unchanged.
- **SettingsTab:** two native selects → Combobox with `clearLabel="Выберите"`; `value`/`onChange` adapter as above (`setId(v ?? '')` + existing `onUpdate` side-effect preserved).
- **StampPanel:** master native select → `<MasterPicker masters={masters} value={stamp.masterId} onChange={handleMasterChange} className={…}/>`; service native select → Combobox `clearLabel="Выберите услугу"`. Labels `htmlFor` wiring: the label currently points at `select#stamp-master`; after migration the `htmlFor` points at nothing native — acceptable (Combobox trigger gets `aria-label="Мастер"`/`"Услуга"`; same pattern ClientRecordTab already uses for its unlabeled wrappers).
- **PhotoModal:** inside the `field.type === 'select'` renderer, replace `<select>` with `<Combobox allowClear clearLabel={field.emptyLabel} placeholder="Поиск..." options={selectOptions} value={(value as string) ?? null} onChange={(v) => onChange(field.key, v ?? '')} />` — the existing `onChange(field.key, e.target.value || null)` already maps `'' → null`, so the null-contract is native here. Tags/client/activity typeaheads untouched apart from the rename (§4.2).
- **BookingFilters:** three native selects → Combobox; `locationList/serviceList/masterList` (`!archived`) become option arrays per §6.2; `onLocationChange(v ?? '')` etc. adapters. Query keys/`staleTime`/`!archived` untouched.
- **MasterPicker:** swap `CustomSelect` for `Combobox` internally: options lose the manual «Не выбран» head; `<Combobox allowClear value={value || null} onChange={(v) => onChange(v ?? '')} options={masters.map(…)} className={className}/>`.

## 8. Testing

### 8.1 New unit suite: `__tests__/Combobox.test.tsx`

Mirrors `SearchableSelect.test.tsx` structure (render helper + overrides) but with **NO fake timers** (no debounce to advance). Cases:

1. Renders trigger with selected label; `—` when `value={null}` without allowClear; `clearLabel` when null with allowClear.
2. Color swatch + `data-color` on trigger and option rows; icon rendered with color.
3. Opens on click; search input visible + focused; all options listed; closes on outside mousedown; closes on option select.
4. Typing filters instantly (case-insensitive substring, e.g. «ИВА» finds «Анна Иванова»); `searchText` override wins over label; query reset after close+reopen.
5. Empty result → `combobox-empty` with default/custom `emptyText`; clear option still visible.
6. `allowClear`: clear option pinned first (`combobox-option-clear`); selecting it emits `onChange(null)` and closes.
7. Keyboard: ArrowDown/Up move highlight (wrap, clear option first); Home/End; Enter selects highlighted; Esc closes + focus on trigger + value unchanged.
8. `disabled` — no open, trigger `disabled`.
9. Works as plain dropdown with no typing (click-only path).

### 8.2 Updated unit suites

- `MasterPicker.test.tsx` — testids `custom-select-*` → `combobox-*`; raw-shape label now «Фамилия Имя»; search by last name finds master (raw + domain shapes); «Не выбран» → `onChange('')`; swatch preserved.
- `ClientRecordTab.layout.test.tsx` — trigger testids; add one search-filters-services assertion.
- `ClientsIntegration.test.tsx` — trigger testid only.
- `ActivityDetailsModal.test.tsx` — MasterPicker testids; existing swatch assertions keep passing via `data-color`.
- `BookingFilters.test.tsx` — select interactions → open/type/click Combobox flow; master options now «Фамилия Имя»; keep raw-fetcher mocks + archived-excluded assertions (find by role option, 10s window — existing pattern).
- PhotoModal suite — location field now Combobox: open/type/select + `field.emptyLabel` as clear label; owner typeaheads untouched (rename only).
- StampPanel suite (if present; plan inventories) — master via MasterPicker testids, service Combobox, label shortName→name expectations updated.
- DELETE `CustomSelect.test.tsx`.

### 8.3 E2E

New spec `e2e/combobox-dictionaries.spec.ts` — the six User Scenarios (§10). Updated existing specs:

- `records.spec.ts` tests 4–5: native `select[aria-label="Фильтр по …"]` locators → Combobox flow (trigger `aria-label` assertions + open + count `combobox-option-*`); master option labels «Фамилия Имя».
- `clients.spec.ts:472-484` — `custom-select-trigger` → `combobox-trigger` inside the same wrappers.
- `activity-details-modal.spec.ts:339-341` — master trigger testid.
- Visual baselines: trigger markup stays visually identical to CustomSelect; dropdown gains the search row. If any affected dropdown-open baselines exist, regenerate via the CI `update-snapshots` workflow (project standard, `docs/tests_workflow.md`).

## 9. Mechanism boundary (restated from #205 G1b matrix)

| Dropdown kind | Mechanism | Component |
|---|---|---|
| Dictionary form dropdowns (static-ish, dozens of entries, fully loaded) | client filter over `/all` | **Combobox (this feature)** |
| Growing-entity pickers (clients, activities, tags) | server `?q=` typeahead, debounce 300 ms, min 2 chars | `RemoteSearchSelect` (renamed here) |
| Table search fields | server `?q=` per list endpoint | DataTable/`*Filters` (delivered #212) |
| Static enums / statuses | plain list, no search | native select / StatusPickers |

## 10. User Scenarios (→ E2E `combobox-dictionaries.spec.ts`)

| US | Scenario | Steps (e2e) |
|---|---|---|
| US-1 | Create record → find master by typing | Open clients page → client with records → record tab → open master dropdown (`select-master` wrapper `combobox-trigger`) → type surname fragment → only matching masters listed (`combobox-option-*`, «Фамилия Имя» labels) → select → trigger shows the master → save flow unaffected |
| US-2 | Activity settings → find service | Schedule → activity → Settings tab → open service Combobox (`select-service`) → type title fragment → select → capacity/age recalc still works |
| US-3 | Records filter bar → find location & master | Records page → BookingFilters → open location Combobox → type → select → table filters → repeat for master (type surname, swatch rendered on option) → reset restores «Все …» |
| US-4 | PhotoModal location | Photos → open photo modal → location Combobox → type → select → saved photo carries the location |
| US-5 | Stamps master | Stamps panel → master dropdown (now MasterPicker) → type surname → select («Фамилия Имя») → summary line updates |
| US-6 | No-match empty state + Esc + value preserved | Any surface (use US-1's master dropdown): type `zzzz` → «Ничего не найдено» (`combobox-empty`) → Esc → dropdown closed, previous value intact, focus on trigger → reopen → query cleared, full list |

## 11. Visual Compliance Checks (G4.5 checklist)

- [ ] ClientRecordTab: master/service/location triggers render as before (label + chevron; master keeps color swatch)
- [ ] Combobox dropdown: search input visible at top, options below, selected row highlighted
- [ ] Master options render color swatches in dropdown (ClientRecordTab, SettingsTab, StampPanel, BookingFilters)
- [ ] Empty search result shows «Ничего не найдено»
- [ ] BookingFilters bar layout unchanged (three Comboboxes same footprint as native selects; «Все локации/услуги/мастера» copy)
- [ ] StampPanel: master select now MasterPicker («Фамилия Имя» + swatch), service select searchable, page layout intact
- [ ] PhotoModal location field searchable, modal layout intact
- [ ] SettingsTab service/location searchable, «Выберите» empty label preserved
- [ ] Keyboard-only pass: open/type/arrow/Enter/Esc on at least one surface

## 12. Acceptance Criteria

1. `Combobox` exists in `app/components/shared/` with the §5 contract, a11y per §5.4, testids per §5.5, and a passing unit suite (§8.1) — no fake timers.
2. All 12 migration rows of §6 are implemented; data fetching/archived semantics unchanged per surface.
3. `CustomSelect.tsx` + `CustomSelect.test.tsx` deleted; no references to `custom-select` testids or the import path remain in app code or tests (except the self-contained `wave6-status-snapshots.spec.ts` inline HTML).
4. `SearchableSelect` renamed to `RemoteSearchSelect` everywhere (component, props, file, test file, imports, comments); zero behavior diff (its suite passes unedited apart from names).
5. Master labels unified to «Фамилия Имя» (`displayMasterName`) in MasterPicker (raw shape), BookingFilters, StampPanel (via MasterPicker); `docs/domain-rules/masters.md` addendum landed.
6. E2E `combobox-dictionaries.spec.ts` covers US-1…US-6 green; `records.spec.ts` 4–5, `clients.spec.ts`, `activity-details-modal.spec.ts` updated and green; full vitest suite + tsc + lint green.
7. No new API endpoints, no api-client changes, no LS keys touched.

## 13. Risks & Decisions

- **Trigger visual parity** keeps visual baselines stable; dropdown-open baselines (if any cover these surfaces) regenerate via CI workflow — known, cheap.
- **`null` vs `''`**: contract is null-based (G1a); every consumer keeps its `''`-sentinel state via a one-line adapter (§7). Pre-production: no compat layer warranted.
- **StampPanel copy/label change** (rows 7) is the only user-visible copy change — intended unification, flagged in §6.
- **Typing Cyrillic**: lowercase via `toLowerCase()` is sufficient for Russian (no Turkish-i style edge); #212 already relies on the same client-side assumption.
- **Option count growth**: 90 masters filter instantly in memory; Combobox renders all matches (no virtualization — YAGNI, revisited if dictionaries exceed ~500 entries).
