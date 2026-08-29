# Clients `?clientId=` Deep-Link Fix — Design Spec (GH #216)

- Date: 2026-08-29
- Status: DESIGN phase (G1a concept approved 2026-08-19, issue #216 comment by mkosinov — locked)
- Depends on: GH #212 (list `?q=` search, PR #228 merged 2026-08-27), GH #139 (generic DataTable, PR #225 merged 2026-08-26) — **both merged; concept re-grounded against post-merge main**
- Acceptance anchor: red e2e `frontend/admin/e2e/unify-caches.spec.ts:408` (US-6) must turn GREEN

## 1. Problem

Navigating to `/clients?clientId={id}` (producer: `ActivityDetailsModal.tsx:101,107` — `window.open('/clients?clientId=' + client.id, '_blank')`) silently fails to open `ClientCardModal` when the client is not on page 1 of the server-paginated list (default: `page=1`, `perPage=20`, `sort_by=name asc`, `status=active`). No error is shown; the modal just never appears.

- Red on main since ≥2026-08-17 (CI run 32059861576); user-approved override-merge in #205/#206/#211/#212 waves; follow-up #216 filed for it.
- Root cause (still current, verified 2026-08-29): `frontend/admin/app/(main)/clients/page.tsx:22-30` — the deep-link effect runs `clients.find(c => c.id === clientIdFromQuery)` over `data?.items || []`, i.e. **only the loaded server page**. A page-2+ client is never in that array.
- Why US-6 is red deterministically: the unify-caches suite accumulates `Test Client e2e_<ts>_<n>` rows during a run (globalSetup clears only at run start); by US-6 more than 20 exist, and the freshly created client (highest timestamp suffix, `sort_by=name asc`) lands on page 2+.

## 2. Locked Concept (G1a — do not re-open)

Chosen approach — **deep-link via the search field**:

1. On `/clients?clientId=N` the page effect sets the table search to `N` and the status filter to `'all'` (so archived clients are found too; global defaults unchanged — display default stays `active`).
2. Server search matches entity ids by **exact equality** in addition to substring match on text fields (exact-only on ids — searching «Мария» must not match UUIDs containing "aria").
3. Table narrows to that client → existing find-effect finds the row → modal opens from the row (`ClientWithStats` already there). The bug disappears structurally.
4. On modal close the search box is **not** auto-cleared — the user sees why the table is narrowed and decides.

**Invariant (acceptance):** deep-link puts a UUID into search → exact id match → result set ≤1 row → always page 1 → `find()` succeeds. US-6 turns green.

**Rejected (do not revisit):** `GET /clients/{id}` direct fetch; dedicated modal endpoint; rendering the modal on the calling page; separate `?ids=` machine param.

**Out of scope:** ClientsTable status column (→ #220); phone-partial typeahead (→ #221); ClientCardModal merge (→ #139 follow-ups).

## 3. Re-Grounding Against Current Main (verified 2026-08-29)

The concept predates the #139 and #212 merges. Every mechanic was re-verified on main (file:line evidence):

| Concept mechanic | State on main | Consequence |
|---|---|---|
| Server `?q=` exact-id match | **Already landed, uniform.** `backend/src/repositories/search.py` — shared `search_predicate()`; `_full_uuid(q)` (search.py:31-37) = 36-char length + `UUID(q)` try-parse + lowercase normalization; id equality OR'd with ilike clauses (search.py:44-54). Clients `search_fields` includes `SearchField(Client.id, kind="uuid")` (`services/client.py:62-67`) | **Zero backend production change.** #212 §5.6 explicitly reserved these prerequisites for #216 |
| q applied to count + query | Landed: `services/client.py:169-172` applies the predicate to both `query` and `count_query` in `list_clients_with_stats` | `total` honest (1) under deep-link |
| `status=all` + q combine | Landed: `client.py:158-164` — `ALL` adds no status WHERE; q ANDs in cleanly | Archived clients reachable |
| Param naming | `ClientListParams.q` (`schemas/client.py:106`, min 2 / max 100) — `search`→`q` rename done atomically in #212 | 36-char UUID passes bounds |
| Page effect + `find()` | Unchanged from bug report: `page.tsx:22-30`, deps `[clientIdFromQuery, clients, selectedClient]`, guard `!selectedClient` | Stays as the modal-opener; only the search-narrowing is added |
| Filter state shape | `ClientsContext.tsx` hand-rolled (NOT `createPagedListContext`): `filters: ClientFilters` object (`search: string`, `status: 'active'\|'all'\|'archived'`), `setFilters(partial)` merges + **always resets page→1** (works for programmatic calls too, L126-129) | Concept's `setFilters({ search: N, status: 'all' })` maps **literally** onto current API |
| Query key | `['clients', page, perPage, filters, sortBy, sortOrder]` (L113) — whole `filters` object participates | Programmatic `setFilters` triggers refetch; `q` sent when `filters.search.length >= 2` (L121) — UUID passes |
| Search input | `ClientsFilters.tsx:34-40` — **uncontrolled** (no `value` prop), local 300ms debounce → `setFilters({search})`; status select is controlled | **Delta D2:** concept point 4 requires the box to SHOW why the table is narrowed → input must become controlled (§5.3) |
| Deep-link producer | `window.open(..., '_blank')` → always a fresh document/context mount | No in-place param mutation path; effect runs at mount |

### Backend test coverage on main (verify-only; no code change)

- Full UUID → exactly 1 client: `tests/test_client_stats.py:368-376`; partial fragment → no match: `:378-385`; honest total: `:387-397`; uppercase UUID normalization: unit `test_search_predicate.py:29-33` + repo level (Master) `test_repository_list.py:263-275`.
- **Gap:** the exact deep-link combo — clients API `status=all` + full-UUID `q` returning an **archived** client — has no test (flagged by re-grounding; generic-matrix equivalent excludes clients). Closed by T1 (§7).

## 4. Goals

1. `/clients?clientId={id}` opens `ClientCardModal` for ANY existing client (active or archived), regardless of its position in the unfiltered name-sorted list.
2. The user sees WHY the table is narrowed: search box displays the UUID, status select displays «Все».
3. Concept point 4: no auto-clear on modal close.
4. US-6 (`unify-caches.spec.ts:408`) turns green; a dedicated deterministic e2e pins the page-2+ scenario.
5. Minimal diff: no backend production change, no context API change, no DataTable change.

## 5. Design

### 5.1 Frontend — deep-link effect (`page.tsx`)

Add ONE effect before the existing find-effect (which stays verbatim):

```tsx
// Narrow the table to the deep-linked client: search=id + status=all (GH #216)
useEffect(() => {
  if (clientIdFromQuery) {
    setFilters({ search: clientIdFromQuery, status: 'all' });
  }
}, [clientIdFromQuery]);
```

- **Run-once-per-param semantics:** deps `[clientIdFromQuery]` (producer is `window.open` → fresh mount; `setFilters` is a stable `useCallback([])` — safe to omit or include in deps, pinned at plan level). Dev StrictMode double-invoke is idempotent (same partial merged twice, same query key → React Query dedupes).
- **No other filters touched:** merge-partial semantics; on a fresh mount all other filters are defaults anyway.
- **Fetch path:** `filters` object is in the query key → refetch with `q=<36-char UUID>` (≥2-char clamp passes), `status=all`, `page=1` (auto-reset inside `setFilters`), current sort.
- **Modal opens via the EXISTING effect:** refetched `items` = `[target]` (invariant: id exact-match ⇒ ≤1 row ⇒ page 1) → `clients.find()` succeeds → `setSelectedClient(found)` → `ClientCardModal` opens with the row's `ClientWithStats` (stats already computed server-side — this is why direct-fetch was rejected).
- **Close:** existing handler unchanged — `router.replace('/clients', { scroll: false })` strips the param; `selectedClient → null`. Search/status stay narrowed (concept point 4). Stripping the param re-runs the deep-link effect with `null` → no-op.

### 5.2 Status filter force-set

Deep-link sets `status: 'all'`. The status select in `ClientsFilters` is already controlled (`value={filters.status}`) → displays «Все» with zero extra wiring. Global/context default stays `'active'` — only deep-linked navigations are affected.

### 5.3 Frontend — search input becomes controlled (concept point 4 compliance)

`ClientsFilters.tsx` search input today is uncontrolled → a programmatic `filters.search` (the deep-link UUID) would NOT render in the box; the user would see a narrowed table with an EMPTY search box — violating "user sees why the table is narrowed". Change to the standard controlled+debounce pattern:

```tsx
const [draft, setDraft] = useState(filters.search);
useEffect(() => { setDraft(filters.search); }, [filters.search]);
// input: value={draft}
// onChange: setDraft(v); debounced(() => setFilters({ search: v }), 300);
```

- Typing path: unchanged UX (draft updates instantly, server call debounced 300ms, ≥2-char clamp in context unchanged).
- External path (deep-link, future programmatic filters): effect syncs the box.
- **Bonus fix (intentional):** «Сбросить фильтры» (`resetFilters`) now clears the visible box too — today it leaves a stale string in the uncontrolled input (latent bug).
- No flicker on typing: `filters.search` catches up to the same value the draft already holds → sync is a no-op.

### 5.4 Backend — no production change (scope decision, resolved)

The concept's server-side requirement ("exact equality on ids in addition to substring") **already landed in #212 as a uniform rule for all 9 entities** — verified at file:line (§3). The minimal change satisfying the invariant is therefore **zero backend code**; uniformity was free and is already shipped. This spec adds only contract tests pinning the deep-link combo (§7 T1).

### 5.5 Edge cases

| # | Case | Behavior | Verdict |
|---|---|---|---|
| E1 | Client deleted between schedule render and click | Server returns 0 rows → table «Нет записей», `total 0`, search box shows UUID, no modal | Accepted: visible empty state explains itself; user clears search manually. Param lingers in URL — harmless |
| E2 | Archived client | `status=all` → row returned → modal opens | Core scenario (concept point 1) |
| E3 | `clientId` garbage (not a UUID, ≥2 chars) | `q` sent as-is → no id clause; matches name/phone/email only if the garbage happens to be a substring → table narrows or shows empty; no modal | Accepted: param is only produced by our own modal with real ids |
| E4 | 1-char `clientId` | Context ≥2-char clamp → `q=undefined` → unfiltered page 1; old find-over-page-1 behavior | Theoretical only (ids are 36 chars) |
| E5 | Modal closed → param stripped → user types a new search | Normal typing path replaces the deep-link search; nothing re-applies it (effect deps = param value, now null) | Correct |
| E6 | Duplicate param / param change in place | No producer (always new tab/fresh mount) | Non-case, documented |

### 5.6 Domain-rules sync

`docs/domain-rules/clients.md` → Frontend section gains one line documenting the deep-link contract (search=id + status=all narrowing, no auto-clear on close, invariant). No backend rule changes (already documented in the "List `?q=`" section).

## 6. User Scenarios

1. **US-6 (existing, red → green):** schedule → client link opens `/clients?clientId=X` where X sits on page 2+ of the accumulated list → modal opens ≤10s, record tab shows the edited visit row. No test edit required.
2. **Deep-link to archived client:** same flow for an archived client → modal opens (status forced «Все»); restore action available in the modal.
3. **After close:** modal closes, param stripped, table stays narrowed to the 1 row, search box still shows the UUID, status still «Все» — the user clears it manually when done (concept point 4).
4. **Normal typing unaffected:** user types «иван» → same debounce/clamp behavior as before the fix.

## 7. Tasks & Testing Strategy (TDD)

| Task | Scope | Tests |
|---|---|---|
| T1 backend contract (small) | Close the re-grounding gap in `tests/test_client_stats.py`: (a) `status=all` + full-UUID `q` returns an **archived** client, exactly 1 row, `total==1`; (b) uppercase-UUID `q` at the clients API level (mirrors existing unit/repo normalization tests) | New: 2 API tests, RED against nothing (they must pass immediately — they pin existing behavior; if any fails, the premise is wrong → BLOCKED) |
| T2 `ClientsFilters` controlled input (small) | §5.3 pattern + keep debounce | Unit: external `filters.search` renders in box; `resetFilters` clears box; typing still debounced (fake timers) |
| T3 `page.tsx` deep-link effect (small) | §5.1 effect | Unit (`ClientsPage.test.tsx`, extend the `useClients` mock with `setFilters` spy): mount with `?clientId=<uuid>` → `setFilters({search: uuid, status: 'all'})` called once; without param → not called; find-effect opens modal when items contain the row |
| T4 e2e (standard) | New deterministic test in `clients.spec.ts`: create 20 filler clients with names sorting BEFORE the target + target with a name sorting LAST (e.g. «ЯЯ-deeplink-<ts>») → `/clients?clientId=<target>` → assert modal visible, table 1 row, search box contains UUID, status «Все»; cleanup created clients | New e2e + US-6 unmodified must pass; `admin-opens-profile.spec.ts` stays green |
| T5 docs (trivial) | Domain-rules sync (§5.6) + spec checkboxes | — |

- Full gates per dev-workflow: backend pytest, api-client (untouched — expect no diffs), admin vitest + tsc + lint, e2e suite. CI POLICY: local runs only (quota exhausted until 2026-09-01).
- Visual gate G4.5: §8 checklist via `scripts/visual-compliance-check.sh` (desktop+mobile).

## 8. Visual Compliance Checks

- [ ] Search box displays the deep-linked client UUID after `/clients?clientId={id}` navigation
- [ ] Status select displays «Все» after deep-link navigation
- [ ] Table narrows to exactly 1 row (the deep-linked client) with pager showing `1 всего`
- [ ] ClientCardModal opens over the narrowed table without manual interaction
- [ ] After modal close: table stays narrowed, search box still shows the UUID, status still «Все»
- [ ] Manual typing in the search box still debounces (no per-keystroke flicker/spinner storm)

## 9. Definition of Done

- [ ] US-6 `unify-caches.spec.ts:408` GREEN (the acceptance anchor)
- [ ] New e2e (page-2+ deterministic scenario) GREEN
- [ ] All existing suites green (backend, api-client, vitest, tsc, lint, e2e) — no regressions
- [ ] Backend contract tests T1 pin `status=all`+UUID and uppercase-UUID at clients API level
- [ ] Domain-rules `clients.md` synced
- [ ] Visual compliance §8 all passed
- [ ] Worktree/branch per convention: `/root/workspace/worktrees/<slug>-216`, `feat/<slug>-216`

## 10. Risks / Notes

- **US-6 flakiness horizon:** the fix removes the page-position dependency entirely (invariant), so the historical flake class is closed, not masked.
- **E2E determinism:** the new test must not depend on suite-accumulated rows — it creates its own filler set and cleans up (plan pins counts/naming/cleanup per existing suite conventions).
- **Controlled-input conversion** touches a hot path (every keystroke); pattern is standard, covered by unit tests with fake timers.
- **api-client untouched** (`getClientsWithStats` already passes `q` through); frontend-only diff + backend tests.
