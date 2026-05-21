# colourmountains.ru Website Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development.

**Goal:** Fix UI to match updated design spec (user corrections from 2026-05-21)

**Architecture:** Incremental fixes to existing components, no structural changes

**Tech Stack:** Next.js 14, React 18, Tailwind CSS, TypeScript

---

## Task 1: Calendar — Add Сегодня/Завтра tabs + 4-day carousel

**Classification:** Standard

**Files:**
- Modify: `apps/web/app/components/CalendarLine.tsx`
- Modify: `apps/web/app/hooks/useCalendarDays.ts` (or create new hook)
- Update tests

**Changes:**
1. Add "Сегодня" and "Завтра" text tabs above the calendar line
2. When "Сегодня" selected — show today's MKs (no calendar line visible)
3. When "Завтра" selected — show tomorrow's MKs (no calendar line visible)
4. When "Завтра" is default selected, show calendar line with 4 days starting from tomorrow
5. Calendar line should show only 4 days (not 14)
6. Active tab: `--brand` color, underline or bg
7. Update `useCalendarDays` to return 4 days starting from tomorrow

**Tests:**
- "Сегодня" tab is visible
- "Завтра" tab is visible
- Clicking "Сегодня" filters to today
- Clicking "Завтра" filters to tomorrow
- Calendar line shows 4 days starting from tomorrow

---

## Task 2: Filters — Pills + Location in one line

**Classification:** Small

**Files:**
- Modify: `apps/web/app/components/FilterPills.tsx`
- Modify: `apps/web/app/components/LocationFilter.tsx`
- Modify: `apps/web/app/page.tsx` (layout)

**Changes:**
1. Put FilterPills and LocationFilter in one horizontal row
2. LocationFilter becomes first control (left side)
3. FilterPills on the right side of the same row
4. Both should fit in one line on mobile (390px)
5. "вместе" pill selected by default

**Tests:**
- Pills and location are in one line
- "вместе" is selected by default

---

## Task 3: MKCard — Remove location/material, change button

**Classification:** Small

**Files:**
- Modify: `apps/web/app/components/MKCard.tsx`

**Changes:**
1. Remove location display from card
2. Remove material display from card ("Акрил • 20×30")
3. Change button text from "Записаться" to "Подробнее"
4. Keep: photo, age category pill, title, time, social proof, price

**Tests:**
- Card does NOT show location
- Card does NOT show material
- Button says "Подробнее"

---

## Task 4: Card Stack — Visible cards behind + last card

**Classification:** Standard

**Files:**
- Modify: `apps/web/app/components/MKCarousel.tsx`
- Modify: `apps/web/app/components/MKCard.tsx` (stack styling)
- Modify: `apps/web/app/hooks/useCardStack.ts`

**Changes:**
1. Cards behind the front card should be visible (1-2 cards)
2. Cards behind should be smaller (scale down) and slightly offset
3. Add last card: "Индивидуальный мастер-класс в удобное для вас время. Материал — на ваш выбор. 8200 руб."
4. This card should look different (maybe outlined, not photo-based)
5. Clicking it opens BookingOverlay directly (no ActivityDetail)

**Tests:**
- 1-2 cards visible behind front card
- Last card shows "Индивидуальный мастер-класс"
- Last card opens BookingOverlay on click

---

## Task 5: ActivityDetail — 3/4 screen, hints instead of popups

**Classification:** Standard

**Files:**
- Modify: `apps/web/app/components/ActivityDetail.tsx`
- Modify: `apps/web/app/components/Overlay.tsx` (height)
- Remove/deprecate: `PriceDetails.tsx`, `MaterialDetails.tsx`, `LocationDetails.tsx`, `NextTime.tsx`

**Changes:**
1. Change overlay height from 50% to 75% (3/4 screen)
2. Replace "Подробнее" buttons with (i) hint icons
3. Clicking (i) shows tooltip/hint (not popup/overlay)
4. "В следующий раз" — show 3 date options as plain text (e.g., "17 мая 10:30, 18 мая 17:00")
5. Clicking date navigates to that event's ActivityDetail
6. Remove separate popup components (PriceDetails, MaterialDetails, LocationDetails, NextTime)

**Tests:**
- Overlay is 3/4 screen
- (i) icons show hints on click/hover
- "В следующий раз" shows text dates
- Clicking date opens that event

---

## Task 6: BookingOverlay — Counters by tariffs, Telegram default

**Classification:** Small

**Files:**
- Modify: `apps/web/app/components/BookingOverlay.tsx`
- Modify: `apps/web/app/components/Counter.tsx`

**Changes:**
1. Counters should be based on service tariffs (not hardcoded adult/child)
2. Show available tariff types from API
3. Change dropdown label to "Отправить детали записи в:"
4. Telegram should be first and default option
5. Options: Telegram (default), WhatsApp, Max

**Tests:**
- Counters match service tariffs
- Dropdown label is correct
- Telegram is default

---

## Task 7: Update API integration (age_tag filter)

**Classification:** Small

**Files:**
- Modify: `apps/web/app/hooks/useActivities.ts` (or similar)

**Changes:**
1. Change filter parameter from `category` to `age_tag`
2. Update API calls to use `age_tag` instead of `category`

**Tests:**
- API calls use `age_tag`

---

## Task 8: Run Visual Compliance Gate

**Classification:** Trivial (verification only)

**Actions:**
1. Start dev server
2. Run visual-compliance-check.sh
3. Verify all checks pass
4. If fail — create new fix tasks

---

## Acceptance Criteria

- [ ] "Сегодня" and "Завтра" tabs visible and functional
- [ ] Calendar line shows 4 days starting from tomorrow
- [ ] Filters and location in one line
- [ ] "вместе" selected by default
- [ ] Card shows "Подробнее" (not "Записаться")
- [ ] Card does NOT show location or material
- [ ] 1-2 cards visible behind front card
- [ ] Last card is "Индивидуальный мастер-класс"
- [ ] ActivityDetail is 3/4 screen
- [ ] Hints (i) instead of popups
- [ ] "В следующий раз" shows text dates
- [ ] Booking counters by tariffs
- [ ] Telegram default in dropdown
- [ ] All tests pass
- [ ] Build succeeds
