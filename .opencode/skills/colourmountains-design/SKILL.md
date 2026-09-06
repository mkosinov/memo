---
name: colourmountains-design
description: Use when building UI components, sections, or pages for the colourmountains.ru website. Provides design direction, brand guidelines, and mobile-first overlay patterns.
---

# Colour Mountains Design System

> Adapted from Anthropic's `frontend-design` skill for the colourmountains.ru project.

## Brand Identity

```
Brand:    #004D56 (deep teal) — "Colour Mountains teal"
Gold:     #C49A2E — accents, prices, highlights
Dark:     #1E2D2F — sidebar, dark backgrounds, overlays
Bg:       #FAFAFA — page background
Card Bg:  #FFFFFF with 80% opacity (transparent fill)
Radius:   16px (--radius)
Shadow:   shadow-site-card (subtle elevation)
```

**Typography:**
- Display: **Playfair Display** — headings, hero titles, large text
- Body: **system sans-serif** (Inter fallback) — body text, descriptions
- Playfair italic for elegant accents (prices, dates)

## Design Principles

### 1. Mobile-First
- Base layout: **390px viewport** (iPhone 12/13 width)
- Content never exceeds viewport width
- Horizontal scroll only for carousels (CalendarLine, MKCarousel)
- Touch targets ≥ 44px

### 2. Overlay Pattern
Navigation, filters, details, booking — all use **full-screen overlay** (not modals, not sheets):
- Overlay slides up from bottom (not left/right)
- Semi-transparent dark background (#1E2D2F at 60% opacity)
- Close button at top-left or swipe-down gesture
- Content scrolls within overlay if needed
- Overlay covers entire viewport including status bar

### 3. Card Stack Aesthetic
- Cards with transparent/translucent backgrounds
- Stacked overlapping cards (like a deck of cards)
- Subtle shadow per card
- Active card slightly elevated or scaled
- Smooth horizontal snap-scroll between cards

### 4. Atmosphere & Texture
- Mountain theme: earthy tones, natural greens, stone grays
- Subtle noise/grain texture on overlays and hero background
- Gradient overlays (teal-to-transparent) for image fades
- Generous negative space — not crowded
- Content feels airy, calm, premium

## Component Design Rules

| Component | Visual Rules |
|-----------|-------------|
| **Header** | Fixed top, translucent blur bg, contains time + logo + menu icon |
| **Button** | Rounded-full (9999px), min height 48px, gold bg or outline |
| **Pill** | Small rounded-full chip, muted bg, used for filters/categories |
| **Card** | 16px radius, white/80% opacity, shadow, image on top |
| **CalendarLine** | Horizontal scrolling date pills, selected state = gold |
| **Overlay** | Full-screen, bg=dark at 60%, content card at bottom with 16px radius top corners |
| **Carousel** | Snap-scroll horizontal, peek of next card, dots or no indicators |

## Motion Guidelines

- **Transform & opacity only** — compositor-friendly
- **Staggered reveals** — cards/items fade in with `animation-delay` cascade
- **Page load**: hero image → title → cards (in sequence)
- **Overlay open**: slide up (200-300ms ease-out)
- **Hover**: subtle scale (1.02-1.05) on cards, color shift on buttons
- **Scroll-triggered**: fade-in sections as user scrolls
- **Honor `prefers-reduced-motion`** — provide static fallback

## Anti-Patterns — Avoid These

| Anti-Pattern | Why | Use Instead |
|-------------|-----|-------------|
| Inter/Roboto/Arial | Generic, no character | Playfair Display for display text |
| Purple gradients | Overused "AI aesthetic" | Teal-to-gold or teal-to-transparent |
| Standard card grid | Boring, not memorable | Stacked carousel with card overlap |
| Side modals | Not mobile-friendly | Full-screen bottom overlay |
| Hardcoded colors | Breaks theme consistency | CSS variables (--brand, --gold, --radius) |
| Over-animation | Annoying, performance hit | Targeted entry animations only |
| Horizontal padding > 24px | Wastes space on mobile | 16px safe padding |
| Feature-sliced folders | Over-engineering | Clean architecture layers |
| Third-party component libs | Bloated, hard to customize | Custom ui/ components |
| TanStack Query (for MVP) | Too much overhead for 3 queries | Simple hooks with useState/useEffect |

## Design Process

Before coding a new section/component:
1. **Read the design system** (`docs/design-system.md`) — know your tokens
2. **Check the prototype** — `sketches/colour-mountains-v4.html` for reference
3. **Review brand colors** — teal, gold, dark, white at 80%
4. **Choose bold direction** — airy/premium/natural (not generic)
5. **Implement** — mobile-first, overlay pattern, clean architecture
6. **Self-review** — check against anti-patterns table above

## File Reference

- `docs/design-system.md` — full design tokens
- `sketches/colour-mountains-v4.html` — UI prototype reference
- `docs/schedule-ui.md` — calendar/schedule patterns
- `docs/specs/2026-05-20-colourmountains-website-design.md` — approved design doc
