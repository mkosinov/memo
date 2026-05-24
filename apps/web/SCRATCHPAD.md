# Scratchpad — Colourmountains Website Quick Edits

## Project Location
`/root/workspace/memo/.worktrees/feat-colourmountains-website/apps/web`

## Stack
- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Framer Motion
- Embla Carousel

## Current Status
- Dev server: needs verification
- Build: needs verification
- No active issues tracked

## File Structure

### Pages
- `app/page.tsx` — main page (Hero + CalendarLine + FilterPills + LocationFilter + MKCarousel + Reviews + GuestGallery + ChatBar + HamburgerMenu + ActivityDetail + BookingOverlay)

### Sections
- `app/sections/Hero.tsx`
- `app/sections/Reviews.tsx`
- `app/sections/GuestGallery.tsx`

### Components
- `app/components/MKCard.tsx`
- `app/components/MKCarousel.tsx`
- `app/components/CalendarLine.tsx`
- `app/components/FilterPills.tsx`
- `app/components/LocationFilter.tsx`
- `app/components/ActivityDetail.tsx`
- `app/components/BookingOverlay.tsx`
- `app/components/ChatBar.tsx`
- `app/components/HamburgerMenu.tsx`
- `app/components/Overlay.tsx`
- `app/components/Button.tsx`
- `app/components/Pill.tsx`
- `app/components/Header.tsx`
- `app/components/Counter.tsx`
- `app/components/ContactForm.tsx`

### Hooks
- `app/hooks/useCalendarDays.ts`
- `app/hooks/useActivities.ts`
- `app/hooks/useLocations.ts`
- `app/hooks/useGallery.ts`

### Lib
- `app/lib/` — api, model (dto/view/domain), mappers, cookies, geolocation, errors

## Quick Edit Mode
- No tests
- No extra steps
- Direct code changes only
- User reports issues → I fix code

## Active Issues
_(none yet — waiting for user feedback)_

## Design Reference
- v4: `sketches/colour-mountains-v4.html`
- Design system: `docs/design-system.md`
- Dark sidebar: #1E2D2F
- Brand: #004D56
- Card-based schedule
