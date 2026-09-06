---
name: frontend-clean-architecture
description: Use when designing or implementing frontend data flow with clean layer separation (API, Model, Mappers, Hooks, UI) in React/Next.js
---

# Frontend Clean Architecture (Data Flow)

> Version: 2.0 — 2026  
> Targets: React 18+, Next.js 14+, TypeScript 5+

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
│  hooks/ useActivities.ts   ← React hooks (only React-aware layer)   │
│  → calls api/ → applies lib/ (mappers) → exposes state              │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
               ┌────────────┴────────────────┐
               ▼                             ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  lib/api/                    │  │  lib/ (mappers)              │
│  Data layer                  │  │  Pure functions: DTO → View  │
│  async fetch / mock          │  │  Side-effect free            │
│  Returns DTO                 │  │  May call domain/            │
│  Mock/real switch point      │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
               │                              │
               ▼                              │
┌──────────────────────────────┐             │
│  lib/model/dto/              │             │
│  Raw API types (snake_case)  │◄────────────┘
└──────────────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  lib/model/domain/           │
│  Business logic (optional)   │
│  Reuses DTO                  │
└──────────────────────────────┘

lib/model/view/     ← UI types (camelCase, formatted)
                     Imported by ui/, hooks/, lib/
```

---

## Dependency Rule (mandatory)

```
Strict import hierarchy — violations are architectural errors.
```

| Layer | May Import | Forbidden |
|-------|-----------|-----------|
| `app/` | everything | — |
| `sections/` | `ui/`, `hooks/`, `lib/*` | direct `model/dto/`, `api/` |
| `ui/` | `model/view/`, `lib/format` | `api/`, `model/dto/`, `hooks/` |
| `hooks/` | EVERYTHING | `ui/`, `sections/`, `app/` |
| `lib/api/` | `model/dto/`, `lib/errors` | `model/view/`, `hooks/`, `ui/` |
| `lib/model/domain/` | `model/dto/`, other `model/domain/` | `api/`, `hooks/`, `ui/` |
| `lib/model/view/` | nothing (types only) | everything |
| `lib/lib/` (mappers) | `model/*`, `lib/errors`, `lib/format` | `hooks/`, `ui/`, `api/` |

### In plain English:
- **Components** know nothing about API or DTO
- **Hooks** are the only React-aware layer, can access everything except UI
- **Data layer** knows nothing about React or ViewModel
- **Domain** knows nothing about React or API

---

## Layer-by-layer Rules

### 1. DTO (`lib/model/dto/`)

```typescript
// lib/model/dto/activity.ts
export interface RawActivityDTO {
  id: number;
  master_name: string;        // snake_case, matches API
  master_avatar: string;
  service_name: string;
  category: string;
  min_price: number;
  max_price: number;
  duration_minutes: number;
  date: string;
  start_time: string;
  location_name: string;
  location_address: string;
  image_url: string;
  guests_count: number;
  max_capacity: number;
  min_age: number;
  technique: string;
  canvas_size: string;
}
```

- Interfaces only
- snake_case (1:1 with API response)
- No logic whatsoever

### 2. Domain Model (`lib/model/domain/`)

```typescript
// lib/model/domain/activity.ts
import type { RawActivityDTO } from '@/lib/model/dto/activity';

export function canBookActivity(dto: RawActivityDTO): boolean {
  return dto.guests_count < dto.max_capacity;
}

export function getActivityCategory(dto: RawActivityDTO): 'adult' | 'child' | 'together' {
  if (dto.min_age >= 18) return 'adult';
  if (dto.min_age >= 6) return 'child';
  return 'together';
}

export function calculateTotalPrice(
  adultCount: number,
  childCount: number,
  adultPrice: number,
  childPrice: number
): number {
  return adultCount * adultPrice + childCount * childPrice;
}
```

- Reuses DTO (no duplication!)
- Pure functions, no side effects
- Optional layer — add only when business logic exists

### 3. Data Layer (`lib/api/`)

```typescript
// lib/api/activities.ts
import { ApiError } from '@/lib/errors';
import type { RawActivityDTO } from '@/lib/model/dto/activity';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_API !== 'false';

export async function getActivities(): Promise<RawActivityDTO[]> {
  if (IS_MOCK) return getMockActivities();
  return fetchActivities();
}

async function fetchActivities(): Promise<RawActivityDTO[]> {
  const res = await fetch(`${BASE_URL}/api/activities`);
  if (!res.ok) throw new ApiError('Failed to fetch activities', res.status);
  return res.json();
}
```

- Async functions only
- Single mock/real switch point
- Returns DTO, never ViewModel
- React-unaware (no hooks, no JSX)

### 4. Mapper (`lib/`)

```typescript
// lib/to-activity-view.ts
import type { RawActivityDTO } from '@/lib/model/dto/activity';
import type { ActivityView } from '@/lib/model/view/activity';
import { canBookActivity, getActivityCategory } from '@/lib/model/domain/activity';
import { formatPrice, formatDate } from '@/lib/format';

export function toActivityView(raw: RawActivityDTO): ActivityView {
  return {
    id: raw.id,
    masterName: raw.master_name,
    serviceName: raw.service_name,
    category: getActivityCategory(raw),
    priceFormatted: formatPrice(raw.min_price, raw.max_price),
    durationLabel: `${raw.duration_minutes} min`,
    dateFormatted: formatDate(raw.date),
    timeFormatted: raw.start_time.slice(0, 5),
    locationName: raw.location_name,
    locationAddress: raw.location_address,
    imageUrl: raw.image_url,
    guestsLabel: `${raw.guests_count} guest(s)`,
    canBook: canBookActivity(raw),
    categoryColor: CATEGORY_COLORS[raw.category] || '#888888',
  };
}
```

- Pure function: DTO → View
- May call Domain Model
- snake_case → camelCase conversion
- Side-effect free, easy to test

### 5. ViewModel (`lib/model/view/`)

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

### 6. Hook (`hooks/`)

```typescript
'use client';
import { useState, useEffect } from 'react';
import { getActivities } from '@/lib/api/activities';
import { toActivityView } from '@/lib/to-activity-view';
import type { ActivityView } from '@/lib/model/view/activity';
import { ApiError } from '@/lib/errors';

export function useActivities() {
  const [activities, setActivities] = useState<ActivityView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getActivities()
      .then(raw => { if (!cancelled) setActivities(raw.map(toActivityView)); })
      .catch(err => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { activities, isLoading, error };
}
```

- Only React-aware layer
- Thin wrapper: API → Mapper → State
- Uses ApiError for error handling
- No business logic — delegate to domain or mapper

### 7. UI (`ui/`)

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
// lib/errors.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNotFound() { return this.statusCode === 404; }
  get isValidation() { return this.statusCode === 422; }
  get isServerError() { return this.statusCode >= 500; }
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
```

Usage:
- Hooks always catch errors and set `ApiError` state
- UI checks `error.isNotFound`, `error.isServerError`, etc.
- Components show user-friendly messages based on error type

---

## TanStack Query (position)

**Not used** at this stage (MVP).  
Architecture is migration-ready: only the hook body needs to switch to `useQuery`; `api/` and `lib/` layers stay unchanged.

---

## Complete Flow Example (all layers)

```typescript
// app/page.tsx
import { useActivities } from '@/hooks/useActivities';
import { MKCard } from '@/ui/MKCard';

export default function Home() {
  const { activities, isLoading, error } = useActivities();
  if (error) return <div>{error.message}</div>;
  if (isLoading) return <div>Loading...</div>;
  return activities.map(a => <MKCard key={a.id} activity={a} />);
}
```

```
File                 Layer          Role
─────────────────────────────────────────────────
page.tsx             app            composition
MKCard.tsx           ui             dumb render
useActivities.ts     hooks          React bridge
to-activity-view.ts  lib/           mapper (pure fn)
activities.ts        lib/api/       data fetching
RawActivityDTO       model/dto/     raw types
ActivityView         model/view/    UI types
canBookActivity()    model/domain/  business logic
ApiError             lib/errors     error types
```

---

## Testing

Mappers are tested as pure functions:

```typescript
// __tests__/lib/to-activity-view.test.ts
import { toActivityView } from '@/lib/to-activity-view';
import type { RawActivityDTO } from '@/lib/model/dto/activity';

describe('toActivityView', () => {
  it('formats price range', () => {
    const raw = { min_price: 3500, max_price: 5500 } as RawActivityDTO;
    expect(toActivityView(raw).priceFormatted).toBe('3 500 – 5 500 ₽');
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
