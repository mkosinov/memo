import { describe, it, expect } from 'vitest';
import {
  DND_LIVE_REGION_SELECTOR,
  activeIdFromAnnouncement,
  hasLeftSelf,
} from '../e2e/lib/dnd-announcements';

/**
 * Unit tests for the dnd-kit announcement predicates of the dayview drag
 * state machine (spec #535 §Часть 3). Every string below is a PROBE
 * ARTIFACT captured on the dev grid 2026-10-25 against the INSTALLED
 * @dnd-kit core 6.3.1 + accessibility 3.1.1 (english defaults, no app
 * overrides) — regexes are written from these observations only.
 *
 * Observed announcement timeline of one keyboard drag (node #DndLiveRegion-0):
 *   pickup      → "Draggable item X was moved over droppable area X."
 *                 (self-over; the "Picked up draggable item X." text is
 *                 superseded within the pickup commit)
 *   ArrowLeft 1 → "Draggable item X is no longer over a droppable area."
 *   ArrowLeft 2 → "Draggable item X was moved over droppable area Y." (Y≠X)
 *   drop        → "Draggable item X was dropped over droppable area Y" (no period)
 */

describe('activeIdFromAnnouncement', () => {
  it('extracts X from the self-over announcement observed at pickup', () => {
    expect(
      activeIdFromAnnouncement(
        'Draggable item b8ca2805-dd42-440a-bbad-75abcd8e5ff9 was moved over droppable area b8ca2805-dd42-440a-bbad-75abcd8e5ff9.',
      ),
    ).toBe('b8ca2805-dd42-440a-bbad-75abcd8e5ff9');
  });

  it('extracts X from the library-default pickup text (superseded in practice, defensive)', () => {
    expect(activeIdFromAnnouncement('Picked up draggable item col-7.')).toBe('col-7.');
  });

  it('extracts X from the no-longer-over announcement observed after the first ArrowLeft', () => {
    expect(
      activeIdFromAnnouncement('Draggable item b8ca is no longer over a droppable area.'),
    ).toBe('b8ca');
  });

  it('returns null for an empty/silent node', () => {
    expect(activeIdFromAnnouncement('')).toBeNull();
    expect(activeIdFromAnnouncement('   ')).toBeNull();
  });
});

describe('hasLeftSelf — move-phase success predicate ("the drag left X")', () => {
  it('true for the observed no-longer-over announcement (press 1 path)', () => {
    expect(
      hasLeftSelf('Draggable item b8ca is no longer over a droppable area.', 'b8ca'),
    ).toBe(true);
  });

  it('true for the observed moved-over-sibling announcement with Y ≠ X (press 2 path)', () => {
    expect(
      hasLeftSelf(
        'Draggable item b8ca2805-dd42-440a-bbad-75abcd8e5ff9 was moved over droppable area ddb430a2-a05b-4950-be24-7b6ccae85863.',
        'b8ca2805-dd42-440a-bbad-75abcd8e5ff9',
      ),
    ).toBe(true);
  });

  it('false for the self-over announcement (drag still over X — «пустышка», retry)', () => {
    expect(
      hasLeftSelf('Draggable item b8ca was moved over droppable area b8ca.', 'b8ca'),
    ).toBe(false);
  });

  it('false for the pickup text (no move yet — retry)', () => {
    expect(hasLeftSelf('Picked up draggable item b8ca.', 'b8ca')).toBe(false);
  });

  it('false when the node has not spoken yet', () => {
    expect(hasLeftSelf('', 'b8ca')).toBe(false);
  });
});

describe('DND_LIVE_REGION_SELECTOR', () => {
  it('matches by id prefix — the -N suffix is a module-global counter, not a stable index', () => {
    // unified-rows.spec.ts:570 observed an empty #DndLiveRegion-2 first in
    // DOM order: never pin the suffix, disambiguate by announcement text.
    expect(DND_LIVE_REGION_SELECTOR).toBe('[id^="DndLiveRegion"]');
  });
});
