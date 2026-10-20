---
name: frontend-clean-architecture
description: Use when designing or implementing frontend data flow with clean layer separation (API, Model, Mappers, Hooks, UI) in React/Next.js
---

# Frontend Clean Architecture (Data Flow)

> Version: 2.1 — 2026  
> Targets: React 18+, Next.js 14+, TypeScript 5+  
> Transport: `@memo/api-client` — the ONLY data transport. No local `lib/api/`, `lib/errors.ts`, or `lib/model/dto/` layers.

---

## When to Use

Use this skill when:
- Creating a new data flow (API → UI)
- Refactoring existing code to separate concerns
- Adding a new entity with API data
- Designing architecture for a new frontend app

---

## Layered Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  app/ page.tsx                    ← Composition root                 │
│  sections/ Hero.tsx               ← Composed sections                │
│     may use hooks                                                      │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│  ui/ MKCard.tsx                ← Dumb components                     │
│  Render-only. No API awareness. Props = ViewModel types.             │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│  hooks/ useLocations.ts    ← React hooks (only React-aware layer)   │
│  → react-query → @memo/api-client → mappers → exposes state         │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│  @memo/api-client             ← Sole transport (package)             │
│  Mirrors backend contracts: *Response types (snake_case, 1:1),      │
│  endpoint functions (getLocations, getPhotos, …), throws ApiError.  │
│  Mock/real switch lives inside the package. No local fetch layer.   │
└──────────────────────────────────────────────────────────────────────┘

lib/mappers/        ← Pure functions: *Response (contract) → View
                       Side-effect free, may call domain/
lib/model/view/     ← UI types (camelCase, formatted)
                       Imported by ui/, hooks/, lib/mappers/
lib/model/domain/   ← Business logic (optional), reuses contract types
```

---

## Dependency Rule (mandatory)

```
Strict import hierarchy — violations are architectural errors.
```

| Layer | May Import | Forbidden |
|-------|-----------|-----------|
| `app/` | everything | — |
| `sections/` | `ui/`, `hooks/`, `lib/*` | `@memo/api-client` (go through hooks) |
| `ui/` | `model/view/`, `lib/format` | `@memo/api-client`, `hooks/` |
| `hooks/` | EVERYTHING | `ui/`, `sections/`, `app/` |
| `lib/mappers/` | `model/*`, `@memo/api-client` (types), `lib/format` | react-query, `hooks/`, `ui/` |
| `lib/model/domain/` | `@memo/api-client` (types), other `model/domain/` | `hooks/`, `ui/` |
| `lib/model/view/` | nothing (types only) | everything |

### In plain English:
- **Components** know nothing about the transport or contract types
- **Hooks** are the only React-aware layer, can access everything except UI
- **Mappers** are pure functions — no React, no fetching
- **Transport** is the `@memo/api-client` package itself — never a local `lib/api/`

---

## Layer-by-layer Rules

### 1. Transport (`@memo/api-client`)

```typescript
// NO local data layer — the package owns transport:
import { getLocations, ApiError } from '@memo/api-client';

const page = await getLocations(); // → PaginatedResponse<LocationResponse>
```

- Package mirrors backend contracts: `*Response` types, snake_case fields (1:1 with API JSON)
- Endpoints are plain async functions (`getLocations`, `getPhotos`, …) — React-unaware
- Errors are thrown as `ApiError` exported by the package — never define a local one
- Mock/real switch lives inside the package — apps never hand-roll `fetch`
- There is no `lib/api/`, no `lib/errors.ts`, no `lib/model/dto/` in apps

### 2. Domain Model (`lib/model/domain/`)

```typescript
// lib/model/domain/activity.ts
import type { ActivityResponse } from '@memo/api-client';

export function canBookActivity(activity: ActivityResponse): boolean {
  return activity.capacity > 0;
}
```

- Reuses contract types from `@memo/api-client` (no duplication!)
- Pure functions, no side effects
- Optional layer — add only when business logic exists

### 3. Mapper (`lib/mappers/`)

```typescript
// lib/mappers/to-location-vm.ts
import type { LocationResponse } from '@memo/api-client';
import type { LocationView } from '@/app/lib/model/view/location';

export function toLocationVm(raw: LocationResponse): LocationView {
  return {
    id: raw.id,
    title: raw.title,
    address: raw.address ?? '—',
  };
}
```

- Pure function: contract `*Response` → View
- May call Domain Model
- snake_case → camelCase conversion
- Side-effect free, easy to test

### 4. ViewModel (`lib/model/view/`)

```typescript
// lib/model/view/activity.ts
export interface ActivityView {
  id: number;
  masterName: string;
  serviceName: string;
  category: string;
  priceFormatted: string;       // "3 500 – 5 500 ₽"
  durationLabel: string;        // "120 min"
  dateFormatted: string;        // "20 May"
  timeFormatted: string;        // "14:00"
  locationName: string;
  locationAddress: string;
  imageUrl: string;
  guestsLabel: string;          // "3 guest(s)"
  canBook: boolean;
  categoryColor: string;        // "#C49A2E"
}
```

- Interfaces only (no classes, no logic)
- camelCase
- Render-ready (formatted strings, computed values)

### 5. Hook (`hooks/`)

```typescript
// hooks/useLocations.ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { getLocations } from '@memo/api-client';
import { toLocationVm } from '@/app/lib/mappers/to-location-vm';
import type { LocationView } from '@/app/lib/model/view/location';

export function useLocations() {
  return useQuery<LocationView[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const page = await getLocations();
      return page.items.map(toLocationVm);
    },
  });
  // → { data: LocationView[] | undefined, isPending, error: ApiError | null }
}
```

- Only React-aware layer
- Thin wrapper: `@memo/api-client` → Mapper → react-query cache
- Error surfaces as `ApiError` (from the package) via `error`
- No business logic — delegate to domain or mapper

### 6. UI (`ui/`)

```typescript
import type { ActivityView } from '@/lib/model/view/activity';

interface Props { activity: ActivityView; onSelect?: (id: number) => void; }

export function MKCard({ activity, onSelect }: Props) {
  return (
    <div>
      <h3>{activity.serviceName}</h3>
      <span>{activity.priceFormatted}</span>
    </div>
  );
}
```

- Props = ViewModel (never DTO!)
- No API awareness
- No data fetching
- Local UI state only (open/closed, selected)

---

## Error Handling

```typescript
// NO local lib/errors.ts — the error type comes from the package:
import { ApiError } from '@memo/api-client';

// Thrown by every endpoint on non-2xx responses:
// new ApiError(status, message, code?, dependencies?)
```

Usage:
- Hooks surface `ApiError` through react-query's `error` field
- UI checks `error.status` (404 / 422 / 5xx) to pick user-friendly messages
- Never re-declare `ApiError` or a local `Result<T>` in an app

---

## TanStack Query (position)

**Used** — hooks wrap `@memo/api-client` endpoint calls in `useQuery`/`useMutation`.
Shared cache keys (`['locations']`, `['photos', 'public']`, …) dedupe requests across sections; transport functions, mappers, and view models stay unchanged when tuning cache policy.

---

## Complete Flow Example (all layers)

```typescript
// app/page.tsx
import { useLocations } from '@/app/hooks/useLocations';
import { MKCard } from '@/ui/MKCard';

export default function Home() {
  const { data: locations, isPending, error } = useLocations();
  if (error) return <div>{error.message}</div>;
  if (isPending) return <div>Loading...</div>;
  return locations.map(l => <MKCard key={l.id} item={l} />);
}
```

```
File                 Layer          Role
─────────────────────────────────────────────────
page.tsx             app              composition
MKCard.tsx           ui               dumb render
useLocations.ts      hooks            React bridge (react-query)
to-location-vm.ts    lib/mappers/     mapper (pure fn)
getLocations()       @memo/api-client transport (package)
LocationResponse     @memo/api-client contract type
LocationView         model/view/      UI types
canBookActivity()    model/domain/    business logic
ApiError             @memo/api-client error type
```

---

## Testing

Mappers are tested as pure functions:

```typescript
// __tests__/lib/mappers/to-location-vm.test.ts
import { toLocationVm } from '@/app/lib/mappers/to-location-vm';
import type { LocationResponse } from '@memo/api-client';

describe('toLocationVm', () => {
  it('maps contract fields to view model', () => {
    const raw = { id: '1', title: 'Пленэр', address: null } as LocationResponse;
    expect(toLocationVm(raw).title).toBe('Пленэр');
    expect(toLocationVm(raw).address).toBe('—');
  });
});
```

No mocks, no React, no DOM — just pure function testing.

---

## When NOT to Use

- Simple pages with 1-2 fields
- Prototypes (first 2 days)
- Static data without API

For colourmountains.ru — always use.
