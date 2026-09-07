# GH #221 — Record form: client typeahead by partial phone match

- **Issue:** #221 `Record form: client typeahead by partial phone match`
- **Status:** DESIGN phase, G1a + G1b passed 2026-09-07 (panel findings and the digits-source amendment folded into this revision)
- **Scope:** backend (new `phone` digits-filter on `GET /api/v1/clients`) + shared admin typeahead component (parameterized) + `frontend/admin` (phone field in the record form becomes an adaptive-mask typeahead; save binds the selected client by id, falls back to digits-equality resolve-or-create). No storage normalization, no data migration, `q` search untouched.
- **Grounding:** host recon 2026-09-07 — two scout fact sheets (code recon @ `e8aad80`; phone-mask library research) + 5-reviewer panel (completeness/consistency/feasibility/simplicity/best-practices). All issue claims verified against the live tree (§1.2). Dependency issues #212 (server `?q=` on clients) and #214 (searchable combobox) are CLOSED — their mechanics are the reuse base.

---

## 1. Context & Problem

### 1.1 Current state (live-tree facts)

- **Record-form client picking is exact-phone-only.** `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx:37-47,84-99` — free-text phone input (placeholder `+7 (___) ___-__-__`, no mask library), onBlur fetch when ≥10 chars via `getClientByPhone`; on match the handler also auto-fills the name field (`:42`).
- **`getClientByPhone` is exact string equality.** `backend/src/api/clients.py:50-66` — `GET /clients/get?phone=`, `min_length=3`, active-only, first-or-404 (`CLIENT_NOT_FOUND`).
- **Resolve-or-create at save; the name field is a new-client field.** `frontend/admin/hooks/useRecordMutations.ts:79-109` — `CreateRecordInput` = `{phone, name, channel, seats, visitors}` (`:46-52`); `input.name` is consumed **only** by the two `createClient` calls (`:92-93,101-102`); for an already-existing client the typed name is silently ignored. The submit chain is `NewBookingTab → ActivityDetailsModal.handleNewBookingSubmit` (`ActivityDetailsModal.tsx:123-141`) `→ useRecordMutations.createRecord`.
- **List search already exists but is literal.** `GET /api/v1/clients` (`backend/src/api/clients.py:69-77`) with `ClientListParams` (`backend/src/schemas/client.py:98-119`) — **no `phone` field today**; `q` (2–100 chars, 422 outside), `status` (default active), date/stats filters, pagination, sort. The list query is assembled in `ClientService.list_clients_with_stats` (`backend/src/services/client.py:86-275`), which applies `q` via the `search_predicate` builder (`:169`); the `search_fields` matrix on the service (`:60-64`) declares the q-fields (name/phone/email substring + exact UUID) with `%`/`_` escaping (`repositories/search.py:27-28,40-53`).
- **Existing typeahead component is hardcoded to min-2.** `frontend/admin/app/components/shared/RemoteSearchSelect.tsx:98-103` — server-coupled typeahead (300 ms debounce), clamp `if (q.length < 2)` mirroring the server `q` contract; consumers: Photos only (`PhotoModal.tsx`, `PhotosFilters.tsx`). Dropdown/keyboard/a11y mechanics live in `Combobox.tsx`; debounce+cancel idiom in `ClientsFilters.tsx:10-43`.
- **Phones are stored raw.** `backend/src/models/client.py:15` — `phone: String(20), nullable`, not unique. No normalization/validation on write anywhere (`backend/src/schemas/client.py:15,36,52,76` are bare `str | None`); no digits-only compare precedent in the backend; no format/mask helpers in admin.
- **libphonenumber-js is in the repo — but not in admin.** `frontend/web/package.json:19` (`^1.13.3`, used via `isValidPhoneNumber` in `ContactForm.tsx`); **absent from `frontend/admin/package.json`** — must be added; admin will use the `AsYouType` API (different export of the same package).
- **API client is a package.** `@memo/api-client` (`packages/api-client/src/endpoints.ts`) — its client-list params interface (`:393-398`) has `q/per_page/page/status` and must gain `phone`.
- **DB:** SQLite (aiosqlite) default — `backend/src/core/config.py:16`; precedent for a custom SQLite function: the Cyrillic-safe `lower()` override in `backend/src/db/database.py`.
- **Docs:** `docs/domain-rules/clients.md` documents phone lookup and the `q` matrix (`:25-58`).

### 1.2 Issue claims vs reality (recon-verified)

| # | Issue claim | Verdict |
|---|---|---|
| 1 | Client picking in the record form is phone-exact only | CONFIRMED (`NewBookingTab.tsx:37-47`) |
| 2 | `getClientByPhone` = exact equality | CONFIRMED (`api/clients.py:50-66`) |
| 3 | Resolve-or-create lives in `useRecordMutations` | CONFIRMED (`useRecordMutations.ts:79-109`) |
| 4 | Dependency #212 (server `?q=`) | CLOSED — shipped |
| 5 | Dependency #214 (searchable combobox) | CLOSED — `RemoteSearchSelect.tsx` + `Combobox.tsx` exist |

Scope check (main session, panel does not read the issue): the issue asks for a partial-phone typeahead in the record form. This spec covers it fully and adds G1a user-approved extensions: adaptive input mask, suggestion threshold of 4 digits, active-only suggestions, bind-by-id on selection, read-only name for a picked client, one shared parameterized typeahead. Nothing from the issue is dropped.

### 1.3 Problem

The front desk identifies clients by phone every day, but the record form finds a client only when the full number is typed **byte-exactly as stored**. Stored formats are inconsistent (raw `+79991234567`, masked `+7 999 123-45-67`, national `8999…`) because nothing normalizes on write, so exact lookup misses and resolve-or-create silently produces duplicate clients. There is no way to find a client from a fragment of the number. The name field compounds the confusion: it looks editable for an existing client but is silently ignored — quasi client-editing outside the client's own form.

## 2. Locked decisions (G1a user-approved 2026-09-07; component/name decisions re-approved with the panel package)

1. **Matching is digits-only and country-code-agnostic** (§3): typing `999123`, `8999…` or `+7999…` all match a client stored as `+79991234567`. Implemented on the read path only.
2. **Selection = that client.** Picking a suggestion binds the record to the chosen client by id. Typing a full unknown number without picking keeps today's behavior: a new client is silently created.
3. **Suggestions are active-only** (archived clients are excluded; `status` default).
4. **Suggestion threshold: 4 digits** (counted as digits after mask/formatting strip — `+7 (9` is one digit, not five characters). 1–3 digits — no requests, no dropdown.
5. **Adaptive input mask on a ready library:** `libphonenumber-js` in `AsYouType` mode with `min` metadata — **added as a dependency of `frontend/admin`** (the package already lives in `frontend/web`; MIT; maintained). Country is auto-detected from the typed prefix (`+7` → RU grouping, `+375` → BY, `+49` → DE); no country dropdown is built. **WYSIWYG: the formatted string visible in the field is exactly what is saved** for a newly created client.
6. **New backend surface = one optional list filter** `phone` on `GET /api/v1/clients`. The existing `q` semantics, the exact route `GET /clients/get?phone=`, and all write paths are untouched.
7. **Save-time resolution must not create duplicates** and must not rely on the suggestion snapshot: at save, with no pick, a **fresh server fetch** with the full typed national digits is the resolution basis (§6).
8. **Mask caret: accepted limitation, no promised clean swap.** `AsYouType` does not manage caret position (known upstream issue); the named "fallback" library (`react-phone-number-input`) has its own open caret bugs, so swapping it is **not** a guaranteed fix. v1 acceptance: end-of-string typing is flawless; mid-string edits may jump the caret to the end. The `PhoneInput` wrapper is the isolation seam — any future caret fix lands inside it.
9. **One shared typeahead component, parameterized.** `RemoteSearchSelect` is generalized: threshold and query-building become consumer settings. Photos consumers keep their today behavior exactly (min **2 characters**, `?q=`); the phone consumer uses min **4 digits** and `?phone=`. Rationale: one implementation of debounce/keyboard/a11y to maintain; thresholds stay independent per consumer.
10. **Name field is honest about what it is.** Client picked (phone fixed) → the name field displays the stored client name **read-only**; editing a client's name belongs to the client card only. No client picked (new number) → the name field is editable; its value names the future new client.

## 3. Matching semantics — one rule, one place

Both sides are reduced to a **national digit string**:

1. Strip all non-digits.
2. If the result is exactly 11 digits and starts with `7` or `8` — drop the leading digit (Russian country code).
3. (All other lengths/prefixes are left as-is — Belarusian `+375…` → `375…`, German `+49…` → `49…`, already-national 10-digit RU numbers stay.)

A query matches a client when `national_digits(query)` is a **substring** of `national_digits(client.phone)`. `NULL`/empty phones never match.

The rule is implemented once and shared: backend applies it to the stored value inside a SQL expression and to the bound query value in Python (§4); the frontend applies the same reduction before sending (digits-only query param) and when resolving at save time (§6). Examples: query `999123` matches `+7 (999) 123-45-67` and `89991234567`; query `+7999123` matches `8 999 123-45-67`; query `1234` does not match `+79991234599`.

**Tolerance note (deliberate).** The rule is intentionally "dumb" so it degrades gracefully on dirty stored data: it needs no parsing, never fails on garbage, and coincides with the proper national-significant number for well-formed Russian numbers. Exotic cost: a non-Russian stored number that happens to be 11 digits starting with `8` loses its leading digit too — the effect is a *looser* match (more suggestions), never a missed one. Accepted trade-off vs. maintaining two parsing paths (libphonenumber-based + tolerant fallback).

## 4. Backend design

Explicit touch-point list (the filter is **not** free — each point must change):

1. **`ClientListParams`** (`backend/src/schemas/client.py:98-119`) — gains `phone: str | None = None`.
   - Validation: after stripping non-digits the value must be 4–15 digits, else **422** (mirrors how `q` rejects 2–100). The frontend clamps at ≥4 digits, so 422 is a contract guard for direct API users, not a UI path.
2. **`ClientService.list_clients_with_stats`** (`backend/src/services/client.py:86-275`) — the actual list-query assembly; adding the field to the Pydantic model alone would leave `phone` **silently ignored** (this function reads params explicitly, cf. `q` at `:169`). When `params.phone` is set, add the predicate `memo_phone_national(Client.phone) LIKE '%' || :national_digits || '%'`.
   - The bound value is digits-only, so no LIKE-wildcard escaping is needed (the existing escape helper `repositories/search.py:27-28` stays for `q`; the phone predicate is a separate code path, not shared with `search_predicate` — recorded here so nobody "reuses" the wrong seam).
   - Combines with existing params as AND: `phone` + `status`, `phone` + pagination. `phone` + `q` together is allowed (AND) — this is pass-through of how the framework composes filters, not a designed feature; documented in domain rules so the relationship is explicit.
3. **`memo_phone_national`** — a custom SQLite function registered in `backend/src/db/database.py` next to the existing Cyrillic-safe `lower()` override (same mechanism): takes a string, returns the national digit form per §3 (NULL → NULL). SQLite-first, consistent with the `lower()` precedent; a Postgres deployment would need an equivalent — out of scope, noted here deliberately.
4. **`@memo/api-client`** (`packages/api-client/src/endpoints.ts:393-398`) — the client-list params interface gains `phone` so the typeahead call is typed.

- **Performance.** Per-row function evaluation = full scan. At salon scale (hundreds–thousands of clients, guarded by `status` default and 4-digit threshold) this is trivially fast. The indexed alternative (shadow normalized column maintained on write + backfill migration) is explicitly rejected (decision 1: read-path only).
- **Response shape unchanged:** `{items, total, page, per_page}` (`schemas/common.py:15-21`); the typeahead requests a small page (`per_page=10`).

## 5. Frontend design (admin)

- **Shared component, parameterized (decision 9).** `RemoteSearchSelect` is generalized: `minChars` threshold + a query-building hook (input → request params) + option-row rendering become consumer props. Existing Photos consumers are migrated onto the parameterized form with **identical behavior** (min 2 characters, `?q=`) — covered by a regression test. The phone consumer (`PhoneTypeahead`) is a thin wrapper adding: mask formatting, digits-based thresholding (4), `?phone=<digits>&per_page=10` requests, post-pick read-only state. `data-testid="input-phone"` is preserved.
- **Typing behavior.** Every keystroke is formatted through `AsYouType` (`libphonenumber-js/min`, added to admin deps, imported inside the modal's module so metadata rides per-route splitting; non-digits stripped before re-formatting to keep the controlled-input loop stable). From the 4th digit (digits, not characters), debounced suggestions load (300 ms, in-flight cancellation per `ClientsFilters.tsx:10-43`). **Search digits come from the formatter's national-number output (`AsYouType.getNationalNumber()`) — the digits the admin actually typed, without the decorative trunk `8`/country code the mask may prepend for display — never from digits scraped off the formatted display string** (G1b amendment: display-scraping would silently break tail-of-number search).
- **Suggestion row.** `Name · formatted phone` — name falls back to «Без имени» for phone-only clients (created by resolve-or-create). Active clients only (server default).
- **States.** 1–3 digits — no dropdown; ≥4 digits with zero results — silent (non-blocking) empty state; loading state per existing typeahead idioms.
- **Selection (decision 2 + 10).** Picking a row:
  - stores the client id; the save payload references the client by id (plumbed through `NewBookingTab → ActivityDetailsModal.handleNewBookingSubmit → useRecordMutations.createRecord`; `CreateRecordInput` gains optional `client_id`);
  - the phone field shows the client's name+phone and becomes **read-only** with a clear (×) affordance, per existing select patterns;
  - the name field displays the stored client name, **read-only** (editing a client = client card form only);
  - clearing (×) detaches the pick and returns both fields to typing mode.
- **New number (no pick).** The phone field holds the masked string; the name field is editable — it names the future new client; the save flow runs §6.
- **Removed:** the old onBlur exact-fetch handler (`NewBookingTab.tsx:37-47`) — the dropdown and §6 supersede it (including its name auto-fill: replaced by pick-fill, read-only).
- **Out of the flow:** editing an existing record never rebinds the client.

## 6. Save-time resolution (no duplicates)

The mask changes what gets typed (`+7 (999) 123-45-67`) versus what may be stored historically (`+79991234567`), so an exact-string resolve would miss and duplicate. The resolution basis is a **fresh server query at save time** — never the suggestion snapshot (which can be absent, truncated by `per_page=10`, or stale from further typing):

1. A client was picked from suggestions → save binds that client id. Done (no extra fetch).
2. No pick: reduce the typed field value to national digits (§3) and **fetch** `GET /api/v1/clients?phone=<full national digits>` synchronously in the save path.
   - Fetch succeeded → among the results, find those whose national digits **equal** the typed national digits; bind the first — parity with today's `first-or-404` semantics (`phone` is not unique in the data). None equal → create a new client with the **visible formatted string** as `phone` (WYSIWYG, decision 5). A full-length digits query returning >10 substring rows is not realistic (it would require 10+ clients sharing the complete number); the equality row, if it exists, is within the page.
   - Fetch **failed** (network/5xx) → the save is **blocked** with a retryable error («не удалось проверить клиента — попробуйте ещё раз»). Parity with today: the save path always did a server round-trip (exact lookup) and failed closed on network errors; silently creating a client we could not check is the duplicate bug this section exists to prevent.
3. The backend exact route `GET /clients/get?phone=` is not modified and is no longer called by this flow. It stays documented in domain rules; other consumers (if any) are unaffected.

Known unchanged pre-existing behavior (recorded, not fixed here): an **archived** client's full number typed without a pick creates a new active client — the exact route has always excluded archived (see `test_api_clients.py` coverage of `get?phone=`), and suggestions are active-only by the same decision 3.

## 7. Edge cases & error handling

- **Pasted numbers** (`+7 999 123-45-67`, `89991234567`) — §3 reduction handles all variants; paste formats on the next input event.
- **Backspace/editing mid-string** — caret may jump to end (decision 8); accepted for v1; the wrapper component is the seam for any future fix.
- **`phone` param malformed** (empty after strip, <4 or >15 digits) — 422, consistent with `q` bounds.
- **Suggestion request failure** — suggestions silently absent; typing continues (the save-time fetch of §6 is the correctness guard, and it fails closed).
- **Save-time fetch failure** — save blocked with a retryable error (§6); no silent create.
- **Duplicates in base** (same phone, several active clients) — all shown as suggestions (admin picks deliberately); unpicked save binds the first (parity with today).
- **Very short stored phones / garbage digits** — degenerate data still matches per §3 substring; harmless, not special-cased.

## 8. Testing strategy

- **Backend** (`backend/tests/test_api_clients.py` + service/schema tests):
  - `?phone=` finds by partial digits across stored formats: `+79991234567`, `8 999 123-45-67`, `+375 29 123-45-67` (BY, no strip), already-national `99991234567`.
  - 422: <4 digits, >15 digits, empty-after-strip.
  - Archived excluded (default status); `status=all` includes.
  - Combines with pagination envelope; `phone`+`q` AND-combination; `q` behavior unchanged (regression).
  - Unit: national-digits reduction cases (7/8 leading strip, 12-digit untouched, NULL).
- **Frontend/admin:**
  - Parameterized typeahead: Photos consumers regression (threshold 2 chars, `?q=` — behavior identical to before).
  - Phone wrapper: mask formatting cases, 4-**digit** threshold (mask chars don't count), debounce, suggestion rows incl. «Без имени», selection → read-only phone+name, clear (×) restores typing, empty/loading states.
  - `useRecordMutations`: bind-by-id path; save-time fresh-fetch digits-equality path (bind existing — no duplicate); fetch-failure blocks save; create path stores the visible formatted string.
  - `@memo/api-client`: `phone` param typed and sent.
- **E2E:** one test per User Scenario (§User Scenarios), RED-GREEN-REFACTOR.

## 9. Domain rules delta (committed with the spec at G1b)

`docs/domain-rules/clients.md`:
- document the new `phone` filter on `GET /api/v1/clients`: digits semantics per §3, 4–15 digits after strip (422 outside), AND-combination with `status`/`q`/pagination (framework pass-through), active-by-default;
- document the relationship to `q`: `q` remains a literal substring over name/phone/email (raw strings); `phone` is the digits-only national substring mode; the record-form typeahead uses `phone`, the clients list keeps using `q`;
- document the record-form flow change: suggestions are active-only, selection binds by id and freezes phone+name read-only, unpicked save resolves by a fresh full-digits fetch (equality → bind first; none → create with the visible string; fetch failure blocks save);
- keep the exact route `GET /clients/get?phone=` section, adding a note that the record form no longer calls it.

## 10. Deliberately NOT built (scope boundaries)

- No normalization of stored phones, no migration, no shadow column (decision 1/6). Recorded trade-off (panel best-practices): canonical E.164 storage is the industry pattern; we consciously invert it at salon scale and accept the fragility — revisit if the base grows.
- No change to `q` semantics or to the exact route `GET /clients/get?phone=` (decision 6).
- No search by name/email in the phone field (rejected in #212 — phone is the identifier).
- No country dropdown/flag picker in the mask (auto-detect only).
- No input mask in any other field/form (clients directory edit form stays as is).
- No archived clients in suggestions (decision 3).
- No rebind of the client when editing an existing record.
- No behavior change for the Photos typeahead consumers (threshold stays 2 chars there).
- No Postgres port of the custom function (noted in §4 as a deployment caveat).
- No caret-position engineering in v1 (decision 8: accepted limitation, wrapper is the seam).

---

## User Scenarios

Each scenario maps to one E2E test (anchors the plan's E2E-in-DoD rule).

1. **Find a regular by a fragment.** The admin types `999123` in the record form; a suggestion `Иванова · +79991234567` appears; the admin picks it; the record is saved bound to Иванова by id. → E2E: type fragment → pick → assert record's client.
2. **Different stored format still matches.** A client is stored as `8 999 123-45-67`; the admin types `+7999…`; the same client appears in suggestions. → E2E: seed old-format client → type → assert suggestion.
3. **Unknown number creates a client.** The admin types a full number that matches nobody and saves without picking; a new client is created with the phone exactly as visible in the field. → E2E: type new number → save → assert new client's phone string.
4. **Ignored suggestions never duplicate.** A client is stored as `+79991234567`; the admin types the masked `+7 (999) 123-45-67`, ignores the suggestion, and saves; the record binds the existing client; no new client appears. → E2E: seed client → type masked full number → save → assert client count unchanged and record bound to the seeded client.
5. **Archived stay invisible.** An archived client whose number matches the fragment does not appear in suggestions. → E2E: seed archived client → type fragment → assert absence.
6. **Editing keeps the client.** Opening an existing record for edit shows the bound client; the phone field does not offer re-binding. → E2E: open edit → assert client unchanged after save.
7. **Mask as you type; silence below the threshold.** Typing digits renders `+7 (999) 123-45-67` progressively (RU grouping for `+7`, another grouping for `+375`); while fewer than 4 digits are typed, no dropdown appears and no list request is sent. → E2E: type 3 digits → assert no request/dropdown; continue typing → assert formatted display; save → assert saved value equals the visible string.
