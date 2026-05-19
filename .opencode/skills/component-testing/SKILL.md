---
name: component-testing
description: Use when writing or reviewing tests for React components, hooks, and DnD interactions
---

# Component Testing (React Testing Library + Vitest)

## Philosophy

- **Test behavior, not implementation**: Assert what the user sees/does, not internal state.
- **Minimal mocking**: Use real components, real contexts. Mock only external APIs (`fetch`, `navigator.clipboard`).
- **One test = one behavior**: If name has "and", split it.

## Setup

- **Render with providers**: Always wrap in required contexts.
  ```tsx
  import { render, screen } from '@testing-library/react';
  import { ScheduleProvider } from '@/lib/schedule-context';

  function renderWithProviders(ui: React.ReactNode) {
    return render(<ScheduleProvider>{ui}</ScheduleProvider>);
  }
  ```
- **Prefer `screen`**: Don't destructure from `render` — use `screen.getByRole`, `screen.findByText`.

## Queries Priority

1. `getByRole` — most robust (accessibility + behavior)
2. `getByLabelText` — forms
3. `getByText` / `getByTestId` — last resort (add `data-testid` sparingly)

## Async Testing

- **Use `findBy*` for async appearance**:
  ```tsx
  await screen.findByText('Schedule loaded'); // waits + retries
  ```
- **Use `waitFor` for state changes**:
  ```tsx
  await waitFor(() => {
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
  ```
- **Use `act` only when necessary**: RTL wraps most operations in `act` automatically.

## Testing Hooks

- Use `@testing-library/react`'s `renderHook`:
  ```tsx
  import { renderHook } from '@testing-library/react';

  const { result } = renderHook(() => useSchedule(), {
    wrapper: ScheduleProvider,
  });

  expect(result.current.activities).toHaveLength(3);
  ```

## DnD Component Testing

- **Don't test `@dnd-kit` internals**: Test YOUR wrapper logic.
- **Simulate drag via pointer events** or use `@dnd-kit/testing` utilities if available.
- **Test outcomes**: After drag, assert card moved to new position in DOM/data.
- **Test copy-on-alt**: Simulate `keydown` with `altKey: true`, then drag, assert original remains + copy exists.

## User Events

- Use `@testing-library/user-event` v14+, not `fireEvent`:
  ```tsx
  import userEvent from '@testing-library/user-event';

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /delete/i }));
  ```

## Snapshot Testing

- **Avoid snapshot tests for components**: Brittle, low signal.
- **Use inline snapshots ONLY for error messages** or complex object shapes.

## TDD Integration

- **RED**: Write failing test showing desired behavior.
- **Verify RED**: Run test, confirm fails for right reason (feature missing, not syntax error).
- **GREEN**: Minimal code to pass.
- **REFACTOR**: Clean up, keep tests green.

## Anti-Patterns — STOP

| Pattern | Why Bad | Fix |
|---------|---------|-----|
| `getByTestId` as primary query | Tests implementation detail | `getByRole`, `getByLabelText` |
| `container.querySelector` | Bypasses RTL, fragile | Semantic queries |
| Mocking child components | Tests in isolation from reality | Render real tree with providers |
| `fireEvent.click` | Doesn't simulate full interaction | `userEvent.click` |
| Testing `useEffect` directly | Tests implementation, not behavior | Test the observable outcome |
