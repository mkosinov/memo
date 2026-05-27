# Memo Architecture — Turborepo Monorepo

> Date: 2026-05-19
> Status: Active (migration complete)

## Overview

The Memo project uses **Turborepo + npm workspaces** to manage multiple frontend applications and shared packages.

**Why Turborepo:**
- 3+ frontend apps (admin, web, master) work with a single backend
- Shared data types and API client without duplication
- Isolated bundles — zero admin code in colourmountains.ru website
- Unified CI/CD pipeline

---

## Repository Structure

```
memo/
├── apps/                          # Frontend applications
│   ├── admin/                     # Admin panel (Next.js 14)
│   │   ├── app/                   # App Router pages
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   └── package.json           # deps: @dnd-kit, @radix-ui
│   │
│   ├── web/                       # colourmountains.ru (Next.js 14)
│   │   ├── app/
│   │   ├── components/
│   │   └── package.json           # deps: framer-motion
│   │                              # NO @dnd-kit, NO admin-specific deps
│   │
│   └── master/                    # Master app (future)
│       └── package.json           # deps: mobile-first libs
│
├── packages/                      # Shared packages
│   ├── domain/                    # TypeScript types + Zod schemas
│   │   ├── src/index.ts           # Artist, Activity, BookingRecord, etc.
│   │   └── package.json           # deps: zod
│   │                              # sideEffects: false, zero runtime
│   │
│   └── api-client/                # HTTP client for FastAPI
│       ├── src/client.ts          # fetch wrapper with Zod validation
│       ├── src/endpoints.ts       # getActivities, getBookings, etc.
│       └── package.json           # deps: zod, @memo/domain
│
├── backend/                       # FastAPI (separate service)
│   └── app/
│
├── turbo.json                     # Pipeline: build, dev, test
├── pnpm-workspace.yaml           # Workspace declaration
└── package.json                   # Root: workspaces + turbo
```

---

## Separation Principles

### What is shared (packages/)

| Package | What's inside | Why shared |
|---------|---------------|------------|
| `@memo/domain` | TypeScript interfaces + Zod schemas | Activity is the same Activity in admin, web, and master |
| `@memo/api-client` | Fetch functions + runtime validation | HTTP contract is the same for all |

### What is NOT shared (each app handles itself)

| Component | Isolation reason |
|-----------|-----------------|
| Button, Input, Card | Different design: admin (dark, dense) ≠ web (light, visual) ≠ master (mobile) |
| Layout (Sidebar, Header) | Different navigation structure |
| @dnd-kit | Only admin needs drag-n-drop |
| @radix-ui/react-dialog | Only admin uses complex modals |

---

## Package Dependencies

```
@memo/domain              ← zero deps (only zod for schemas)
    ↑
@memo/api-client          ← @memo/domain + zod
    ↑
apps/admin                ← @memo/domain + @memo/api-client + @dnd-kit
apps/web                  ← @memo/domain + @memo/api-client + framer-motion
apps/master               ← @memo/domain + @memo/api-client (future)
```

---

## TypeScript Resolution

Each app has in `tsconfig.json`:

```json
"paths": {
  "@/*": ["./*"],
  "@memo/domain": ["../../packages/domain/src/index.ts"],
  "@memo/api-client": ["../../packages/api-client/src/index.ts"]
}
```

This allows importing without building packages:
```typescript
import { Activity, Artist } from '@memo/domain';
import { getActivities } from '@memo/api-client';
```

---

## Deployment

| App | URL | Vercel project |
|-----|-----|---------------|
| admin | `admin.colourmountains.ru` or `/admin` | separate |
| web | `colourmountains.ru` | separate |
| master | `master.colourmountains.ru` | future |

---

## Change History

- **2026-05-19**: Migration from a single `frontend/` to Turborepo. Admin moved to `apps/admin/`. Created `packages/domain/` and `packages/api-client/`.
