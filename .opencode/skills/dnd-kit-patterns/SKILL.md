---
name: dnd-kit-patterns
description: Use when implementing or debugging drag-and-drop features using @dnd-kit
---

# @dnd-kit Patterns

## Architecture

- **Wrap interactive areas in `DndContext`**: One context per independent DnD surface (e.g., Schedule Grid).
- **Keep `DndContext` as high as needed**, but not higher. If sidebar items also draggable, they may share context or have separate ones — decide explicitly.

## Sensors

- **Always configure `PointerSensor` with `activationConstraint`** to prevent accidental drags:
  ```tsx
  import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // px — must move 8px before drag starts
      },
    })
  );
  ```
- **For touch**: Consider `TouchSensor` with `delay: 250` (ms) or tolerance.
- **Keyboard accessibility**: Include `KeyboardSensor` for a11y.
  ```tsx
  import { KeyboardSensor } from '@dnd-kit/core';

  useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates, // or custom
  })
  ```

## Draggable Items

- **`useDraggable` returns `{setNodeRef, listeners, attributes, transform}`**:
  ```tsx
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `activity-${activity.id}`,
    data: { activity }, // Pass full data for drop handler
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;
  ```
- **Use `id` that is globally unique** across all draggables on the page.

## Droppable Zones

- **`useDroppable` for each drop target** (day column, time slot):
  ```tsx
  const { setNodeRef, isOver } = useDroppable({
    id: `slot-${date}-${hour}-${minute}`,
    data: { date, hour, minute },
  });
  ```
- **Visual feedback on `isOver`**: Change background color, border, or show ghost slot.

## Drag Overlay

- **ALWAYS use `DragOverlay`** for smooth visuals. Dragged item renders here, original stays in place.
  ```tsx
  <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <ScheduleGrid />
    <DragOverlay>
      {activeId ? <ActivityCard activity={activeActivity} isDragging /> : null}
    </DragOverlay>
  </DndContext>
  ```
- **DragOverlay renders at document root**: Styles must be self-contained (no context-dependent CSS).

## Collision Detection

- **For grid layouts**: Use `rectIntersection` or `pointerWithin`, NOT `closestCenter` (meant for lists).
  ```tsx
  import { rectIntersection } from '@dnd-kit/core';

  <DndContext collisionDetection={rectIntersection} ... />
  ```
- **Fine-tune with `collisionPriority`** if multiple overlapping zones cause flicker.

## Copy-on-Alt (Specific to Memo)

- **Detect Alt key in `onDragStart` or `onDragEnd`**:
  ```tsx
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const isCopy = event.activatorEvent.altKey; // or check keyboard state

    if (isCopy) {
      // Clone activity to new position, keep original
      dispatch({ type: 'COPY_ACTIVITY', sourceId: active.id, target: over.data.current });
    } else {
      // Move activity
      dispatch({ type: 'MOVE_ACTIVITY', sourceId: active.id, target: over.data.current });
    }
  }
  ```
- **Visual hint during drag**: If Alt is pressed, show "+" badge on DragOverlay.

## State Integration

- **DnD state lives in React Context**: Don't lift drag data to global state unless multiple components need it.
- **Update state ONLY in `onDragEnd`**: Don't mutate in `onDragMove` — causes excessive re-renders.
- **Optimistic UI**: Update local state immediately in `onDragEnd`, sync with server after.

## Anti-Patterns — STOP

| Pattern | Why Bad | Fix |
|---------|---------|-----|
| No `activationConstraint` | Accidental drags on clicks | Always set `distance: 8` or `delay: 250` |
| Inline `style={{ transform }}` on original element | Visual glitch, item jumps | Use `DragOverlay` |
| Mutating state in `onDragMove` | Performance disaster, inconsistent state | Update only in `onDragEnd` |
| `closestCenter` for grid | Wrong drop target detection | `rectIntersection` or `pointerWithin` |
| Generic `id: 'item-1'` | Collisions between different lists | Globally unique: `activity-123`, `template-456` |
| Ignoring keyboard DnD | Accessibility failure | Include `KeyboardSensor` |
