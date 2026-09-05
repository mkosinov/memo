# ADR 002: Use React Query for data fetching

## Status

Accepted

**Date:** 2026-05-20

## Context

Frontend needs to fetch data from the backend API and manage server state (caching, invalidation, optimistic updates).

**Alternatives considered:**
- Plain `fetch` + `useState` — manual caching, no invalidation, boilerplate
- Redux + RTK Query — overkill for our data volume, complex setup
- SWR — similar to React Query, but React Query has more features (mutations, optimistic updates)
- Apollo Client — GraphQL only, we use REST

## Decision

Use **React Query (TanStack Query v5)** for server state management.

**Rationale:**
- Built-in caching with stale-while-revalidate
- Automatic background refetching
- Mutation support with optimistic updates
- Query invalidation (e.g., after creating a Record, invalidate Activities query)
- DevTools for debugging
- Lightweight — no global store needed

## Consequences

### Positive
- Less boilerplate — no manual loading/error states
- Automatic caching — faster UI, fewer API calls
- Optimistic updates — instant UI feedback
- Query invalidation — data stays fresh
- DevTools — easy debugging

### Negative
- Learning curve — team needs to learn React Query patterns
- Bundle size — ~15kb gzipped (acceptable)
- Overhead for simple fetches — but we have complex data flows anyway

### Risks
- Over-caching — need to configure staleTime correctly per entity
- Cache invalidation bugs — need to test invalidation chains

## References

- Frontend architecture: `docs/ARCHITECTURE.md`
- API integration: `docs/specs/2026-05-30-api-integration-design.md`

## Related (GH #140, 2026-09-05)

How React Query usage is **organized** is governed separately: thin entity hooks in
`frontend/admin/hooks/` over a single central key registry (`lib/queryKeys.ts`), with
components barred from direct `useQuery` calls and inline key literals. Full hook
taxonomy, the 1h dictionary `staleTime` / no-external-invalidation rationale, and the
thin-hooks-vs-`queryOptions` framing are documented in `docs/ARCHITECTURE.md`
(«Data Access Patterns», added by #140) — that section is the reference, not duplicated
here.
