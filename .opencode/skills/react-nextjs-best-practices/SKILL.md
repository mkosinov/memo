---
name: react-nextjs-best-practices
description: Use when writing React components, pages, hooks, or state logic in Next.js 14 App Router
---

# React + Next.js 14 Best Practices

## Server Components by Default

- **App Router**: Every component is a Server Component unless marked with `'use client'`.
- Use Server Components for: data fetching, accessing backend resources, keeping sensitive logic on the server.
- Mark `'use client'` ONLY when: using hooks (`useState`, `useEffect`, `useContext`), browser APIs, event handlers, DnD libraries.

## Client Component Boundaries

- Keep `'use client'` as close to the leaf as possible. Don't wrap entire pages — wrap only the interactive widget.
- Pass data TO client components via props from server components. Don't fetch inside client components if server can do it.
- Example:
  ```tsx
  // Server Component (page.tsx)
  import { ScheduleGridClient } from '@/components/schedule/ScheduleGridClient';
  import { fetchSchedule } from '@/lib/api';

  export default async function SchedulePage() {
    const data = await fetchSchedule(); // Server-side fetch
    return <ScheduleGridClient initialData={data} />;
  }
  ```

## Hooks Rules

- **One responsibility per hook**: If `useEffect` does 3 things, split into 3 hooks or extract a custom hook.
- **Dependency arrays must be exhaustive**: Use `eslint-plugin-react-hooks` (included in Next.js). Missing deps = stale closures.
- **Custom hooks for shared logic**: `useSchedule`, `useBooking`, `useCurrentTime`. Name starts with `use`.
- **Never call hooks conditionally**: Not inside `if`, loops, or nested functions.

## Performance

- **Don't over-memoize**: `useMemo`/`useCallback` cost > benefit for simple values. Use when:
  - Derived data is expensive (filtering/sorting large arrays)
  - Object/array passed to `memo` child
  - Function passed to `useEffect` dependency
- **React.memo for pure list items**: `ActivityCard` wrapped in `memo` if parent re-renders often but props don't change.
- **Split context**: One context per concern. Don't put everything in a single giant context — every update re-renders all consumers.

## State Management

- **Lift state only as high as needed**: If only `ScheduleGrid` needs it, don't put in global context.
- **Colocate related state**: `{ draggedItem, dragPosition }` belong together in a single `useState` object if always updated together.
- **Avoid prop drilling with composition**: Pass components as children/props instead of threading 5 levels.

## Error Handling

- Use `error.tsx` for route-level error boundaries.
- Wrap async client operations in try/catch with user-facing feedback.
- Never swallow errors silently.

## Anti-Patterns — STOP

| Pattern | Why Bad | Fix |
|---------|---------|-----|
| `useEffect` for derived state | Causes double render | Compute in render or useMemo |
| `useState` for URL state | Out of sync with browser | Use Next.js `useSearchParams` + `router.push` |
| Passing `setState` 3 levels down | Tight coupling | Context or composition |
| `document.querySelector` in React | Bypasses React DOM | Use refs + state |
| Empty dep array `[]` when effect reads props | Stale closure | Include all deps or extract static values |
