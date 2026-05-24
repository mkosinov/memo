# Session: colourmountains.ru Website

## Date: 2026-05-20
## Branch: feat/colourmountains-website

## Workflow Status

- [x] **Step 1: Brainstorming** — DONE, G1 passed
- [x] **Step 2: Writing Plans** — DONE, G2 passed
- [x] **Step 3: Git Worktree** — DONE, G3 passed
- [x] **Step 4: Subagent-Driven Development** — DONE, all 18 tasks completed
- [x] **Step 5: Documentation Commit** — DONE (commit `942a25b`)
- [ ] **Step 6: Finishing Development Branch** — PAUSED, awaiting user review

## Implementation Complete

All 18 tasks from the plan have been implemented and committed:

| # | Task | Classification | Status |
|---|------|----------------|--------|
| 1 | Update design-system.md (radius 16px, gold) | Small | ✅ |
| 2 | Initialize apps/web/ (Next.js, Tailwind, deps) | Standard | ✅ |
| 3 | Global styles and fonts | Small | ✅ |
| 4 | Base components (Header, Overlay, Button, Pill, HamburgerMenu) | Standard | ✅ |
| 5 | Hero section | Small | ✅ |
| 6 | CalendarLine + useCalendarDays hook | Standard | ✅ |
| 7 | Filters (FilterPills + LocationFilter) | Small | ✅ |
| 8 | Card Stack carousel (MKCarousel + MKCard + useCardStack) | Large | ✅ |
| 9 | ActivityDetail Overlay | Standard | ✅ |
| 10 | Booking Overlay (Counter + ContactForm + BookingOverlay) | Standard | ✅ |
| 11 | Popup components (PriceDetails, MaterialDetails, NextTime, LocationDetails) | Standard | ✅ |
| 12 | Reviews + GuestGallery sections | Small | ✅ |
| 13 | Sticky Chat Bar | Small | ✅ |
| 14 | API integration (3-layer architecture: api → model → transforms → hooks) | Standard | ✅ |
| 15 | Main page assembly (page.tsx) | Standard | ✅ |
| 16 | Auxiliary pages (8 pages) | Standard | ✅ |
| 17 | Cookie + geolocation utils | Small | ✅ |
| 18 | Tests and build verification | Standard | ✅ |

## Final Commit

- **Commit SHA:** `aaf851b`
- **Message:** `feat(web): implement colourmountains.ru public website`
- **Files:** 100 files changed, 6140 insertions(+), 12 deletions(-)
- **Branch:** `feat/colourmountains-website`

## Test Results

- **310 tests** across 42 test files — all passing
- **10 static pages** generated successfully
- **TypeScript:** zero errors
- **Build:** successful

## Current State

- All code is committed to `feat/colourmountains-website`
- Worktree: `.worktrees/feat-colourmountains-website`
- User is reviewing the implementation by running `npm run dev`
- Awaiting user feedback before proceeding to Step 6 (Finishing Development Branch)

## Next Steps (pending user feedback)

1. User reviews the website at `npm run dev`
2. User provides feedback (changes, fixes, or approval)
3. If changes needed: create fix tasks and dispatch implementers
4. If approved: proceed to Step 6 (merge locally or create PR)

## Workflow Fix (2026-05-21)

**Problem:** Gate G1 was bypassed — design spec was written and committed without user reviewing the written spec file. Design spec changed user requirements ("Сегодня/Завтра/Календарь" → "Календарь-линия") without approval.

**Fix applied:**
- Split Gate G1 into G1a (design concept approval) and G1b (written spec approval)
- G1b is now a HARD BLOCK — cannot proceed to Step 2 without explicit user confirmation
- Added rule: Design spec cannot override user's source documents without explicit approval
- Updated `superagents/skills/brainstorming/SKILL.md` and `superagents/agents/architect.md`
- Committed to superagents: `90d56b8`
- Synced to memo project

**Additional safeguards by @infra (2026-05-21):**
- Git pre-commit hook: blocks implementation commits unless scratchpad shows G1b approval
- Workflow state validator script
- Documentation updated in superagents/README.md, docs/workflow/README.md, memo/docs/harness/WORKFLOW.md
- New doc: WORKFLOW-SAFEGUARDS.md explaining the failure and fixes
- **Visual Compliance Gate (Step 4.5):** Playwright screenshots + DOM checks after all tasks complete, before docs
  - Script: `.opencode/scripts/visual-compliance-check.sh`
  - Soft block: if FAIL → user decides fix/override/abort
  - Spec files must now include `## Visual Compliance Checks` section
- **Commits:** superagents `ab79691`, memo `8b9f19c`
- **Status:** All committed. Container restart needed for agent/skill cache refresh.

## Fix Phase (2026-05-21)

**User updated spec** with corrections. Visual Compliance Gate run — multiple failures detected.

**Fix tasks:**
1. Calendar: add Сегодня/Завтра tabs + 4-day carousel
2. Filters: pills + location in one line
3. MKCard: remove location/material, Подробнее button
4. Card Stack: visible 1-2 cards behind, last card = Индивидуальный МК
5. ActivityDetail: 3/4 screen, hints instead of popups
6. BookingOverlay: counters by tariffs, Telegram default

**Status:** Fix plan created. Written spec approved by user (G1b passed). Proceeding to implementation.

## Documents

- Design: `docs/specs/2026-05-20-colourmountains-website-design.md`
- Plan: `docs/plans/2026-05-20-colourmountains-website-plan.md`
- Project Plan: `PLAN.md`

## User Review Fixes (2026-05-22)

### Fix 1: Logo в Header
- **Файлы:** `app/components/Header.tsx`, `public/logo.png` (new)
- **Что:** Заменил текст "ЦГ" на `<img src="/logo.png">` — скопировал из `sketches/Logo.png`
- **Причина:** Лого не использовалось в коде, только заглушка-текст

### Fix 2: Убрать max-width: 390px — full-width
- **Файлы:** `app/layout.tsx`, `app/globals.css`
- **Что:** Убрал `max-width: 390px` из body и layout — контент растянут на всю ширину экрана
- **Причина:** На десктопе были полосы `--bg` по бокам, full-width выглядит лучше

### Fix 3: Убрать горизонтальный скролл на мобильном (карточки вылезали)
- **Файлы:** `app/components/MKCarousel.tsx`, `app/page.tsx`, `app/globals.css`
- **Что:** Добавил `overflow-x-hidden` на контейнер карусели, `<main>`, и `body { overflow-x: hidden }`
- **Причина:** Framer-motion exit-анимации (`x: ±300`) и абсолютное позиционирование карточек создавали горизонтальный скролл

### Fix 4: Моковые даты — динамические (today, today+1, today+2)
- **Файлы:** `app/lib/api/activities.ts`
- **Что:** Заменил хардкод `2026-05-20` на `d(0)`, `d(1)`, `d(2)` — сегодня/завтра/послезавтра. Фильтр по дате включён обратно.
- **Причина:** Моковые даты стали stale, карточки не показывались

### Fix 5: CalendarLine — единая карусель с Сегодня/Завтра
- **Файлы:** `app/components/CalendarLine.tsx`, `app/hooks/useCalendarDays.ts`, `app/page.tsx`
- **Что:**
  - Убрал табы, теперь единая горизонтальная карусель: "Сегодня" "Завтра" 22 23 24 ... (14 дней)
  - `useCalendarDays` — 14 дней начиная с сегодня, без tab/setTab
  - Сегодня/Завтра — текст с тонким подчеркиванием (red при active)
  - Дни — стиль настенного календаря: белый фон, красная рамка `border-2 border-[#C8503C]` при выборе
  - Карусель `align: "start"`, начинается слева
  - Отступы: `pl-6`, `gap-4`

### Fix 6: Фильтры — pills влево, location ниже
- **Файлы:** `app/page.tsx`
- **Что:** FilterPills — верхняя строка, прижаты влево. LocationFilter — отдельная строка ниже

### Fix 7: Card Stack — циклическая прокрутка
- **Файлы:** `app/hooks/useCardStack.ts`, `app/components/MKCarousel.tsx`
- **Что:** Переделал с линейного index на circular buffer. Свайпнутая карточка возвращается в низ стопки. lastCard (Индивидуальный МК) показывается после свайпа всех обычных карт.
- **Тесты:** 9/9 passed

### Fix 8: MKCarousel — карточки прижаты влево
- **Файлы:** `app/components/MKCarousel.tsx`
- **Что:** `left-1/2 -translate-x-1/2` → `left-4` — карточки начинаются слева с отступом 16px

### Fix 9: Hero — `<img>` вместо `backgroundImage`
- **Файлы:** `app/sections/Hero.tsx`
- **Что:** Заменил div с `backgroundImage` на `<img>` — надёжнее для мобильных Safari
- **Причина:** Серый фон на мобильном вместо hero-картинки

### Fix 10: Logo в Header (записано ранее)
- **Файлы:** `app/components/Header.tsx`, `public/logo.png`

### Fix 11: Убрать max-width: 390px (записано ранее)
- **Файлы:** `app/layout.tsx`, `app/globals.css`

## Pending / Known Issues
- Картинки на мобильном (imac.local:3000) — Hero фон не грузится. Попытка fix через `<img>` вместо `backgroundImage` — статус неизвестен, пользователь начал новую сессию
- Hero-bg картинка скачана в `public/hero-bg.jpg` но НЕ использована (curl был запущен но прерван)
- Тесты: 295/298 passed, 3 failed (CalendarLine tests)
