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

## Data Access Patterns

Server state in the admin app (Next.js) is read through TanStack Query. To keep
query keys consistent and dedupe correct, access is standardized on thin hooks
in `frontend/admin/hooks/` over a single central key registry.

### The rule

Components **never** call `useQuery` directly and **never** write query-key
literals. They consume hooks from `frontend/admin/hooks/`; every entity key
lives only in `frontend/admin/lib/queryKeys.ts` (`qk`). Direct `useQuery` and
inline keys are allowed **only** inside `hooks/` and `contexts/`. This keeps
dedupe/invalidation semantics intact — one key shape, one source.

### Hook taxonomy

| Hook shape | Returns | Example |
|------------|---------|---------|
| `use<Entity>` | domain-selected lookup (archived dropped, domain types) | `useMasters()`, `useServices()` |
| `use<Entity>Raw` | raw API response **including archived** | `useMastersRaw()`, `useTagsRaw()` |
| point hooks | single-entity / scoped reads | `useClient(id)`, `useActivity(id)`, `useClientRecords(id)` |
| `use<Entity>Table` | factory paged-list state (`createPagedListContext`) | `useClientsTable()`, `useTagsTable()` (factory tables: clients/tags/masters/locations/services/materials; photos and records still use hand-rolled contexts) |
| `use<Entity>Mutations` | mutation family for one entity | `useRecordMutations()`; clients mutations are per-action hooks (`useCreateClient`, `useDeleteClient`, … in `hooks/useClientsMutations.ts`) |

A lookup and its `Raw` sibling share the **same** query key (e.g. `qk.masters`)
so they dedupe. `useClients` is permanently reserved-vacant — the clients list
is `useClientsTable`.

### `DICT_STALE_TIME` — a load-reduction default, not a correctness mechanism

Dictionary data (`DICT_STALE_TIME = 1h`, `queryKeys.ts`) is cached for an hour
because admin pages stay open indefinitely and the dictionaries rarely change —
the long TTL trims refetch traffic, nothing more. Correctness does **not** rest
on time-based refresh (nor on the client's own mutations alone): external edits
are picked up in seconds by the **server push invalidation channel** below.
Time-to-staleness worst case is therefore bounded by channel failure, not by
the 1h TTL — if the channel is down, the app converges on staleTime expiry,
own-mutation invalidation, or the reconnect blanket (below).

### Server push invalidation channel (GH #239)

Every committed transaction publishes what went stale; subscribers refetch.

- **Transport:** SSE at `GET /api/v1/events` (`backend/src/events/` — hub,
  entities, emitter, router; native `fastapi.sse.EventSourceResponse`,
  15s ping, server-paced `retry: 5000`). Emitted post-commit from the
  `@transactional` decorator — rolled-back transactions publish nothing.
- **Payload:** `invalidate` frames carry `{entities, origin}` only — no data,
  no row ids, no diffs. React Query refetches via normal GETs through the
  shared family map in `frontend/admin/lib/invalidate.ts`
  (`INVALIDATION_MAP` — the single source of family-level invalidation rules,
  consumed by both the SSE provider and the own-mutation sites).
- **Origin:** mutating requests carry `X-Memo-Tab-Id`; events caused by this
  tab invalidate silently, others also raise the «Данные обновлены» toast.
- **No delivery guarantees / replay:** missed events are covered by
  convergence — on SSE reconnect the client blanket-invalidates all active
  queries (no toast). The channel is an accelerator, not a critical
  dependency; if it is unavailable the app behaves as a pure pull app.

**Constraints (deliberate, spec §7):** the hub is a single-process in-memory
fanout — a multi-process deploy would need Redis pub/sub or PG
LISTEN/NOTIFY behind the same hub interface (SQLite single-process is the
current design invariant). Direct DB / sqladmin writes do **not** emit events
(sqladmin bypasses `@transactional`) — known, accepted gap. The channel ships
unauthenticated like the whole API; auth arrives with #247, and native
EventSource cannot set headers — the tab-id origin scheme is headerless by
that constraint (cookie-session / token-in-query / fetch-SSE are the recorded
integration paths).

### Shared-key `staleTime` alignment

When two hooks share a query key (the lookup/`Raw` pairs), they **must** use the
same `staleTime`: shared-key observers take the most pessimistic value, so a
mismatch silently overrides intent. One aligned value per key is the only sound
end-state.

### Framing note

As of 2026, TanStack guidance leans toward `queryOptions` factories. This
codebase deliberately standardizes instead on **thin hooks + a central `qk`
registry** — an explicit team-governance choice (GH #140), not an oversight.
The hook surface gives call sites a stable, typed API while `qk` keeps every
key in one inspectable file.

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

## Backend — FastAPI + Clean Architecture

> Status: Foundation completed 2026-05-28

The backend is a separate FastAPI service living in `backend/`. It follows **Feature-Based Clean Architecture** — each domain module has its own `router.py`, `service.py`, `repository.py`, `models.py`, and `schemas.py`.

### Backend Directory Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                    # create_app() + lifespan (DB init/close)
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   └── config.py              # Settings (pydantic-settings, DATABASE_URL)
│   │
│   ├── db/
│   │   ├── __init__.py
│   │   ├── base.py                # DeclarativeBase
│   │   └── database.py            # DatabaseSessionManager + get_db_session DI
│   │
│   └── domain/
│       └── system/                # Healthcheck module
