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

`git mv app/components/shared/SearchableSelect.tsx → RemoteSearchSelect.tsx`; rename the default export and `SearchableSelectProps` → `RemoteSearchSelectProps`; `git mv __tests__/SearchableSelect.test.tsx → RemoteSearchSelect.test.tsx`. Update imports and name references in exactly: `PhotoModal.tsx` (2 JSX usages: tags typeahead `:104`, searchable-field typeahead `:151`), `PhotosFilters.tsx` (3 usages), `PhotosFilters.test.tsx` (comment references). **Behavior UNTOUCHED** — it stays the server-coupled typeahead (300 ms debounce + min-2 clamp are its distinguishing semantics vs Combobox's instant local filter). No other file imports it (verified by grep).

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
- `__tests__/ActivityDetailsModal.test.tsx:250,257,723-757` — MasterPicker trigger/dropdown/option testids + color-swatch assertions (the `querySelectorAll('[data-color]')` block at `:754` must keep passing — `data-color` survives in Combobox)
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
  color?: string;             // renders the 3×3 swatch (see §5.3)
}

export interface ComboboxProps {
  value: string;                        // '' = cleared (codebase sentinel convention)
  options: ComboboxOption[];
  onChange: (value: string) => void;    // '' emitted only via the clear option
  clearLabel: string;                   // required — the pinned clear option's label («Не выбран»/«Все …»/…)
  className?: string;                   // applied to the trigger (CustomSelect parity)
}
```

Contract notes:

- **`''`-based value contract** (simplification-panel finding, adopted): every in-scope consumer's state already uses the `''` sentinel (ClientRecordTab, SettingsTab, BookingFilters, MasterPicker's public API), PhotosFilters uses `undefined` (one trivial `?? ''`), PhotoModal already maps `'' ↔ null` at its boundary today. The G1a sketch wrote `onChange(value|null)` — the intent (a first-class clear action) is fully preserved by emitting `''` from the pinned clear option, while `value: string` makes `MasterPicker` a pure pass-through (zero adapters at 6 of 7 consumer groups, no null/'' duality to maintain). If the user prefers the literal null contract, it is a mechanical swap — flagged at G1b.
- The clear option is a **synthetic pinned option** (`value: ''`, testid `combobox-option-clear`), always rendered at the top of the dropdown regardless of the active query, emitting `onChange('')`. It is not filtered. After typing, the auto-reset highlight lands on the first **filtered** match (clear option excluded); explicit ArrowDown/Up navigation cycles clear + filtered options in visual order. This pinned-row pattern (vs. a library-style × affordance on the trigger) is a deliberate G1a choice: it preserves the current «Не выбран»-as-option UX of every surface and the CustomSelect trigger look. `clearLabel` is required because every one of the 14 migration rows carries site-specific empty copy (§6).
- **Degenerate inputs:** `value` pointing at an id absent from `options` (e.g. archived entity) → trigger shows `—` (CustomSelect parity), no crash. `options: []` → trigger stays interactive; open dropdown shows only the clear option and the empty state. Options are assumed **unique by `value`** (caller contract); duplicate values render both rows but behavior is unspecified — surfaces build options from keyed maps/lists, so this cannot occur in practice. If `options` changes while open (refetch), filtering re-runs over the new array and the highlight re-clamps to the first visible option if its target disappeared; an already-selected value is untouched.
- **Dropped as dead weight** (simplicity review — zero consumers among all 14 rows, same call as `iconOnly`): `icon` on options, `placeholder` (hardcode «Поиск...»), `emptyText` (hardcode «Ничего не найдено»), `disabled`, `allowClear` (subsumed by required `clearLabel`). Re-add on first real consumer.
- `CustomSelect`'s `iconOnly` prop has **zero consumers** (verified) and is dropped with the deletion.

### 5.1 Filtering semantics (locked at G1a)

- **Instant:** filtering happens synchronously in render — NO debounce, NO minimum query length. Active from the first typed character.
- **Match rule:** case-insensitive **substring anywhere in the haystack**. Query is trimmed + lowercased; haystack = `(option.searchText ?? option.label).toLowerCase()`. This makes either word of a multi-word haystack findable regardless of order (typing «иванова» or «анна» both find «Анна Иванова»).
- Empty or whitespace-only query (trimmed to `''`) → all options. The `searchText` override lets consumers pack extra fields (e.g. `short_title`, `shortName`) into the haystack without touching the label.
- **Search input is always visible** at the top of the open dropdown. Query resets to `''` when the dropdown closes (reopening starts from the full list).
- Zero visible options (excluding the pinned clear option) → non-interactive «Ничего не найдено» row (testid `combobox-empty`).

### 5.2 Dropdown behavior

- Trigger = `<button type="button">` (CustomSelect visual parity: selected color swatch, label, chevron SVG). Trigger shows `clearLabel` when `value === ''`, otherwise `selected?.label ?? '—'`.
- Open/close: trigger click toggles; outside-`mousedown` closes (CustomSelect pattern); selecting an option closes.
- **Close semantics:** closing (outside click, Esc, or option select) **discards the pending query** — the selected value changes ONLY via an explicit selection (Enter / click / Tab-commit). No custom values can be committed by typing.
- Opening moves focus into the search input; `Esc` closes and **returns focus to the trigger**; value unchanged on Esc. While the dropdown is open, Combobox **stops propagation** of the keydown events it consumes (Esc/Enter/Tab/Arrows) — host modals listen for Esc at `window` level (e.g. `PhotoModal.tsx:348-354` closes the whole modal) and must not receive it (feasibility-panel finding).

### 5.3 Rendering parity requirements (absorbed from CustomSelect)

- Color swatch: `<span data-color={color} className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />` — in trigger (selected option) and in every matching option row. **`data-color` must survive** — `ActivityDetailsModal.test.tsx` swatch block (`:754`) asserts it for MasterPicker options.
- Selected option row highlighted (`bg-gray-100`), hover `hover:bg-gray-50`, same paddings/typography as CustomSelect rows.
- Dropdown panel: `absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg` with `borderColor: var(--line, #e5e7eb)` (CustomSelect styling) + search input row on top (`px-3 py-2 border-b`, `text-sm`, full width, `type="text"`). **Options list is height-bounded: `max-h-60 overflow-y-auto`** (240px, internal scroll) — 90 masters must not produce a 3000px dropdown. Trigger and option labels truncate (`truncate`) — long «Фамилия Имя» + swatch never break the layout.
- **Overflow-ancestor contexts (feasibility review):** the absolute-dropdown pattern is retained deliberately — CustomSelect/StatusPicker already render absolute dropdowns inside these exact containers today (Modal body `overflow-hidden` `Modal.tsx:70`, PhotoModal scroll body `:387`, ClientCardModal right panel) and work, because triggers sit in the upper form area and the list is now bounded (search row ~40px + list ≤240px ≈ 280px total). Tightest container is StampPanel's accordion (`max-h-96` = 384px in `Toolbar.tsx`) — still fits. Fallback if any surface clips in practice (caught at visual gate): portal the dropdown to `document.body` with rect-based positioning — noted, NOT built (YAGNI).

### 5.4 Accessibility (baseline = existing repo pattern `aria-haspopup`/`aria-expanded` + listbox/option in StatusPicker/FilterDropdown; role placement and additions per ARIA APG — best-practices panel review. Note: the G1a sketch cited "#139 ColumnPicker bar", but ColumnPicker as shipped carries no ARIA/keyboard handling — this spec sets the actual bar.)

- **Trigger (any state):** `<button type="button" aria-haspopup="listbox" aria-expanded={isOpen} aria-label={…}>` — the menu-button → listbox-popup pattern. The trigger is **not** `role="combobox"`: ARIA 1.2/APG assign `role="combobox"` to the element the user types into, and a button-combobox is by definition select-only (no filter input) — not our shape. Consumers pass the field label as the trigger `aria-label` (BookingFilters/PhotosFilters reuse «Фильтр по …» so `getByLabelText` keeps working; StampPanel uses «Мастер»/«Услуга»).
- **Search input (open):** carries the combobox role for the open session — `role="combobox"` + `aria-autocomplete="list"` + `aria-expanded="true"` + `aria-controls={listboxId}` + `aria-activedescendant={highlightedId}` + `aria-label="Поиск"` (APG editable-combobox-with-open-popup mapping; HeadlessUI `Combobox.Input` equivalent). DOM focus stays here while open; the listbox itself is never focused. `listboxId` comes from React `useId()` — multiple Comboboxes coexist on one page (BookingFilters has 3, PhotosFilters 4+).
- **Listbox:** `role="listbox"` `id={listboxId}`; every visible row (incl. the clear option) `role="option"` + `aria-selected` + `id` (`combobox-option-{value}` / `combobox-option-clear`) so `aria-activedescendant` resolves.
- **Empty state:** the `combobox-empty` row carries `role="status"` (polite live-region semantics, WCAG 4.1.3) so «Ничего не найдено» is announced without moving focus.
- Keyboard (handled on the search input): `ArrowDown`/`ArrowUp` move highlight among clear + filtered options, **wrapping** (deliberate G1a choice — matches ColumnPicker; differs from APG select-only which clamps); `Home`/`End` first/last; `Enter` selects the highlighted option (closes, emits) — **no-op during IME composition** (`event.nativeEvent.isComposing`); `Escape` closes without change, focus → trigger; `Tab` commits the highlighted option if one is active, then continues normal tab flow (HeadlessUI/react-select consensus); click selects. Typing in the search input resets highlight to the first filtered match.
- Works as a plain dropdown without typing: open → click an option. All of the above is exercised by the unit suite (§8.1) — no screen-reader announcements beyond `aria-activedescendant` + the status row (out of scope, same as #139).

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
| 13 | PhotosFilters (photos page) | service | native `<select aria-label="Фильтр по услуге">` (`PhotosFilters.tsx:111-122`), raw map from `PhotosContext` (`servicesMap`), label `s.title`, «Все услуги» | `Combobox` — **G1b amendment proposal** (note below) | «Все услуги» |
| 14 | PhotosFilters (photos page) | location | native `<select aria-label="Фильтр по локации">` (`PhotosFilters.tsx:128-140`), raw map (`locationsMap`), label `l.name`, «Все локации» | `Combobox` — **G1b amendment proposal** (note below) | «Все локации» |

> **G1b amendment (rows 13-14):** the G1a surface inventory missed PhotosFilters' two dictionary selects — they match every inclusion criterion (fully-loaded `/all` data, same pattern as BookingFilters rows 10-11) and were flagged by the spec panel's completeness review. Proposed: include them (recommended — leaving them native recreates exactly the inconsistency #214 removes, and the change is identical in shape to rows 10-11). Their typeaheads (client/activity/tags via `RemoteSearchSelect`) and tag chips remain untouched. **Pending user approval at G1b; if declined, rows 13-14 move to §3 Non-Goals with a follow-up issue.**

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
| Master (raw `MasterResponse`) | MasterPicker, BookingFilters | `displayMasterName(m)` | default (label «Фамилия Имя» already contains both names — substring-anywhere finds either) |
| Master (domain `Master`) | MasterPicker (SettingsTab, StampPanel) | `m.name` | `` m.shortName ? `${m.name} ${m.shortName}` : m.name `` |
| Service (raw `ServiceResponse`) | ClientRecordTab, BookingFilters | `s.title` | default (label) |
| Service (domain `Service`) | SettingsTab, StampPanel | `s.name` | default (label) |
| Location (raw `LocationResponse`) | ClientRecordTab, PhotoModal, BookingFilters | `l.name` | `` `${l.name} ${l.short_title ?? ''}`.trim() `` |
| Location (domain `Location`) | SettingsTab | `l.name` | `` l.shortTitle ? `${l.name} ${l.shortTitle}` : l.name `` |

Substring-anywhere matching (§5.1) + these haystacks deliver the G1a requirement "search by first_name+last_name, either word order" for a single typed word in any position.

## 7. What each consumer change looks like

- **ClientRecordTab:** `locationOptions`/`serviceOptions` drop the manual `{value:'',label:'Не выбрана'}` head and become plain maps → `<Combobox clearLabel="Не выбрана" value={locationId} onChange={(v) => { setLocationId(v); markChanged(); }} … />` (same for service). MasterPicker call unchanged.
- **SettingsTab:** two native selects → Combobox with `clearLabel="Выберите"`; `value`/state wiring is a drop-in (`setServiceId(v)` + existing `onUpdate` side-effect preserved).
- **StampPanel:** master native select → `<MasterPicker masters={masters} value={stamp.masterId} onChange={handleMasterChange} className={…}/>`; service native select → Combobox `clearLabel="Выберите услугу"`. Labels `htmlFor` wiring: the label currently points at `select#stamp-master`; after migration the `htmlFor` points at nothing native — acceptable (Combobox trigger gets `aria-label="Мастер"`/`"Услуга"`; same pattern ClientRecordTab already uses for its unlabeled wrappers).
- **PhotoModal:** inside the `field.type === 'select'` renderer, replace `<select>` with `<Combobox clearLabel={field.emptyLabel} options={selectOptions} value={(value as string) ?? ''} onChange={(v) => onChange(field.key, v || null)} />` — keeps today's exact `'' → null` boundary mapping (`e.target.value || null`). Tags/client/activity typeaheads untouched apart from the rename (§4.2).
- **BookingFilters:** three native selects → Combobox; `locationList/serviceList/masterList` (`!archived`) become option arrays per §6.2; `onLocationChange`/`onServiceChange`/`onMasterChange` receive the Combobox value directly (`''` = «Все …», same sentinel as today). Query keys/`staleTime`/`!archived` untouched.
- **PhotosFilters (rows 13-14, if approved):** two native selects → Combobox exactly like BookingFilters; `undefined`-sentinel state keeps its existing mapping shape: `value={filters.service_id ?? ''}` / `setFilters({ service_id: v || undefined })`; data stays the `servicesMap`/`locationsMap` values (raw shapes, §6.2 haystacks).
- **MasterPicker:** swap `CustomSelect` for `Combobox` internally: options lose the manual «Не выбран» head; `<Combobox clearLabel="Не выбран" value={value} onChange={onChange} options={masters.map(…)} className={className}/>` — a pure pass-through, props and types byte-identical to today.

## 8. Testing

### 8.1 New unit suite: `__tests__/Combobox.test.tsx`

Mirrors `SearchableSelect.test.tsx` structure (render helper + overrides) but with **NO fake timers** (no debounce to advance). Cases:

1. Renders trigger with selected label; `clearLabel` when `value=''`; `—` when value is set but absent from options.
2. Color swatch + `data-color` on trigger and option rows.
3. Opens on click; search input visible + focused; all options listed (incl. pinned clear option first); closes on outside mousedown; closes on option select; options list scrolls internally beyond `max-h-60`.
4. Typing filters instantly (case-insensitive substring, e.g. «ИВА» finds «Анна Иванова»); `searchText` override wins over label; whitespace-only query = no filter; query reset after close+reopen.
5. Empty result → `combobox-empty` with «Ничего не найдено»; clear option still visible.
6. Clear option: pinned first (`combobox-option-clear`); selecting it emits `onChange('')` and closes.
7. Keyboard: ArrowDown/Up move highlight (wrap, clear option first); Home/End; Enter selects highlighted; Tab commits highlighted option and closes; Esc closes + focus on trigger + value unchanged; Esc/Enter keydown does not propagate (host modal stays open).
8. Works as plain dropdown with no typing (click-only path).

### 8.2 Updated unit suites

- `MasterPicker.test.tsx` — testids `custom-select-*` → `combobox-*`; raw-shape label now «Фамилия Имя»; search by last name finds master (raw + domain shapes); «Не выбран» → `onChange('')`; swatch preserved.
- `ClientRecordTab.layout.test.tsx` — trigger testids; add one search-filters-services assertion.
- `ClientsIntegration.test.tsx` — trigger testid only.
- `ActivityDetailsModal.test.tsx` — MasterPicker testids; existing swatch assertions keep passing via `data-color`.
- `BookingFilters.test.tsx` — select interactions → open/type/click Combobox flow; master options now «Фамилия Имя»; keep raw-fetcher mocks + archived-excluded assertions (find by role option, 10s window — existing pattern).
- PhotoModal suite — location field now Combobox: open/type/select + `field.emptyLabel` as clear label; the existing `getByText('Без локации')` assertion migrates from the removed `<option>` to the **trigger text** (shown when `value === ''`); owner typeaheads untouched (rename only).
- PhotosFilters suite (rows 13-14, if approved) — `getByLabelText('Фильтр по услуге')`/`('Фильтр по локации')` interactions move from native select to Combobox open/type/select flow (trigger keeps the `aria-label`).
- StampPanel suite — master via MasterPicker testids, service Combobox, label `shortName`→`name` expectations updated; `getByLabelText(/мастер/i)` still resolves — via the Combobox trigger's `aria-label` (label `htmlFor` association is replaced by it, §7).
- DELETE `CustomSelect.test.tsx`.

### 8.3 E2E

New spec `e2e/combobox-dictionaries.spec.ts` — the six User Scenarios (§10). Updated existing specs:

- `records.spec.ts` — all native `select[aria-label="Фильтр по …"]` interactions (not just tests 4–5; also `:91-93, 106-108, 118, 123, 128, 215-217, 598, 648, 707, 961`): → Combobox flow (trigger `aria-label` assertions + open + `combobox-option-*`); master option labels «Фамилия Имя».
- `records-view.spec.ts:198-216, 517` — native filter-select option counts and `.selectOption()` calls → Combobox flow.
- `photos-crud.spec.ts:246,275` (rows 13-14, if approved): native «Фильтр по услуге/локации» select interactions → Combobox flow.
- `clients.spec.ts:472-484` — `custom-select-trigger` → `combobox-trigger` inside the same wrappers.
- `activity-details-modal.spec.ts` — `:258-260` native `.selectOption()` on `select-service` → Combobox flow; `:339-341` master trigger testid.
- Visual baselines: trigger markup stays visually identical to CustomSelect (closed footprints — records/photos filter bars, clients record tab, settings tab — unchanged); dropdown-open states gain the search row. Sweep the visual suite; any baseline whose capture includes a swapped control or an open dropdown regenerates via the CI `update-snapshots` workflow (project standard, `docs/tests_workflow.md`).

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
2. All 12 G1a migration rows of §6 are implemented — plus rows 13-14 (PhotosFilters) if the G1b amendment is approved; data fetching/archived semantics unchanged per surface.
3. `CustomSelect.tsx` + `CustomSelect.test.tsx` deleted; no references to `custom-select` testids or the import path remain in app code or tests (except the self-contained `wave6-status-snapshots.spec.ts` inline HTML).
4. `SearchableSelect` renamed to `RemoteSearchSelect` everywhere (component, props, file, test file, imports, comments); zero behavior diff (its suite passes unedited apart from names).
5. Master labels unified to «Фамилия Имя» (`displayMasterName`) in MasterPicker (raw shape), BookingFilters, StampPanel (via MasterPicker); `docs/domain-rules/masters.md` addendum landed.
6. E2E `combobox-dictionaries.spec.ts` covers US-1…US-6 green; `records.spec.ts`, `records-view.spec.ts`, `clients.spec.ts`, `activity-details-modal.spec.ts` (+ `photos-crud.spec.ts` if rows 13-14 approved) updated and green; full vitest suite + tsc + lint green.
7. No new API endpoints, no api-client changes, no LS keys touched.

## 13. Risks & Decisions

- **Trigger visual parity** keeps visual baselines stable; dropdown-open baselines (if any cover these surfaces) regenerate via CI workflow — known, cheap.
- **`''` vs `null` contract:** `''`-based (G1a's `onChange(value|null)` sketch refined — the clear *action* is preserved, the sentinel matches the codebase's existing convention at 6 of 7 consumer groups; MasterPicker stays a pure pass-through). Flagged at G1b; mechanical swap if the user prefers literal null.
- **Overflow clipping:** absolute dropdown + `max-h-60` bounded list fits all surfaces incl. StampPanel's 384px accordion; CustomSelect precedent proves the pattern in modal bodies. Portal fallback documented (§5.3), built only if the visual gate catches a real clip.
- **StampPanel copy/label change** (rows 7) is the only user-visible copy change — intended unification, flagged in §6.
- **Typing Cyrillic**: `toLowerCase()` is Unicode-aware and unambiguous for Russian Cyrillic and ASCII Latin (the only scripts in these labels) — sufficient here; no NFKD/locale machinery warranted.
- **Option count growth**: 90 masters filter instantly in memory; Combobox renders all matches (no virtualization — YAGNI). Threshold caveat: revisit sooner (~200) only if option rows ever grow a second line of text; simple swatch+label rows are fine into the hundreds.
