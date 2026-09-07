# Client Phone Typeahead (#221) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The record-form phone field becomes a typeahead: partial-digit matching (country-code agnostic), adaptive as-you-type mask, pick binds the client by id, and an unpicked save resolves via a fresh full-digits fetch so no duplicate clients are created.

**Architecture:** Read-path only. One backend filter (`?phone=` on the client list) compares national-digit substrings via a custom SQLite function (`memo_phone_national`, registered next to the Cyrillic `lower()` override); the admin gets a parameterized shared typeahead (`RemoteSearchSelect` generalized; Photos consumers unchanged) plus a `PhoneInput` wrapper (libphonenumber-js `AsYouType`, default country RU, international on `+`); `useRecordMutations` gains a bind-by-id path and a save-time digits-equality fetch that fails closed. No schema changes, no migrations, `q` semantics and the exact route `GET /clients/get?phone=` untouched.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, SQLite/aiosqlite (custom function); `packages/api-client` (Zod); Next.js 14 admin (React 18, TanStack Query, Tailwind, no UI kit); libphonenumber-js `^1.x` (`min` metadata, new admin dep); Vitest + Playwright.

**Spec (binding):** `docs/specs/2026-09-07-client-phone-typeahead-design.md` — §3 matching rule, §4 backend, §5 frontend, §6 save resolution, §7 edge cases, §8 testing, `## User Scenarios` S1–S7.

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/client-phone-typeahead-221`.

**Test commands** — backend (from `backend/`): `python -m pytest tests/test_api_clients.py -x -q`, full `python -m pytest -q`; admin (from `frontend/admin/`): `npx vitest run <paths>`, `npx tsc --noEmit`, `npm run lint`, e2e `npm run test:e2e -- e2e/client-phone-typeahead.spec.ts`; api-client (from `packages/api-client/`): `npm test`.

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Find a client by a phone fragment** → typing 4+ digits anywhere in the number (tail included: `4567` finds `+79991234567`) shows active-client suggestions `Имя · телефон`; picking one fixes the record to that client and freezes phone+name read-only (× restores typing).
- **Format doesn't get in the way** → stored `8 999 123-45-67` is found by typing `+7999…`; pasted/typed values are reformatted live by the mask (`+7` → RU grouping, `+375` → BY); what is visible is exactly what is saved for a new client.
- **No duplicate clients** → saving an ignored-suggestion number of an existing client (any stored format) binds the existing client; only genuinely unknown numbers create a client; if the save-time check can't reach the server, saving is blocked with a retry message.
- **Incomplete numbers can't be saved** → a partially typed phone blocks saving with «Проверьте номер телефона — возможно, он введён не полностью»; only complete valid numbers create clients.
- **Silence below the threshold** → 1–3 digits: no dropdown, no requests.
- **Archived stay invisible** → archived clients never appear in suggestions.
- **Editing a record is inert** → the client of an existing record is never re-bound.
- **Nothing else changes** → Photos typeahead behavior identical; clients-list text search identical; exact phone route unchanged.

## File Structure (decisions locked)

- `backend/src/domain/phone_digits.py` — NEW: the single Python implementation of the §3 reduction (`to_national_digits`), used by the SQL function, the param validator, and save-time logic. One responsibility: digits reduction.
- `backend/src/db/database.py` — MODIFY: register `memo_phone_national` (mirrors the `lower()` override registration).
- `backend/src/schemas/client.py`, `backend/src/services/client.py` — MODIFY: `phone` param + predicate in `list_clients_with_stats`.
- `packages/api-client/src/endpoints.ts` — MODIFY: `phone` in the client-list params interface.
- `frontend/admin/app/components/shared/RemoteSearchSelect.tsx` — MODIFY: parameterize threshold + query building (Photos migrate with identical behavior).
- `frontend/admin/app/components/shared/PhoneInput.tsx` — NEW: mask + phone typeahead wrapper (the caret isolation seam).
- `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx`, `ActivityDetailsModal.tsx`, `frontend/admin/hooks/useRecordMutations.ts` — MODIFY: pick plumbing (`client_id`), read-only freeze, save-time resolution.
- Tests: `backend/tests/test_api_clients.py`, `backend/tests/test_domain_phone_digits.py` (NEW), `packages/api-client` existing suite, admin `__tests__/` (component + hook), NEW `frontend/admin/e2e/client-phone-typeahead.spec.ts`.

**Commits:** per-task, prefix `feat(#221):` / `test(#221):` / `chore(#221):`. Single PR at the end.

**Ordering invariants (keep the build green):** Task 1 → 2 → 3 (backend before the typed client); Task 4 → 5 → 6 → 7 (component generalization before the phone wrapper before wiring before save logic). Task 6's `client_id` plumbing is what Task 7's resolution builds on.

---

## Task 1: Backend — `to_national_digits` helper + `memo_phone_national` SQLite function

### Classification: trivial
### Required Docs
- `docs/specs/2026-09-07-client-phone-typeahead-design.md` §3 — the reduction rule (strip non-digits; drop leading `7`/`8` when exactly 11 digits remain)
- `backend/src/db/database.py` — the existing `lower()` override registration pattern (M5) to mirror

### Files
- CREATE `backend/src/domain/phone_digits.py`
- MODIFY `backend/src/db/database.py`
- TEST `backend/tests/test_domain_phone_digits.py` (NEW)

### Steps
- [ ] Create `backend/src/domain/phone_digits.py`:
```python
import re

_NON_DIGITS = re.compile(r"\D+")


def to_national_digits(value: str | None) -> str | None:
    """Spec §3: strip non-digits; drop the leading 7/8 of an 11-digit RU number.

    Tolerant by design — never parses, never raises; NULL/empty/no-digits -> None.
    """
    if not value:
        return None
    digits = _NON_DIGITS.sub("", value)
    if not digits:
        return None
    if len(digits) == 11 and digits[0] in "78":
        digits = digits[1:]
    return digits
```
- [ ] In `backend/src/db/database.py`, next to the Cyrillic-safe `lower()` override, register `memo_phone_national` through the same event-listener mechanism (aiosqlite `create_function` / SQLAlchemy `do_connect` event — copy the exact pattern the `lower()` override uses):
```python
def memo_phone_national(value):  # registered as "memo_phone_national"
    from src.domain.phone_digits import to_national_digits
    return to_national_digits(value)
```
  (Import path must match the file's existing import style; the function returns `None` for NULL — SQLite LIKE on NULL yields NULL → predicate false, which is the spec §3 "NULL never matches".)
- [ ] RED: `backend/tests/test_domain_phone_digits.py` — parametrized cases: `"+79991234567"→"9991234567"`, `"8 999 123-45-67"→"9991234567"`, `"89991234567"→"9991234567"`, `"9991234567"→"9991234567"` (10 digits untouched), `"+375 29 123-45-67"→"375291234567"` (12 digits untouched), `"+49 170 1234567"→"491701234567"`, `"12345678901"→"2345678901"` (11 digits starting `1` — untouched: only 7/8 strip), `"abc"→None`, `None→None`, `""→None`.
- [ ] GREEN: implement; run `python -m pytest tests/test_domain_phone_digits.py -q` → green. Full suite `python -m pytest -q` → green.
- [ ] Commit: `feat(#221): to_national_digits helper + memo_phone_national SQLite function`

### DoD
The §3 reduction exists once, unit-tested at the edge cases; the SQL function is registered alongside `lower()`; full backend suite green.

---

## Task 2: Backend — `phone` filter on `GET /api/v1/clients`

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-client-phone-typeahead-design.md` §4 — validation bounds (4–15 digits after strip → else 422), predicate shape, AND-combination, "silently ignored" trap
- `docs/domain-rules/clients.md` — "List `?phone=` (digits-mode phone filter, GH #221)" and "List `?q=`" sections (relationship between the two modes)

### Files
- MODIFY `backend/src/schemas/client.py` (`ClientListParams`, `:98-119`)
- MODIFY `backend/src/services/client.py` (`list_clients_with_stats`, `:86-275` — NOT only the `search_fields` matrix)
- TEST `backend/tests/test_api_clients.py`

### Steps
- [ ] `schemas/client.py` — add to `ClientListParams`:
```python
    phone: str | None = Field(default=None, description="GH #221: digits-mode national-substring filter")

    @field_validator("phone")
    @classmethod
    def _phone_digits(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        digits = re.sub(r"\D+", "", v)
        if not (4 <= len(digits) <= 15):
            raise ValueError("phone must contain 4-15 digits after stripping non-digits")
        return digits
```
  (Import `field_validator`/`re` per file style; Pydantic ValueError in a validator → 422, matching how `q` bounds reject.)
- [ ] `services/client.py` — in `list_clients_with_stats`, where `params.q` builds its predicate (cf. `:162` — line drifts; locate by the `search_predicate`/`params.q` usage), add alongside:
```python
    if params.phone:
        filters.append(
            func.memo_phone_national(Client.phone).like(f"%{params.phone}%")
        )
```
  The bound value is digits-only (validator guarantees it) → no LIKE-wildcard escaping needed. Apply BEFORE the COUNT so `total` reflects the filtered set (same invariant as `q`).
- [ ] RED: extend `tests/test_api_clients.py`:
  - seed clients `+79991234567`, `8 999 123-45-67` (second client, same national digits tail `9991234567` — use distinct tails per assertion), `+375 29 123-45-67`, `9991234567`-style national, one archived with a matching number, one with `phone=None`;
  - `GET /api/v1/clients?phone=999123` → returns the RU-format and masked-format clients, excludes the BY one and the NULL one;
  - `?phone=37529` → the BY client;
  - `?phone=4567` → tail-substring matches `+79991234567`;
  - `?phone=89991234567` (11 digits with leading 8) → matches `+79991234567` (query-side strip);
  - archived client: excluded by default, included with `?status=all`;
  - 422: `?phone=12` (short), `?phone=` + 16 digits, `?phone=abc` (empty after strip);
  - `?phone=999&q=test` → AND;
  - `?q=999123` unchanged behavior (literal substring regression) and pagination envelope `{items,total,page,per_page}` reflects the phone filter.
  Run `python -m pytest tests/test_api_clients.py -x -q` → fails (param ignored / 422 missing).
- [ ] GREEN: implement the schema+service changes → tests pass.
- [ ] Full backend suite green; commit: `feat(#221): digits-mode phone filter on client list`

### DoD
`?phone=` filters by national-digit substring across stored formats with 4–15-digit validation; `q` behavior byte-identical; predicate applied before COUNT.

---

## Task 3: api-client — `phone` on the client-list params

### Classification: trivial
### Required Docs
- `docs/specs/2026-09-07-client-phone-typeahead-design.md` §4 touch-point 4
- `packages/api-client/src/endpoints.ts` `:393-398` — the current client-list params interface

### Files
- MODIFY `packages/api-client/src/endpoints.ts`
- TEST existing `packages/api-client` suite

### Steps
- [ ] Add `phone?: string` to the client-list params interface (next to `q`/`status`/`page`/`per_page`), with a one-line comment `// GH #221: digits-mode national-substring filter, 4-15 digits`.
- [ ] Extend the existing params-serialization test (or add one if none covers the client list): `{phone: '999123'}` serializes to `?phone=999123`.
- [ ] `npm test` in `packages/api-client/` → green. Commit: `feat(#221): api-client phone list param`

### DoD
Typeahead calls compile with a typed `phone` param; api-client suite green.

---

## Task 4: Admin — parameterize `RemoteSearchSelect`

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-client-phone-typeahead-design.md` §2 decision 9, §5 first bullet
- `frontend/admin/app/components/shared/RemoteSearchSelect.tsx` — current hardcoded `q.length < 2` clamp (`:98-103`) and request building
- `docs/domain-rules/_overview.md` — Naming Conventions (component props)

### Files
- MODIFY `frontend/admin/app/components/shared/RemoteSearchSelect.tsx`
- MODIFY `frontend/admin/app/(main)/photos/components/PhotoModal.tsx`, `PhotosFilters.tsx` (migrate to explicit props)
- TEST existing photos typeahead tests (regression)

### Steps
- [ ] Replace the hardcoded clamp with props, keeping defaults = today's behavior:
```tsx
type Props<T> = {
  // ...existing props...
  minChars?: number;                       // default 2 — current behavior
  canSearch?: (input: string) => boolean;  // default: q.length >= minChars
  buildParams?: (input: string) => Record<string, string | number>; // default: { q: input }
};
```
  The clamp becomes `if (!canSearch(q)) { setResults([]); setIsOpen(false); return; }` and the fetch uses `buildParams(q)`.
- [ ] Migrate both Photos consumers to pass nothing (defaults) or the explicit equivalent — behavior must be byte-identical (min 2 chars, `?q=`).
- [ ] RED-first regression: run the existing photos/RemoteSearchSelect vitest files → must stay green before and after (`npx vitest run app/components/shared` + photos component tests).
- [ ] `npx tsc --noEmit`, `npm run lint` → green. Commit: `refactor(#221): parameterize RemoteSearchSelect threshold + query building`

### DoD
Threshold and query building are consumer settings; Photos behavior provably unchanged (existing tests green, no snapshot churn).

---

## Task 5: Admin — `PhoneInput` typeahead (mask, 4-digit threshold, `?phone=` requests)

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-client-phone-typeahead-design.md` §2 decisions 4/5/8, §5 (incl. the G1b digits-source amendment), §7
- `docs/domain-rules/clients.md` — "Record-form phone typeahead (GH #221)" + "List `?phone=`"
- `docs/design-system.md` — input/dropdown styling conventions (blend with existing `inputClass`/dropdown styles)

### Files
- MODIFY `frontend/admin/package.json` (add `libphonenumber-js` — same `^1.x` version family as `frontend/web`)
- CREATE `frontend/admin/app/components/shared/PhoneInput.tsx`
- TEST `frontend/admin/app/components/shared/__tests__/PhoneInput.test.tsx` (NEW)
- TEST `frontend/admin/e2e/client-phone-typeahead.spec.ts` (NEW — scenario 7 lives here)

### Steps
- [ ] `npm install libphonenumber-js` in `frontend/admin/`.
- [ ] Create `PhoneInput.tsx` — built ON the parameterized `RemoteSearchSelect` (Task 4) + `AsYouType` from `libphonenumber-js/min`, imported inside this module (metadata rides per-route splitting):
```tsx
import AsYouType from "libphonenumber-js/min/AsYouType";

// controlled loop per keystroke:
const digits = raw.replace(/\D+/g, "");
const asyou = new AsYouType("RU");            // national default; '+' switches international
const formatted = asyou.input(digits);        // display value (WYSIWYG)
const national = asyou.getNationalNumber() ?? "";  // SEARCH digits — never scrape the display
```
  Props/behavior:
  - `canSearch: (national.length >= 4)` and `buildParams: (national) => ({ phone: national, per_page: 10 })` — passed to `RemoteSearchSelect`; threshold counts DIGITS (`+7 (9` = 1), never characters;
  - option row: `${name || "Без имени"} · ${phone}`; active-only (server default — do NOT send `status`);
  - selection → `onPick(client: {id, name, phone})`; the field then shows `name · phone` READ-ONLY with a clear (×) affordance (pattern: `RemoteSearchSelect` selected state); clearing re-enables typing;
  - `data-testid="input-phone"` preserved on the input;
  - loading / zero-results-silent states per existing typeahead idioms; debounced 300 ms (inherited);
  - caret is NOT managed (decision 8): end-of-string typing is exact; mid-string edits may jump — accepted v1 limitation, this wrapper is the isolation seam.
- [ ] RED: `PhoneInput.test.tsx` — (a) typing `9991234` renders `+7 (999) 123-4…` progressively (RU grouping); typing `+375291234567` renders BY grouping; (b) 3 digits → no request (mock fetch asserts zero calls), 4th digit → one debounced request with `phone=<national digits>`; (c) typing `8999…` sends national digits WITHOUT the phantom `8` (digits-source amendment); (d) suggestion rows render `Без имени` for nameless clients; (e) pick → read-only + × shown; clear → typing restored; (f) paste `+7 999 123-45-67` → reformatted on next change, query digits `9991234567`.
- [ ] GREEN: implement → tests green; `npx tsc --noEmit`, `npm run lint` → green.
- [ ] **E2E test for scenario 7 passes (RED-GREEN-REFACTOR)**: in `e2e/client-phone-typeahead.spec.ts` — type 3 digits → no dropdown/no request (route spy); continue to full number → formatted display; save → stored phone equals the visible string.
- [ ] Commit: `feat(#221): PhoneInput typeahead — mask, 4-digit threshold, digits-source query`

### DoD
Mask + threshold + query semantics per spec §5 incl. the digits-source amendment; scenario 7 E2E green; unit suite green.

---

## Task 6: Admin — wire `PhoneInput` into `NewBookingTab` (pick = client id, read-only freeze, no onBlur)

### Classification: large
### Required Docs
- `docs/specs/2026-09-07-client-phone-typeahead-design.md` §2 decisions 2/10, §5 Selection/Removed
- `docs/domain-rules/clients.md` — "Record-form phone typeahead (GH #221)" (freeze semantics, name honesty)
- `frontend/admin/hooks/useRecordMutations.ts` `:46-52` (`CreateRecordInput`) and `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx:123-141` (submit chain)

### Files
- MODIFY `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx`
- MODIFY `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`
- MODIFY `frontend/admin/hooks/useRecordMutations.ts` (`CreateRecordInput` gains `client_id?: string | null`)
- TEST extend `frontend/admin/__tests__/useRecordMutations.test.ts`, modal component tests; E2E scenarios 1, 2, 5, 6

### Steps
- [ ] `NewBookingTab.tsx`:
  - replace the free-text phone input + `handlePhoneBlur` (REMOVED — `:37-47`, incl. its `setName` auto-fill) with `<PhoneInput onPick={...} />`;
  - local state `pickedClient: {id, name, phone} | null`; on pick → phone+name fields render read-only (name shows `pickedClient.name`, editable only when `pickedClient === null` — decision 10: editing a client's name belongs to the client card); × clears the pick and restores both fields;
  - submit payload: `pickedClient ? { client_id: pickedClient.id } : { phone: <visible formatted string>, name }`.
- [ ] `ActivityDetailsModal.tsx` (`handleNewBookingSubmit`, `:123-141`): pass `client_id` through unchanged shape — the input type now carries it.
- [ ] `useRecordMutations.ts`: `CreateRecordInput` gains `client_id?: string | null`; in `createRecord`, if `client_id` is set → skip the resolve-or-create block entirely and use that id for the record's client (visitor creation unchanged). The exact-route call `getClientByPhone` disappears from the picked path (stays in the unpicked path until Task 7 replaces it).
- [ ] RED-first unit/integration: `useRecordMutations.test.ts` — picked path creates the record with `client_id`, never calls `getClientByPhone`/`createClient`; modal test — pick freezes fields, × restores, name read-only when picked.
- [ ] **E2E tests for scenarios 1, 2, 5, 6 pass (RED-GREEN-REFACTOR)** — same spec file as Task 5:
  - S1: seed `Иванова +79991234567`; type `999123` → pick the row → save → record's client is Иванова;
  - S2: seed old-format `8 999 123-45-67`; type `+7999…` → the row appears;
  - S5: seed archived with matching number → absent from suggestions;
  - S6: open an existing record's edit → client shown, save → client unchanged.
- [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run lint` → green. Commit: `feat(#221): record form binds picked client by id — read-only freeze, onBlur removed`

### DoD
Pick → id-bound record with frozen phone+name; unpicked path unchanged; scenarios 1/2/5/6 E2E green.

---

## Task 7: Admin — save-time resolution in `useRecordMutations` (no duplicates, fail closed)

### Classification: standard
### Required Docs
- `docs/specs/2026-09-07-client-phone-typeahead-design.md` §6 (fresh fetch, first-match parity, fail-closed), §7 (failure = blocked save)
- `docs/domain-rules/clients.md` — "Record-form phone typeahead (GH #221)" (save-time paragraph)

### Files
- MODIFY `frontend/admin/hooks/useRecordMutations.ts`
- TEST extend `frontend/admin/__tests__/useRecordMutations.test.ts`; E2E scenarios 3, 4

### Steps
- [ ] Add the completeness guard FIRST (spec §2 decision 11, §6 step 2) — in `NewBookingTab`'s submit (it owns the visible value) before the mutation fires:
```ts
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
// unpicked path only; picked clients are never validated (stored data)
const parsed = parsePhoneNumberFromString(phone, "RU"); // same RU default as the AsYouType mask
if (!parsed?.isValid()) {
  setSubmitError("Проверьте номер телефона — возможно, он введён не полностью");
  return; // nothing fetched, nothing created
}
```
- [ ] Replace the unpicked `getClientByPhone`-exact call in `createRecord` with:
```ts
// spec §6: fresh full-digits fetch — never the suggestion snapshot
const national = toNationalDigits(input.phone);          // TS mirror of spec §3 (strip \D; drop leading 7/8 when 11 digits)
const { items } = await getClientsPaged({ phone: national, per_page: 10 });
const exact = items.find((c) => toNationalDigits(c.phone) === national);
const clientId = exact ? exact.id : (await createClient({ phone: input.phone, name: input.name })).id;
```
  (`toNationalDigits` — small exported util colocated in the hook file or `lib/`; mirrors `to_national_digits` exactly, incl. the 11-digit 7/8 rule. `input.phone` for creation stays the VISIBLE formatted string — WYSIWYG.)
- [ ] Failure semantics: the fetch/`createClient` throwing propagates as today — the mutation errors, the modal shows the existing retryable error UI; NO silent create on fetch failure (spec §6: fail closed). Verify the existing error surfacing covers it; if the modal currently swallows mutation errors, surface a toast «Не удалось проверить клиента — попробуйте ещё раз».
- [ ] RED-first: `useRecordMutations.test.ts` + form test — (0) incomplete number (`+7 (999) 123`): save blocked with the message, no fetch, no `createClient`; (a) existing client `+79991234567`, input `+7 (999) 123-45-67` → record bound to the EXISTING client, `createClient` NOT called, client count unchanged; (b) unknown number → `createClient` called with the visible string; (c) fetch rejects → mutation rejects (no `createClient` call); (d) two clients sharing the national digits → the FIRST returned row binds (first-match parity).
- [ ] **E2E tests for scenarios 3, 4 pass (RED-GREEN-REFACTOR)**:
  - S3: type an unknown full number (no pick) → save → new client exists with the phone exactly as displayed; type a PARTIAL number → save → blocked with «Проверьте номер телефона…», no client created;
  - S4: seed `+79991234567`; type the masked form, IGNORE the suggestion, save → record bound to the seeded client, client count unchanged.
- [ ] Full admin suite + `npx tsc --noEmit` + lint → green. Commit: `feat(#221): save-time digits resolution — no duplicates, fail closed`

### DoD
Unpicked saves never duplicate an existing active client (any stored format); fetch failure blocks the save; scenarios 3/4 E2E green; `getClientByPhone` no longer referenced by the record-form flow.

---

## Final checks (whole plan)

- [ ] All 7 scenario E2E tests green (`npm run test:e2e -- e2e/client-phone-typeahead.spec.ts`); backend + api-client + admin suites green; `grep -r "getClientByPhone" frontend/admin` → no record-form references remain (route itself untouched in backend).
- [ ] Spec §10 boundaries hold: no storage normalization, `q` untouched, exact route untouched, Photos unchanged, no country dropdown, no rebind on edit.
