# Current User Scenarios — Admin App

> **Date:** 2026-06-19
> **Status:** Draft (initial population)
> **Owner:** @docser (write/maintain)
> **Companion to:** `2026-06-19-testing-strategy-v2.md`

## Purpose

Single living source of truth for **what the user can do** in the admin app. Every user task is documented here, mapped to an E2E test, and linked to any related issues. This is referenced by:

- The testing strategy (how scenarios are tested)
- The PR template (author confirms new scenarios are added)
- Code review (reviewer checks coverage)

## How to use

- **Adding a feature?** Add a new scenario here + an E2E in the same PR.
- **Fixing a bug?** Link the bug to an existing scenario. If no scenario exists, add one.
- **Removing a feature?** Remove the scenario and its E2E.

## Scenarios

### Schedule (3 scenarios)

#### US-S01: Admin can click empty slot to create activity
**Pre:** Admin on `/schedule`, viewing a day
**Action:** Click on a free time slot (no activity card there)
**Outcome:** Create-activity dialog opens with `start`/`end` prefilled; admin can save

**E2E:** `frontend/admin/e2e/admin-clicks-empty-slot.spec.ts` (to be written)
**Status:** ❌ RED — bug #73 (click does nothing)
**Related:** —

#### US-S02: Admin can drag-and-drop activity to different time
**Pre:** Admin on `/schedule`, activity card visible
**Action:** Drag the card to a different time slot
**Outcome:** Activity updates with new start/end; persisted; re-rendered correctly

**E2E:** (existing) `frontend/admin/e2e/schedule.spec.ts` (drag-drop test)
**Status:** ⚠️ UNCLEAR — was working per audit; verify after batch fix
**Related:** #30, #32, #34 (DnD issues, all closed)

#### US-S03: Admin can see activity card with artist, service, time, occupied
**Pre:** Admin on `/schedule`, activity exists
**Action:** Look at the card
**Outcome:** Card shows: artist full name, service name + age, time pill, location, **occupied N/M seats** (N = sum of seats for active records)

**E2E:** `frontend/admin/e2e/occupied-calc.spec.ts` (to be written)
**Status:** ❌ RED — bug #84 (occupied counts records, not sum of seats; cancelled records included)
**Related:** #12, #27, #28, #29 (ActivityCard UI)

---

### ActivityDetailModal — Settings tab (2 scenarios)

#### US-M01: Admin can toggle "Приватное" with stacked layout
**Pre:** Admin opened an activity, on Settings tab
**Action:** Look at the "Приватное" field
**Outcome:** Label "Приватное" is **above** the selector (stacked, not in one line); admin can toggle on/off and change selector value

**E2E:** `frontend/admin/e2e/private-toggle-layout.spec.ts` (to be written)
**Status:** ❌ RED — bug #83 (label and selector in one line)
**Related:** —

#### US-M02: Admin can edit activity start/end
**Pre:** Admin on Settings tab
**Action:** Change start/end time, save
**Outcome:** Activity updated; schedule re-renders with new time

**E2E:** (existing) `frontend/admin/e2e/activity-details-modal.spec.ts`
**Status:** ✅ GREEN (assumed — not regressed in bug list)
**Related:** #47 (start ISO in API)

---

### ActivityDetailModal — Records tab (8 scenarios)

#### US-M03: Admin can add visitor with name/phone/seats and see it in modal without F5
**Pre:** Admin on Records tab
**Action:** Click "Добавить посетителя", fill name, phone, seats=2, save
**Outcome:**
- New record visible in list WITH name, phone, "2 места"
- Occupied in footer = +2 (sum of seats)
- No page refresh required
- Data persisted (verified via SQL)

**E2E:** `frontend/admin/e2e/admin-adds-visitor.spec.ts` (to be written)
**Status:** ❌ RED — bugs #75 (button doesn't work), #80 (form doesn't save), #85 (no invalidation)
**Related:** #8, #3, #13 (overlap)

#### US-M04: Admin can open client profile from a record
**Pre:** Admin on Records tab, record visible
**Action:** Click "Открыть профиль"
**Outcome:** Navigate to `/client/{id}` with card expanded; modal closes

**E2E:** `frontend/admin/e2e/admin-opens-profile.spec.ts` (to be written)
**Status:** ❌ RED — bug #76 (button doesn't work)
**Related:** —

#### US-M05: Admin can change record status via icons (not text)
**Pre:** Admin on Records tab, record visible
**Action:** Click status icon, choose new status from picker
**Outcome:** Icon updates; tooltip shows Russian name (Ожидание/Посетил/Отменил/Неявка); occupied recalculates if applicable

**E2E:** `frontend/admin/e2e/admin-changes-status.spec.ts` (to be written)
**Status:** ❌ RED — bugs #78 (StatusPicker missing), #77 (text instead of icons)
**Related:** #5, #6 (status display)

#### US-M06: Admin can manage multiple payments on a record (add and delete)
**Pre:** Admin on Records tab, record expanded, payments section visible
**Action:** Add 2 payments (1000₽, 500₽), delete the 500₽ one
**Outcome:**
- After adding 1st: list shows [1000₽]
- After adding 2nd: list shows [1000₽, 500₽] (NOT only the last)
- After deleting 500₽: list shows [1000₽]
- Total recalculates

**E2E:** `frontend/admin/e2e/admin-manages-payments.spec.ts` (to be written)
**Status:** ❌ RED — bug #79 (only last shown, delete broken)
**Related:** #7

#### US-M07: Admin can see seats count in record card
**Pre:** Admin on Records tab, record visible
**Action:** Look at the record card
**Outcome:** Card shows "N мест" (or "1 место" for N=1) with proper Russian plural form

**E2E:** covered by US-M03
**Status:** ❌ RED — bug #82 (seats not displayed)
**Related:** #10

#### US-M08: Admin can see client name in existing record card
**Pre:** Admin on Records tab, record with persisted client
**Action:** Look at the card
**Outcome:** Card shows client name (not just phone)

**E2E:** covered by US-M03
**Status:** ❌ RED — bug #81 (name not shown, only phone)
**Related:** #9

#### US-M09: Modal doesn't jump when switching tabs (Settings ↔ Records)
**Pre:** Modal open
**Action:** Switch between Settings and Records tabs several times
**Outcome:** Modal width and position do not change; height is fixed; if Records has long list, content scrolls internally (modal grows down only, not up/left/right)

**E2E:** `frontend/admin/e2e/modal-no-jump.spec.ts` (to be written)
**Status:** ❌ RED — bug #74 (modal jumps in height)
**Related:** #2

#### US-M10: Schedule footer ("x cards") blurs with the rest when modal opens
**Pre:** Modal open over `/schedule`
**Action:** Look at the footer of any day column
**Outcome:** "x cards" text in footer is blurred like the rest of the schedule (no inconsistent clarity)

**E2E:** `frontend/admin/e2e/modal-blur-footer.spec.ts` (to be written)
**Status:** ❌ RED — bug #86 (footer not blurred)
**Related:** #14

---

### Statuses (1 scenario)

#### US-ST01: All status displays use Russian: Ожидание / Посетил / Отменил / Неявка
**Pre:** Any page showing record status (table, modal, filter)
**Action:** Look at the status display
**Outcome:** Status shown as one of the 4 Russian strings (exact spellings above); never as enum value or English

**E2E:** `frontend/admin/e2e/statuses-russian.spec.ts` (to be written)
**Status:** ❌ RED — bug #77 (enum values shown)
**Related:** #5

---

## Coverage Matrix

| Scenario | E2E Test | Status | Linked Bugs |
|----------|----------|--------|-------------|
| US-S01 | `admin-clicks-empty-slot.spec.ts` | ❌ RED | #73 |
| US-S02 | `schedule.spec.ts` (existing) | ⚠️ UNCLEAR | #30, #32, #34 (closed) |
| US-S03 | `occupied-calc.spec.ts` | ❌ RED | #84 |
| US-M01 | `private-toggle-layout.spec.ts` | ❌ RED | #83 |
| US-M02 | `activity-details-modal.spec.ts` (existing) | ✅ assumed | #47 (closed) |
| US-M03 | `admin-adds-visitor.spec.ts` | ❌ RED | #75, #80, #85 |
| US-M04 | `admin-opens-profile.spec.ts` | ❌ RED | #76 |
| US-M05 | `admin-changes-status.spec.ts` | ❌ RED | #78, #77 |
| US-M06 | `admin-manages-payments.spec.ts` | ❌ RED | #79 |
| US-M07 | covered by US-M03 | ❌ RED | #82 |
| US-M08 | covered by US-M03 | ❌ RED | #81 |
| US-M09 | `modal-no-jump.spec.ts` | ❌ RED | #74 |
| US-M10 | `modal-blur-footer.spec.ts` | ❌ RED | #86 |
| US-ST01 | `statuses-russian.spec.ts` | ❌ RED | #77 |

**Summary:** 14 scenarios total. 10 new E2E needed (US-S01, US-S03, US-M01, US-M03, US-M04, US-M05, US-M06, US-M09, US-M10, US-ST01). 2 covered as side-effects of US-M03 (US-M07, US-M08 — assertions on name and seats). 2 use existing E2E (US-S02 → `schedule.spec.ts`, US-M02 → `activity-details-modal.spec.ts`). **10 new E2E RED → 0 GREEN** as of 2026-06-19. Target after Wave 4: **all ✅ GREEN**.

---

## Visual Compliance Checks

States that must be screenshot-stable. Verified by `visual-compliance-check.sh` during pre-push.

- [ ] `/schedule` with 1 activity (baseline)
- [ ] `/schedule` with 5+ activities (grid stress) — **NOT YET BASELINED**
- [ ] `/schedule` with `ActivityDetailModal` open, full backdrop blur — **NOT YET BASELINED**
- [ ] `ActivityDetailModal` — Settings tab, default state ✅ baseline (`modal-settings-chromium-linux.png`)
- [ ] `ActivityDetailModal` — Records tab, 1 record — **NOT YET BASELINED**
- [ ] `ActivityDetailModal` — Records tab, 5+ records (scrollable) — **NOT YET BASELINED**
- [ ] `ActivityDetailModal` — Records tab, with cancelled record — **NOT YET BASELINED**
- [ ] Status icon, 4 variants (Ожидание, Посетил, Отменил, Неявка) — **NOT YET BASELINED**

**Frozen at v2 ship:** only 4 existing baselines are stable. New baselines added in Wave 4 (after bugs are fixed, when UI is in known-good state).

---

## Update rules

| Trigger | Action |
|---------|--------|
| New feature in PR | Add scenario to this doc + new E2E (PR review checks) |
| Bug fix in PR | Link bug to existing scenario; update scenario status from ❌ to ✅ |
| New bug found | Add new scenario if no existing one matches; link bug |
| Feature removed | Remove scenario; mark E2E as deleted |
| Refactor | No change unless behavior changes |

**Always commit the doc update in the same PR as the code change.**
