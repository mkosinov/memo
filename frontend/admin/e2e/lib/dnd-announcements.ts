/**
 * dnd-kit live-region announcement predicates (spec #535 §Часть 3).
 *
 * PROBE ARTIFACT (dev grid, 2026-10-25; installed @dnd-kit core 6.3.1 +
 * accessibility 3.1.1, english defaults — DayView passes no `announcements`
 * override): the announcements node is the visually hidden
 * `<div id="DndLiveRegion-N" role="status" aria-live="assertive" aria-atomic="true">`.
 * The `-N` suffix comes from a MODULE-GLOBAL counter in @dnd-kit/utilities
 * (`useUniqueId`), so several nodes can sit in the DOM at once and the first
 * in DOM order may be an empty stale one (unified-rows.spec.ts:570 observed
 * an empty `#DndLiveRegion-2` at index 0) — never address the region by a
 * bare `[aria-live]` or a pinned suffix: match the id PREFIX and
 * disambiguate by announcement text.
 *
 * Observed strings of one keyboard column drag (node text REPLACES the
 * previous announcement — no auto-clear — so polling the current text is
 * race-free):
 *   pickup      → "Draggable item X was moved over droppable area X."
 *                 (self-over; the "Picked up draggable item X." text is
 *                 superseded within the pickup commit)
 *   ArrowLeft 1 → "Draggable item X is no longer over a droppable area."
 *   ArrowLeft 2 → "Draggable item X was moved over droppable area Y." (Y≠X)
 *   drop        → "Draggable item X was dropped over droppable area Y" (no period)
 */

/** id-prefix selector: disambiguation happens by text, not by the -N suffix. */
export const DND_LIVE_REGION_SELECTOR = '[id^="DndLiveRegion"]';

/** Every dnd-kit announcement names the active (dragged) item; the pickup
 * text ("Picked up draggable item X.") prefixes it with "Picked up" and
 * lowercases "draggable". */
const ACTIVE_ID_RE = /^(?:Picked up )?[Dd]raggable item (\S+)/;

const MOVED_OVER_RE = /was moved over droppable area ([^.]+)\./;
const NO_LONGER_OVER_RE = /is no longer over a droppable area\./;

/**
 * Extract the dragged item id X from the announcements node's current text
 * (any announcement names it — the id never changes within one drag).
 * Returns null while the node has not spoken yet.
 */
export function activeIdFromAnnouncement(text: string): string | null {
  const match = text.trim().match(ACTIVE_ID_RE);
  return match?.[1] ?? null;
}

/**
 * Move-phase success predicate of the drag state machine: has the drag
 * demonstrably left its own slot X?
 *
 * True when the announcement names a droppable Y ≠ X ("was moved over
 * droppable area Y.") or says the drag left every droppable ("is no longer
 * over a droppable area.") — both are probe-observed forms of a REGISTERED
 * move press. False while the node still names X (pickup text or self-over
 * "moved over droppable area X.") or is silent — the «пустышка» retry
 * condition of the spec ("the last announcement still names X, or nothing
 * new has arrived").
 */
export function hasLeftSelf(text: string, activeId: string): boolean {
  const trimmed = text.trim();
  const movedOver = trimmed.match(MOVED_OVER_RE);
  if (movedOver) return movedOver[1] !== activeId;
  return NO_LONGER_OVER_RE.test(trimmed);
}
