# GH #212 — Server-side search (`?q=`) in the standard list-pagination pattern — Design Spec

- **Issue:** #212 — `Search (?q=) в стандартный паттерн серверной пагинации`
- **Date:** 2026-08-19
- **Status:** G1a PASSED (concept locked). Awaiting G1b.
- **Depends on:** #205 (merged — dict server pagination), #206 (merged — repo-owned list queries), **#139 (IMPL in flight — generic DataTable; the frontend half of this spec is designed against the post-#139 world and IMPL starts only after #139 merges)**.
- **Follow-ups it unblocks:** #216 (`?clientId=N` deep-link — separate issue, implemented AFTER this merges; compatibility note §6.8 only, nothing implemented here).

---

## 1. Problem

The standard paginated list endpoint (#182 envelope) cannot search by content. This blocks two consumers:

1. **Table search boxes of ALL entities (incl. dictionaries):** after #205 server pagination, the search input filters only the currently loaded page on the client — a silent miss when the match sits on another page (accepted as a temporary degradation in #205 G1b Q1, explicitly "until #212").
2. **Typeahead dropdowns** (PhotoModal: visitors, services, activities, tags) are served by a separate ad-hoc `/api/v1/search/*` router with its own semantics (min_length=1, limit=10, bare-array responses), outside the standard pattern. The only other search that exists is `GET /clients/search?phone=` (exact phone equality), also ad-hoc in shape though living in the clients router.

## 2. Goals

1. One search mechanism: optional `?q=` param on the paginated list endpoints of **clients, records, masters, materials, services, tags, locations, visitors, activities** — filtered in the standard pipeline (WHERE → COUNT → ORDER BY → LIMIT/OFFSET), never a separate route.
2. Searchable fields declared **per entity on the service class** (`search_fields`); substring fields use case-insensitive `ilike '%q%'`; `id` matches by **exact equality only when q is a full UUID** (partial id never matches).
3. All 8 admin tables' search boxes query the server with an **honest `total`** (post-#139 DataTable/PagedListState world). Records table **gains** a search input (the only new visual element).
4. PhotoModal typeaheads migrate from `/search/*` to list `?q=` with `per_page=10`; `SearchableSelect` is clamped to fire at ≥2 chars.
5. `GET /clients/search?phone=` → renamed `GET /clients/get?phone=` with semantics preserved (exact equality, 404 on no-match/partial, status=active default); api-client `searchClientByPhone` → `getClientByPhone`.
6. The `/api/v1/search/*` router is **deleted** after its consumers are migrated.
7. **M5 (mandatory, in scope):** fix Cyrillic case-insensitivity on SQLite (stock `lower()` folds ASCII only) — probe test first, then register Python `str.lower` as SQLite `lower()` on connect.
8. Close the test gap: tags search has **zero** backend tests today; `test_api_search.py` is rewritten into list-endpoint contract tests and deleted.

## 3. Non-Goals (out of scope)

- **#211** — photos server pagination/search. The photos list endpoint gets **no** `q` param; PhotosTable search stays client-side.
- **#214** — dictionary form dropdowns (combobox over `/all`, client-side filter). Untouched.
- **#216** — `?clientId=N` deep-link implementation (compat note §6.8 only).
- **#213** — display-lookup composite endpoint.
- **No NEW clients form typeahead is built** (B3 resolution — see §8 flag). Clients gain server `?q=` on the list endpoint (used by the clients table; available to any future typeahead with zero backend work), but no new UI component.
- Record `comment` and activity `comment` fields are NOT searched (explicit user decisions).
- Photos / payments / visits / users entities get no `q`.

## 4. Current State (verified 2026-08-19)

### 4.1 Backend

- **`/api/v1/search/*` router** (`backend/src/api/v1/search.py`, mounted `main.py:151`): 4 endpoints, all raw `select()` in the router (no service/repo), all `q: Query(min_length=1, max_length=100)`, `limit 10`, bare-array responses (`src/schemas/search.py`):
  - `GET /visitors` — `Visitor.name ilike`, no status (hard-delete entity).
  - `GET /services` — `Service.title ilike` **AND `is_active == True`**.
  - `GET /activities` — join Service, `Service.title ilike`, optional `service_id` param, **no is_active anywhere**; response `start` pre-formatted `"%H:%M %d.%m.%Y"`; includes `service_title`.
  - `GET /tags` — `Tag.tag ilike`, no status.
- **`GET /clients/search?phone=`** (`clients.py:45-61`, NOT in the search router): `phone: Query(min_length=3)`, exact equality, archive status default ACTIVE, no-match/archived → 404 `CLIENT_NOT_FOUND`. Route order today: `/search` → `""` → `/{client_id}` (static-before-dynamic OK).
- **Clients list** (`ClientListParams`, `schemas/client.py:98-114`) already has a **`search`** param — ilike on `name` OR `phone` only, applied to both `query` and `count_query` in `list_clients_with_stats` (`client.py:157-164`). Email is NOT searched today.
- **Repositories (post-#206, `repositories/generic.py`):** stateless singletons, no per-entity repo classes; entity→model binding lives in service factories (`self._model`). `BaseRepository.list(session, table, *, filters=None, order_by=None, limit=None, offset=0, options=None)` and `ArchiveRepository.list(..., status=ACTIVE)` apply filters/status **before** COUNT (count consistency is free); repo `filters=` is **equality-only** — no ilike support today. `list_custom(session, stmt, ...)` counts over the caller-built stmt.
- **Service list paths:** Master/Tag/Material/Location/Visitor — generic. ServiceService — custom `list` delegating to `ArchiveRepository.list` with eager-load `options`. ClientService — endpoint uses module fn `list_clients_with_stats` (query + count_query built manually). RecordService — custom `list_custom`; query joins Activity (inner) already; `client_id` nullable; `service.title` currently reachable only via a sort subquery (no Service join in the list). ActivityService — override with date-range path via `list_custom`; **no `service_id` filter param**; `ActivityResponse` has **no `service_title`**.
- **Engine setup:** `db/database.py:16-44` already has a `@event.listens_for(Engine, "connect")` listener with a SQLite guard (`if "sqlite" not in type(dbapi_connection).__module__`) running PRAGMAs per connection — the Cyrillic `lower()` registration slots in there.
- **422 envelope:** `{"detail": {"code": "VALIDATION_ERROR", "message": <first msg>}}` (`main.py:81-98`). 422 messages in **English** (binding from #205 G1b).
- **SQLAdmin precedent:** `column_searchable_list` per entity in `admin/setup.py` (Master first/last name, Client name/phone, Location name, Service title, Tag tag, Visitor name, Material title) — validates the per-entity declaration pattern.

### 4.2 api-client (`packages/api-client/src/`)

- `searchClientByPhone` (endpoints.ts:487-492) → `/clients/search?phone=`; throws `ApiError(404)` via generic `api()`.
- `searchVisitors` (:731), `searchServices` (:735), `searchActivities(q, serviceId?)` (:739), `searchTags` (:745) → `/api/v1/search/*`; **none covered by endpoints.test.ts**; the 4 `*SearchResult` schemas have no schema tests either.
- `ListParams` (:89-98): `page/per_page/status/sort_by/sort_order` — **no `q`** anywhere.
- `getClients()` hardcodes `per_page=100` (:307-309); sole consumer = RecordsContext all-clients map (that map is #213's problem, not this issue).
- `getClientsWithStats(params?)` (:311-324) forwards arbitrary keys (incl. `search`) verbatim.
- `getActivities(date_from, date_to, page?, per_page?)` (:217) — dates **required in TS signature**; backend has them optional (`Query(None)`).

### 4.3 Frontend (`frontend/admin/`)

- **SearchableSelect** (`app/components/shared/SearchableSelect.tsx`): props-driven (`onSearch` callback, no api-client coupling), 300ms debounce, **fires at 1 char** (`if (q.length < 1)`, :95). Sole consumer: **PhotoModal** — 4 typeaheads: `visitor_id`→searchVisitors, `service_id`→searchServices, `activity_id`→searchActivities(q, formData.service_id) with display switching `service_title`→`start` once a service is picked + auto-fill of `service_id` on select, `tag_ids`→searchTags (multi-chip).
- **No client typeahead exists anywhere.** Record create uses phone-on-blur: `NewBookingTab.tsx:37-47` (≥10 chars → searchClientByPhone → auto-fill name) and `useRecordMutations.ts:88-107` (resolve-or-create on submit). ClientTab (edit) never re-selects the client.
- **Table search boxes today:** Tags (in-table, client `.includes`), Locations/Masters/Materials/Services (in `*Filters` bars, client `.includes` over loaded page), Clients (page-level `ClientsFilters`, **already server-side** via `search` param, debounced 300ms), Photos (in-table, client filter over **full unpaginated** list — #211 territory), Records (**no search input**).
- **Post-#139 world (design target, from `docs/specs/2026-08-18-generic-datatable-design.md`):** `<DataTable>` with `withSearch` only for Tags/Photos; dict search state lives in the factory (`createPagedListContext` optional `search`/`setSearch`) as **predicate-only** — search is NOT in the query key and NOT sent to the fetcher (`visibleItems = items.filter(predicate)`); `*Filters` bars stay outside DataTable and read `search`/`setSearch` from context; Clients/Records hand-rolled contexts aligned to `PagedListState<T>`.
- **Unit tests asserting client-side `.includes`** (must be rewritten): `tags/TagsTable.test.tsx:164`, `LocationsTable.test.tsx:300,312,324`, `MastersTable.test.tsx:310,322`, `MaterialsTable.test.tsx:245,257`, `ServicesTable.test.tsx:340,352`. SearchableSelect 1-char tests: `SearchableSelect.test.tsx:49-71`, `PhotoModal.test.tsx:93-112,141-158`.
- **E2E today:** `masters/locations/services/tags/photos-crud.spec.ts` have "search filter works" fill-only checks; `clients.spec.ts:302` does a real server search. No typeahead e2e.

### 4.4 Backend tests

- `test_api_search.py` (257 ln): only `/search/visitors` (7t), `/services` (7t), `/activities` (6t). **Zero tag-search tests; zero `service_id`-param tests.** `test_schemas_search.py` covers 3 of 4 result schemas (not Tag).
- List-endpoint suites per entity exist (clients 57+82, records 61+9, masters 34, materials 22, services 56, tags 6, locations 32, visitors 6, activities 9+1) + `test_generic_api_contract.py` parametrized over generic entities — the natural home for the shared search contract matrix.

## 5. Design

### 5.1 The `q` param contract (all 9 endpoints, uniform)

| Rule | Value |
|---|---|
| Name | `q` everywhere. Clients' existing `search` param is **renamed to `q`** — atomic same-PR migration of backend + api-client + context + tests (unknown params are silently ignored by FastAPI, so a staged rename fails silently). |
| Length | `min_length=2` → 422 below (incl. `q=""`); `max_length=100` → 422 above. 422 detail in English. |
| Absent vs empty | `q` absent → no filtering (identical to today). `q=""` → 422 (len 0 < 2). |
| Substring semantics | case-insensitive `ilike '%q%'` on declared substring fields, OR'd. `%`, `_` (and the escape char) in `q` are escaped; escaping centralized in the helper (§5.3). |
| id semantics | when `q` parses as a **full UUID** (canonical 36-char form), an exact-equality `id == q` clause is OR'd in, with `q` **normalized to lowercase** first (stored UUIDs are lowercase `str(uuid4)`; pasted uppercase UUIDs still match). Partial id strings never match id (they only hit the substring fields, which normally won't match hex). This is the #216 deep-link prerequisite (a UUID is 36 chars — `min_length=2` is no obstacle). |
| Whitespace | `q` is matched **literally** — no trimming/stripping server-side (decision: keep the contract minimal; whitespace-paste UX gap accepted). |
| Combination | `q` ANDs with all existing filters (`status`, date ranges, record filters, …) — it's one more predicate in the standard pipeline. |
| Status floor (typeahead parity) | archived entities are never returned under the default `status=active` — contract-pinned for services (old `/search/services` hard-filtered `is_active`) |
| Count | `total` reflects the q-filtered count. Free in the generic/`list_custom` paths (predicate before COUNT); clients custom list applies the predicate to **both** `query` and `count_query`. |
| Entities without declared fields | Only endpoints listed in §2 get `q`. Undeclared query params are silently ignored by FastAPI — no 422-for-unknown-`q` machinery (decision on the issue's open question: **ignore**, don't 422). |

### 5.2 Field matrix (locked)

Declared per entity as `search_fields` on the **service class** (post-#206 repos are generic singletons; the service is the composition point of the list query; SQLAdmin `column_searchable_list` precedent). `substring` = ilike `%q%`; `exact` = equality (only when q is a full UUID for `id`; URL fields match exact-full-string only).

| Entity | Substring fields | Exact fields |
|---|---|---|
| clients | name, phone, **email** (new vs today's name/phone) | id |
| records | client.name, client.phone, client.email (**LEFT OUTER join** Client — `client_id` nullable), service.title via activity (join Service through the already-joined Activity) | record.id |
| masters | first_name, last_name | id |
| services | title, description | id |
| materials | title, description | id |
| tags | tag | id |
| locations | name, short_title, address, description | id, yandex_map_url, review_url, image_url |
| visitors | name | id |
| activities | service.title (join Service) | id |

Notes:
- Record/activity `comment` explicitly excluded (user decision).
- Each substring field is ilike'd **separately** — no cross-field concatenation (so "иван петров" does not match first+last name pair; locked matrix).
- Records search joins are added **only when q is present** — no change to the default query plan. Both search joins LEFT OUTER (client genuinely nullable; service join outer for uniformity/zero cost).
- Locations URL fields: exact-full-string match only — a pasted full Yandex-map/review/image URL finds the location; partial URLs never match.

### 5.3 Backend architecture

1. **One pure helper** — `backend/src/repositories/search.py` (NEW):
   - `SearchField` declaration (column + match kind: substring | exact).
   - `search_predicate(q, fields) -> ColumnElement[bool]`: builds the OR of ilike clauses (with `%`/`_` escaping + `ESCAPE` clause) and, when q is a full UUID, the `id == q.lower()` equality. Pure function, unit-testable without a DB. Implementation idiom at plan level: hand-rolled escaping on `ilike(..., escape=…)` OR `icontains(q, autoescape=True)` (SQLAlchemy 2.0 idiom, auto-escapes) — either satisfies contract case #9.
2. **Generic path:** `BaseRepository.list` / `ArchiveRepository.list` gain optional `q: str | None` + `search_fields: Sequence[SearchField] | None` params; predicate applied to `stmt` **before** COUNT (count consistency free). Services pass `self.search_fields` through.
   - Service-level rule: `GenericService.list`/`ArchiveService.list` accept `q` and forward `q` + `self.search_fields` to the repo. A service without declared `search_fields` never receives `q` from its router (the param simply isn't declared there).
   - **Fail-fast guard:** if `q` is provided but `search_fields` is empty/None, the repo raises `ValueError` (defense against a future router/service wiring slip — an empty OR predicate must never silently "match everything" or silently no-op).
3. **Custom paths:**
   - **Clients** (`list_clients_with_stats`): apply `search_predicate` to BOTH `query` and `count_query`; param renamed `search` → `q` in `ClientListParams`.
   - **Records** (`RecordService.list`): when q present, add LEFT OUTER joins (Client; Service via the existing Activity join) + predicate via the helper; unchanged plan when absent.
   - **Activities** (`ActivityService.list`): apply predicate (Service join for title) in both the date-range `list_custom` path and the generic path; add optional `service_id` filter param.
   - **Services** (`ServiceService.list`): passes q + fields through to `ArchiveRepository.list` alongside its eager-load options.
4. **Routers:** all 9 list endpoints declare `q: str | None = Query(None, min_length=2, max_length=100)` and forward it. (Routers using `PaginationParams = Depends()` + scalar params follow the existing mixed-injection pattern; ClientListParams/RecordListParams gain a `q` field.)
5. **`GET /clients/get?phone=`** (rename of `/clients/search`): exact phone equality via `service.list(phone=…)`, 404 `CLIENT_NOT_FOUND` on no-match/archived, `status=active` default, `phone: Query(min_length=3)` preserved. Declared **before** `/{client_id}` (same slot as today's `/search`). Old route removed in the same PR (atomic rename; no external consumers beyond our frontend). **Full rename surface (enumerated, panel-verified):** backend tests referencing `/clients/search` — `test_api_clients.py` (:152,:159,:173,:175,:188,:388-410,:417-476), `test_coverage_boost.py` (:528-541), `test_edge_cases.py` (:210,:222), `test_integration_flows.py` (:25,:334-360); api-client `searchClientByPhone` (endpoints.ts:487-492) + its describe block (endpoints.test.ts:614-623); frontend `NewBookingTab.tsx:4,40`, `hooks/useRecordMutations.ts:9,90` + mocks in `ActivityDetailsModal.test.tsx:35,48,450`, `ClientTab.integration.test.tsx:27`; domain-rules `clients.md` (§9).
6. **`/api/v1/search/*` deletion:** after PhotoModal migration (§5.5) — unmount router in `main.py`, delete `api/v1/search.py` + `schemas/search.py`; `test_api_search.py`/`test_schemas_search.py` deleted (coverage superseded by §7 contract matrix + tags gap closure).
7. **Activities list response:** `ActivityResponse` gains **`service_title: str | None = None`** (OPTIONAL — panel-verified: the schema is shared by all 5 activity endpoints and `Activity` has **no `service` relationship** today, so a required field would 500 every single-item endpoint). The two list paths (generic + `_list_by_date`) populate it explicitly (Service join + post-validation mapping — strategy pinned at plan level); single-item endpoints (get/create/update/partial_update) leave it `None`. Bounded-query-count guard `test_list_activities_query_count.py` must stay green on **both** the q and no-q list paths (the Service join strategy is chosen accordingly — conditional join when q present; the always-on title population uses the cheapest strategy that keeps the count bounded).

### 5.4 M5 — Cyrillic case-insensitivity (mandatory, in scope)

- SQLite's stock `lower()` folds ASCII only → ilike on Cyrillic is broken ("иван" won't match "Иван"). Postgres folds correctly, so this is a dev/test-vs-prod parity fix too.
- **Step 1 — probe test (written FIRST, TDD):** insert `Иван`, search `иван` via a list endpoint → establish truth. Expected to fail pre-fix. The probe also asserts the **compiled SQL uses `lower(...)`** (guards against a dialect generating `COLLATE NOCASE`, which would bypass the override entirely).
- **Step 2 — fix (~10 lines):** inside the existing connect listener (`db/database.py:16-44`, after the sqlite guard), `dbapi_connection.create_function("lower", 1, lambda s: s.lower() if s is not None else None)` — registers Python's full-Unicode `str.lower` as SQLite `lower()` per connection. Covers all engines (app async, alembic sync, sqladmin sync) since the listener is shared; aiosqlite's adapted connection exposes a synchronous `create_function` (verified against SQLAlchemy's aiosqlite dialect) — the probe-first approach catches any proxy-chain residue immediately.
- **Blast radius of overriding `lower` globally (panel finding, resolved):** Python `str.lower` and SQLite `lower` agree on ASCII — pre-existing ASCII-only `lower()` queries are semantically **identical**; only Cyrillic folding changes (which is the point). Performance parity: SQLite evaluates `lower()` per-row regardless (no `lower()`-indexed plans exist in this schema). Full suite runs on the fixed engine.
- **Verification:** probe test flips green; a Cyrillic case-insensitivity assertion joins the §7 contract matrix per entity (at least one Cyrillic-valued field per entity).

### 5.5 Frontend (designed against the post-#139 world)

> #139 (IMPL in flight) delivers: `<DataTable>` (`withSearch` = Tags/Photos only), factory-owned optional `search`/`setSearch` (predicate-only, NOT in query key), `*Filters` bars outside DataTable reading context `search`/`setSearch`, Clients/Records aligned hand-rolled contexts. #212 builds on exactly that.

1. **api-client:**
   - `ListParams` gains `q?: string` (serialized by `listQuery`); all dict list getters accept it.
   - `getRecords` gains `q` — the full plumbing chain (panel-enumerated): (a) `getRecords` params type + its manual `URLSearchParams` builder (endpoints.ts:274-302 — does NOT use `listQuery`), (b) backend `RecordListParams.q`, (c) frontend `RecordFilters.search` field, (d) `RecordsContext` wiring into the fetch, (e) `BookingFilters` input, (f) every test mocking `getRecords` synced.
   - `getClientsWithStats`: callers pass `q` instead of `search` (passthrough — rename happens at call sites).
   - `searchClientByPhone` → **`getClientByPhone`** (`/clients/get?phone=`); 404 surfaces as `ApiError(404)` as today.
   - `getActivities`: `date_from`/`date_to` become **optional** (backend already optional) + new optional `service_id` + `q`; `ActivityResponse` schema gains `service_title`.
   - **Delete** `searchVisitors/searchServices/searchActivities/searchTags` + the 4 `*SearchResult` schemas.
2. **Factory (`createPagedListContext`):** new per-entity config flag (e.g. `serverSearch: true`). When on: `search` joins the React-Query key (`[prefix, page, perPage, status?, sortBy, sortOrder, search]`), is sent to the fetcher as `q`, the client-side predicate is bypassed, and `visibleItems === items`. Page resets to 1 on search change (consistent with sort reset). Debounce/Enter/✕-clear mechanics stay as #139 delivered them (300ms debounce + Enter-to-submit + clear button). **The ≥2-char clamp lives in the factory search wiring** (one place, covers both DataTable `withSearch` inputs and `*Filters` bars): a 1-char value is treated like empty (no `q` in key/fetch, unfiltered page shown); SearchableSelect keeps its own separate clamp (point 6).
3. **Dict tables (Locations/Masters/Materials/Services):** `*Filters` bars UI **pixel-unchanged**; only the wiring changes (factory flag on; fetcher sends `q`). **Tags:** in-table DataTable search (`withSearch`) switches to server `q` via the same factory flag. The #205 "temporary degradation" client filters are removed.
4. **Clients:** `ClientsFilters` bar unchanged visually; context filter key renamed `search` → wire param `q` (frontend state naming decided at plan level — minimal churn). Placeholder "🔍 Поиск по имени или телефону" stays (email searchability is a bonus, copy unchanged). **Rename call-site audit (mandatory plan step — silent-drop hazard since FastAPI ignores unknown params and `getClientsWithStats` passes keys through untyped):** grep-audit every `search:` key passed to `getClientsWithStats` and every `useClients` consumer (5 non-test + 7 test files per #139 spec §6.4) — not just the clients page.
5. **Records (only new UI):** `BookingFilters` gains a search input (placeholder at plan level, e.g. "Поиск по клиенту или услуге..."), debounced 300ms, wired to a new `search` field in `RecordFilters` → `getRecords(q=…)`, resets page→1. Combines (AND) with date/location/service/master/status filters server-side. DataTable `withSearch` stays false for Records (search lives in the page bar, same as Clients).
6. **PhotoModal typeaheads** (4) migrate to list `?q=` with `per_page=10`:

   | Typeahead | Old (`/search/*`) | New (list `?q=`) | Parity decision |
   |---|---|---|---|
   | services | title ilike **+ is_active filter**, limit 10 | `getServices({q, per_page:10})` — default `status=active` | ✅ preserved (default = old filter); contract-pinned: archived service never returned (§7 case 14) |
   | visitors | name ilike, limit 10, no status concept | `getVisitors({q, per_page:10})` | ✅ automatic (no status either side) |
   | tags | tag ilike, limit 10, no status | `getTags({q, per_page:10})` | ✅ automatic |
   | activities | service.title ilike, optional service_id, limit 10, **start pre-formatted "%H:%M %d.%m.%Y"**, service_title included, no explicit ORDER BY | `getActivities({q, service_id?, per_page:10})` — response ISO `start` + `service_title` populated on list paths | ⚠️ accepted delta: the PhotoModal `onSearch` closure **formats `start` to "%H:%M %d.%m.%Y" before handing items to SearchableSelect** (it renders raw field values; util chosen at plan level; display parity unit-asserted). Ordering parity: old endpoint had no ORDER BY (unordered limit-10) — new path likewise relies on list default order; relevance ordering is a future enhancement, out of scope. |

   - Mapping to `SearchItem` (`{id, …displayFields}`) happens in the PhotoModal `onSearch` closures (`r.items.map(...)`); SearchableSelect itself is untouched except the clamp. List responses carry extra fields vs the old `*SearchResult` shapes — harmless structurally, but existing PhotoModal tests asserting exact item shapes/mocks are updated explicitly (§10).
   - **SearchableSelect clamp: `q.length < 1` → `< 2`** (locked, intentional behavior change — 1-char input no longer fires a request; the 422 would be the server's answer otherwise). Backend min_length=1 → 2 aligns the deleted router's semantics with the new ones.
   - Auto-fill `service_id` on activity select + display switching (`service_title` ↔ `start`) preserved.
7. **Phone flows** (NewBookingTab blur + useRecordMutations resolve-or-create): call `getClientByPhone`; behavior unchanged (404 → create new client).

### 5.6 #216 compatibility note (no implementation)

#216 will pre-fill the **clients table** search box with a client UUID (`setFilters({search: id, status:'all'})`). This spec guarantees the prerequisites: id exact-match on full UUID (§5.1), `min_length=2` ≪ 36, `q` combinable with `status=all`. Nothing else is done here.

### 5.7 Migration order (conscious decision: **single PR**)

Single PR (precedent #205/#206). Stacked PRs are rejected: the clients `search`→`q` rename fails **silently** if staged (FastAPI ignores unknown params), and the `/search/*` deletion must ride with its consumer migration.

Order within the PR (each lands green):
1. M5 probe test + Cyrillic `lower()` fix (foundation — every later search test depends on it).
2. `repositories/search.py` helper + pure unit tests.
3. Generic repo params (`q`, `search_fields`) + repo-level tests.
4. Generic entities backend (masters, materials, tags, locations, visitors, services) — service declarations + router params + contract matrix (closes the tags test gap).
5. Clients backend (rename + both-queries predicate + `/clients/get` route).
6. Records backend (outer joins + q).
7. Activities backend (q + `service_id` param + `service_title` in response).
8. api-client (q params, getClientByPhone, activities signature, delete search* — **search* fns deleted only after step 9 lands in the same PR**, order inside the PR: add new first).
9. Frontend contexts/factory/table wiring + Records search input + PhotoModal migration + SearchableSelect clamp.
10. Delete `/search/*` router + schemas + `test_api_search.py`/`test_schemas_search.py`.
11. Domain-rules sync (§9).

## 6. User Scenarios (each → e2e coverage)

1. **Dict table search narrows server-side with honest total.** Admin on Masters page 1 types "ива" (matches a master on page 3) → table shows the match, pager shows the filtered `total` (not page-size). → e2e: `masters-crud.spec.ts` search test upgraded to assert cross-page match + total-driven pager (pattern replicated per dict entity as suite edits, at least one full assertion e2e; others covered by backend contract + unit).
2. **Records search by client/service combined with filters.** Admin types a client phone fragment in the records search box, with a location filter active → only matching records at that location; total correct. → e2e: new test in `records.spec.ts`.
3. **Full UUID pasted → exactly one row.** Admin pastes a full entity UUID into any table's search box → single matching row (id exact match). Partial UUID fragment → no id match (only text fields). → backend contract tests on all 9; one e2e (clients table) as the #216 pre-flight.
4. **1-char query never reaches the server as a valid request.** UI: SearchableSelect does not fire on 1 char; table search boxes (in-table DataTable inputs AND `*Filters` bars) hold fire below 2 chars — the clamp lives in the factory search wiring (§5.5 point 2), uniform UX, no 422 noise. API-level 422 below 2 chars is still contract-tested. → unit tests (factory clamp) + backend 422 contract tests.
5. **Activities typeahead by service title in photo modal.** Admin uploading a photo types a service title fragment → activities of matching services appear (service_title displayed); after picking a service first, the activity list narrows via `service_id` and displays `start`. → unit (PhotoModal mock switch) + backend contract; no new e2e (none existed).
6. **getClientByPhone exact vs partial.** Booking form: full phone on blur → client found & name auto-filled; partial/edited phone → 404 → resolve-or-create path creates a new client on submit. → existing NewBookingTab/useRecordMutations unit tests (renamed mock) + existing e2e booking flow stays green.
7. **Visitors typeahead still works.** Photo modal visitor field: 2+ chars → matching visitors (name, age subtitle) → select. → unit (PhotoModal) + backend contract.

## 7. Contract-test matrix (backend, per endpoint)

Parametrized where possible (generic contract suite for the 6 generic-path entities; dedicated blocks for clients/records/activities custom paths):

| # | Case | Assert |
|---|---|---|
| 1 | Substring per declared substring field | each field individually matches (fixture row per field), case-insensitive |
| 2 | Cyrillic case-insensitivity probe | `Иван` found by `иван` (M5 — first test written, fails pre-fix) |
| 3 | Full-UUID q | exactly the row with that id |
| 4 | Partial id fragment | no id match (row with that id absent from results unless text fields match) |
| 5 | `q` len 1 and `q=""` | 422 VALIDATION_ERROR (English detail) |
| 6 | `q` absent | unfiltered list (baseline parity) |
| 7 | q + each existing filter (status/date/location/service/master/…) | intersection semantics, 200 |
| 8 | total-after-q | `total` == filtered count (spot-check pagination math: page 2 of filtered set) |
| 9 | Wildcard literal | q containing `%`/`_` matches literally, not as wildcards |
| 10 | No-match q | 200, `items: []`, `total: 0` |
| 11 | records: row with NULL client | searched by service title → still found (outer join); searched by client name → NULL-client rows excluded, no error |
| 12 | activities: q + service_id combo; `service_title` present (non-null) in every list item | PhotoModal contract |
| 13 | tags | the full matrix (gap closure — zero tests today) |
| 14 | archived entity + q under default status | archived rows never returned (pins services typeahead parity: old `/search/services` hard-filtered `is_active`) |

Plus endpoint-level: `GET /clients/get?phone=` — exact match 200; partial → 404; archived → 404; `phone=""` / len<3 → 422; route shadowing checks: `/clients/get` resolves to the phone route (not `/{client_id}`), and a UUID-shaped path segment still resolves to `/{client_id}`.

## 8. Flagged interpretation (G1b checkpoint)

- **B3 / "clients typeahead":** the locked concept mentions "Clients/activities typeaheads go through list ?q=". Verified: **no clients typeahead exists** in the frontend today (client selection in record forms = phone-on-blur → `searchClientByPhone`; the top-100 `getClients` map in RecordsContext is #213's scope). This spec therefore delivers: (a) clients list `?q=` backend capability (ready for any future typeahead), (b) clients **table** server search, (c) the phone flow via renamed `getClientByPhone` — and builds **no new SearchableSelect for clients**. If a new clients form typeahead was intended in #212, that's added scope to approve at G1b.

## 9. Domain-rules sync (mandatory task in plan)

Update `docs/domain-rules/` per entity: declare `search_fields` (substring/exact), the q contract (min 2 / max 100 / UUID-exact / 422), and typeahead parity notes:
- clients.md — rename `search`→`q`, email added, `/clients/search` → `/clients/get?phone=` (line 25, 30, 45, 70, 84 area).
- records.md — q row in the list-contract param table; search fields; phone-blur wording updated to getClientByPhone.
- masters/materials/services/tags/locations.md — replace the "until #212" search-matrix bullets with the delivered contract.
- visitors.md, activities.md — add search sections (none today).
- _overview.md — cross-entity `q` invariant (item 5 phone search stays, wording updated).

## 10. Testing Strategy

- **Backend:** §7 matrix (parametrized); M5 probe-first; repo-level unit tests for `search_predicate` (pure, no DB); delete `test_api_search.py` + `test_schemas_search.py` after coverage moves; keep `test_list_activities_query_count.py` green.
- **api-client:** ListParams.q serialization tests; getClientByPhone URL/encoding + 404 ApiError; getActivities new signature; delete search* tests (there are none — only deletions).
- **Frontend unit:** rewrite the 5 dict-suite `.includes` tests to server-q semantics (assert fetch called with `q`, items rendered as returned — post-#139 suite structure applies); factory tests: search in query key, page-reset, ≥2 clamp, `serverSearch` flag; SearchableSelect clamp tests (rewrite 1-char assertions); PhotoModal tests switch mocks from search* to list getters (incl. service_id closure, service_title/start display switch, and explicit update of any exact item-shape assertions — list responses carry extra fields vs the old `*SearchResult` shapes); Clients/Records context tests for the rename/new field; backend test files with stale `/clients/search` URLs renamed per §5.3 point 5 enumeration.
- **E2E:** upgrade `masters-crud` search test to cross-page + total assertion (scenario 1); new records-search test (scenario 2); new clients UUID-paste test (scenario 3, #216 pre-flight); the other dict "search filter works" specs keep passing (fill-only assertions are mechanics-agnostic); no typeahead e2e (none existed — parity).

## 11. Visual Compliance Checks

Scope: minimal by design (records filter bar gains ONE element; everything else visually unchanged).

- [ ] Records page: search input visible in the BookingFilters bar, debounced; typing narrows the table server-side (network request carries `q`), pager reflects filtered total.
- [ ] Dict tables (Tags/Locations/Masters/Materials/Services): search inputs visually **unchanged** (same placeholders, same positions — in-table for Tags, in the filters bar elsewhere).
- [ ] Clients table: search input unchanged visually ("🔍 Поиск по имени или телефону"), still filters (now via `q`).
- [ ] PhotoModal: 4 typeaheads render and behave as before (chips for tags, display fields preserved); no request fires on a 1-char input.
- [ ] No console errors; skeleton/error/empty states intact on all searched pages.

## 12. Definition of Done

1. All 9 list endpoints accept `q` per §5.1 with the §5.2 field matrix; contract matrix green (incl. Cyrillic probe + tags).
2. `/api/v1/search/*` router and its schemas deleted; `GET /clients/get?phone=` live with preserved semantics; api-client/frontend renamed atomically in the same PR.
3. All 8 admin tables search server-side (Photos excluded — #211) with honest totals; Records gains the filter-bar search input.
4. PhotoModal typeaheads run on list `?q=` (per_page=10, ≥2-char clamp); `service_title` guaranteed in activity responses.
5. Domain-rules synced (§9); full backend + api-client + admin suites green; CI green.

## 13. Risks / Open Questions

| Risk | Mitigation |
|---|---|
| Cyrillic `lower()` override affects non-search queries using lower() | Scope: SQLite only, dev/test; Postgres untouched. Probe test establishes the delta; full suite runs on the fixed engine. |
| Records outer joins + q alter the default query plan | Joins added only when q present (§5.2); bounded-query-count and existing record list tests stay green. |
| Atomic rename search→q breaks a missed consumer silently | Grep-driven call-site audit is a **mandatory plan step** (§5.5 point 4 — api-client passthrough means TS won't catch a stale `search` key); full rename surface enumerated in §5.3 point 5; contract tests assert `q` honored and `search` ignored. |
| Activities `service_title` addition breaks query-count guard or single-item endpoints | Field is OPTIONAL (`str \| None`), populated only on list paths (§5.3 point 7); `test_list_activities_query_count.py` asserted on q and no-q paths; single-item endpoints leave it None. |
| Single-PR size (backend + api-client + frontend) | Precedent #205 (13 tasks) / #206 (10 tasks); ordered landing per §5.7, each task green. |
| Post-#139 moving target: factory/DataTable details shift during #139 IMPL | IMPL of #212 starts only after #139 merges (sequencing constraint); plan task texts re-verified against merged #139 at IMPL start. |
