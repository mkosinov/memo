---
name: tailwind-typescript-patterns
description: Use when styling components, defining types, or writing TypeScript in the Memo frontend
---

# Tailwind CSS + TypeScript Patterns

## Tailwind v4 Utility-First

- **Never write arbitrary CSS**: If it's not achievable with utilities, use a one-off arbitrary value: `h-[60px]`, not inline styles.
- **Custom values from design system**: Define in `tailwind.config.ts` if reused >3 times.
- **Dark mode**: Use `dark:` prefix, not separate classes. CSS variables switch automatically.
  ```tsx
  <div className="bg-[var(--bg)] text-[var(--ink)] dark:bg-[var(--card-bg)]" />
  ```
- **Component extraction with `cn()`**: Use `clsx` + `tailwind-merge` helper (`lib/utils.ts`) for conditional classes.
  ```tsx
  import { cn } from '@/lib/utils';

  <div className={cn(
    "rounded-lg border p-4",
    isActive && "border-brand bg-brand/10",
    isDragging && "opacity-50"
  )} />
  ```

## TypeScript Strict

- **Enable `strict: true`** in `tsconfig.json`. No exceptions.
- **Explicit return types on exported functions**: Especially hooks and utility functions.
- **No `any`**: Use `unknown` + type guards. If `any` is unavoidable, document WHY in a comment.
- **Prefer `interface` for objects, `type` for unions/tuples/intersections**.

## Typing Props

- **Destructure in function signature** for clarity:
  ```tsx
  interface ActivityCardProps {
    activity: Activity;
    isDragging?: boolean;
    onDelete?: (id: string) => void;
  }

  export function ActivityCard({ activity, isDragging = false, onDelete }: ActivityCardProps) {
    ...
  }
  ```
- **Optional props with defaults**: Always provide sensible defaults (e.g., `isDragging = false`).
- **Callback types**: Use specific signatures, not generic `Function`.
  ```tsx
  onDelete?: (id: string) => void;
  onDrop?: (event: DragEndEvent) => void;
  ```

## Domain Types

- **Keep types close to data**: `Activity`, `Artist`, `Service` in `lib/types.ts`.
- **Use discriminated unions for state machines**:
  ```typescript
  type ScheduleView =
    | { mode: 'week'; dates: Date[] }
    | { mode: 'day'; date: Date };
  ```
- **Never use `string` for IDs**: Use branded types or at least name the variable clearly (`activityId: string`, not just `id: string` in ambiguous contexts).

## Generics for Reusable Components

- **Data tables, lists, selects**: Use generics so TypeScript preserves item type.
  ```tsx
  interface DataGridProps<T> {
    items: T[];
    renderItem: (item: T) => React.ReactNode;
  }
  ```

## Anti-Patterns — STOP

| Pattern | Why Bad | Fix |
|---------|---------|-----|
| Inline styles for colors | Breaks Tailwind purging | CSS variables + `bg-[var(--brand)]` |
| `as any` to silence TS | Hides real bugs | Type guard, proper typing, or documented `unknown` |
| `React.FC` | Implicit children, deprecated pattern | Direct function with typed props |
| Optional `id` on entities | All entities have IDs | Required field + factory function for mocks |
| `Object` or `{}` as type | Too vague | `Record<string, unknown>` or specific interface |
