# MKCarousel + Layout — Current State (v3)

## Layout Architecture

```
<main> (bg-surface, normal flow)
  ├─ Hero (36svh, scrolls away, transparent header REMOVED)
  │
  └─ Workspace (sticky top-0, h-[100dvh], flex-col, overflow-hidden)
       ├─ Header (white bg, flex-shrink-0, ~56px)
       ├─ CalendarLine (~60px)
       ├─ FilterPills (~40px)
       ├─ LocationFilter (~40px)
       ├─ MKCarousel (flex-1 min-h-0, fills remaining space)
       ├─ Reviews (~30px)
       └─ GuestGallery wrapper (pb-14 to avoid ChatBar)
            └─ GuestGallery (~140px)

ChatBar (fixed bottom-0 z-40, overlays workspace bottom)
```

## Height Budget (iPhone SE ≈ 660dvh)
| Element | Height |
|---------|--------|
| Header | ~56px |
| CalendarLine | ~60px |
| FilterPills | ~40px |
| LocationFilter | ~40px |
| Reviews | ~30px |
| GuestGallery | ~140px |
| **Fixed total** | **~366px** |
| **Carousel** | **~294px** (660 - 366) |

## What Works
- ✅ **Hero** scrolls away, workspace sticks at top:0 when reached
- ✅ **Header** now inside workspace (white bg), NOT fixed/absolute — no overlap on CalendarLine
- ✅ **Workspace** = exactly 100dvh, no inner scroll needed
- ✅ **Carousel** fills all remaining space via `flex-1 min-h-0`
- ✅ **ChatBar** overlays bottom with `fixed`, GuestGallery has `pb-14`
- ✅ **Empty state** holds height when no cards
- ✅ **TypeScript** compiles clean

## Key Changes (this round)
- Header removed from Hero (was `absolute`, caused overlap)
- Header moved to workspace as first element (`flex-shrink-0`, white bg)
- Header no longer `fixed` — flows normally inside sticky container

## Key Files
1. `apps/web/app/page.tsx` — layout structure, Header in workspace
2. `apps/web/app/components/Header.tsx` — removed `fixed top-0`, now flows
3. `apps/web/app/sections/Hero.tsx` — Header removed, only image+content
4. `apps/web/app/components/MKCarousel.tsx` — carousel logic, empty state
5. `apps/web/app/hooks/useCardStack.ts` — stack state management

## Dev Server
- Running on port 3005 (`npm run dev`) — DO NOT restart

## Potential Issues
- On very small screens (SE, 660px), carousel gets ~294px — may feel tight
- Header is white immediately when workspace sticks (no transparency transition)

---

## Quick Edit Mode (2026-05-23)

**Режим:** Быстрые правки — пользователь пишет что не нравится, я вношу изменения. Без тестов, без лишних шагов. Только код.

**Dev Server:** порт 3005 — проверить

**Active Issues:**
- [x] Картинки не отображались — заменены внешние Unsplash URL'ы на локальные файлы
  - 15 JPEG (~1.1MB), тематически подходящие
- [x] LocationFilter — из отдельной строки превращён в пилюлю в одной строке с FilterPills
  - По тапу — Overlay со списком локаций (вариант 1.4)

**Images (public/images/):**
| Файл | Размер | Тема |
|------|--------|------|
| `hero-bg.jpg` | 128KB | Горы на закате |
| `card-seascape.jpg` | 98KB | Морской пейзаж маслом |
| `card-watercolor.jpg` | 57KB | Арт/рисование |
| `card-family.jpg` | 79KB | Семья рисует |
| `card-animals.jpg` | 86KB | Детский рисунок |
| `card-mountain-acrylic.jpg` | 107KB | Горный пейзаж |
| `card-shopper.jpg` | 54KB | Шоппер/сумка |
| `guest-1..8.jpg` | 17–51KB | Разные техники |

**Changed files:**
- `app/sections/Hero.tsx` — img src → `/images/hero-bg.jpg`
- `app/lib/api/activities.ts` — все `.svg` → `.jpg`

**Images (public/images/):**
- `hero-bg.jpg` — фон Hero (1200x800)
- `card-seascape.jpg`, `card-watercolor.jpg`, `card-family.jpg`, `card-animals.jpg`, `card-mountain-acrylic.jpg`, `card-shopper.jpg` — карточки активностей (600x450)
- `guest-1.jpg` — `guest-8.jpg` — фото гостей (400x300)

**Changed files:**
- `app/sections/Hero.tsx` — img src → `/images/hero-bg.jpg`
- `app/lib/api/activities.ts` — image_url и guest_photos → локальные пути
- `app/lib/api/gallery.ts` — url → локальные пути
