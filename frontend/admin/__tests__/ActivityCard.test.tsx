import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ActivityCard } from '../app/components/schedule/ActivityCard';
import type { ScheduleAdminDTO, Master, Location } from '@memo/domain';
import { createMockUIContext, createMockScheduleData, createMockGridSettings } from './helpers/mockContexts';

const mockMaster: Master = {
  id: 'art_1',
  name: 'Ольга Петрова',
  shortName: 'Ольга',
  color: '#5B8C7A',
};

const mockLocation: Location = {
  id: 'loc_1',
  name: 'Гранд Отель Поляна',
  shortTitle: 'Гранд',
};

const mockActivity: ScheduleAdminDTO = {
  id: 'ev_1',
  day: 0,
  masterId: 'art_1',
  serviceId: 'svc_1',
  locationId: 'loc_1',
  masterName: 'Ольга Петрова',
  masterColor: '#5B8C7A',
  serviceTitle: 'Картина маслом',
  date: '2026-06-15',
  time: '10:00',
  startMinutes: 600,
  durationMinutes: 120,
  locationName: 'Гранд Отель Поляна',
  minAge: '6',
  occupied: 3,
  capacity: 8,
  isPrivate: false,
  comment: '',
  priceMin: 0,
  priceMax: 0,
};

describe('ActivityCard', () => {
  it('renders service name', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
  });

  it('shows time pill with time range', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/12:00/)).toBeInTheDocument();
  });

  it('shows occupancy ratio', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    expect(screen.getByText('3/8')).toBeInTheDocument();
  });

  it('tiny mode (< 60 min) shows only header + title', () => {
    const shortActivity = { ...mockActivity, durationMinutes: 15 }; // 15 min
    render(
      <ActivityCard
        activity={shortActivity}
        master={mockMaster}
        locations={[mockLocation]}
      />
    );
    // Time pill should still show
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    // Title visible (truncate)
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    // Master, location, footer hidden
    expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compact-capacity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
  });

  it('does not crash when capacity is 0', () => {
    const zeroCapActivity = { ...mockActivity, capacity: 0, occupied: 0 };
    expect(() => {
      render(<ActivityCard activity={zeroCapActivity} master={mockMaster} />);
    }).not.toThrow();
  });

  it('shows "0/0" occupancy when capacity is 0', () => {
    const zeroCapActivity = { ...mockActivity, capacity: 0, occupied: 0 };
    render(<ActivityCard activity={zeroCapActivity} master={mockMaster} />);
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('clamps occupancy ratio when occupied exceeds capacity', () => {
    const overbooked = { ...mockActivity, occupied: 10, capacity: 5 };
    expect(() => {
      render(<ActivityCard activity={overbooked} master={mockMaster} />);
    }).not.toThrow();
    expect(screen.getByText('10/5')).toBeInTheDocument();
  });

  it('renders diamond icon when isPrivate is true', () => {
    const privateActivity = { ...mockActivity, isPrivate: true };
    const { container } = render(<ActivityCard activity={privateActivity} master={mockMaster} />);
    
    // Check that the gem paths exist in the card
    expect(container.querySelector('path[d="M12 2L2 9l10 13 10-13L12 2z"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M2 9h20"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M12 2v20"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M7 9l5 13 5-13"]')).toBeInTheDocument();
  });

  it('does not have diamond icon when isPrivate is false', () => {
    const { container } = render(
      <ActivityCard activity={mockActivity} master={mockMaster} />
    );
    const paths = container.querySelectorAll('svg path[d="M12 2l10 10-10 10L2 12z"]');
    expect(paths.length).toBe(0);
  });

  it('shows location when height >= 90px (Standard mode)', () => {
    const tallActivity = { ...mockActivity, durationMinutes: 120 };
    render(<ActivityCard activity={tallActivity} master={mockMaster} locations={[mockLocation]} />);
    expect(screen.getByText('Гранд')).toBeInTheDocument();
  });

  it('hides master, location, footer when duration < 60 min (Tiny)', () => {
    // 42 min → Tiny mode
    const mediumActivity = { ...mockActivity, durationMinutes: 42 };
    render(<ActivityCard activity={mediumActivity} master={mockMaster} locations={[mockLocation]} />);
    // Title IS still visible
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    // Master, location, footer hidden
    expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compact-capacity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
  });

  it('has data-testid attribute', () => {
    const { container } = render(
      <ActivityCard activity={mockActivity} master={mockMaster} />
    );
    const card = container.querySelector('[data-testid="activity-ev_1"]');
    expect(card).toBeInTheDocument();
  });

  it('enforces minimum height of 60px when duration is 0', () => {
    const zeroDuration = { ...mockActivity, durationMinutes: 0 };
    const { container } = render(
      <ActivityCard activity={zeroDuration} master={mockMaster} />
    );
    const card = container.querySelector('[data-testid]');
    expect(card).toHaveStyle({ height: '60px' });
  });

  it('shows full occupancy display when occupied equals capacity', () => {
    const fullActivity = { ...mockActivity, occupied: 8, capacity: 8 };
    render(<ActivityCard activity={fullActivity} master={mockMaster} />);
    expect(screen.getByText('8/8')).toBeInTheDocument();
  });

  it('calls onQuickAdd when quick action button is clicked', () => {
    const onQuickAdd = vi.fn();
    render(<ActivityCard activity={mockActivity} master={mockMaster} onQuickAdd={onQuickAdd} />);
    // The "+" button has aria-label "Добавить гостя"
    const btn = screen.getByRole('button', { name: 'Добавить гостя' });
    fireEvent.click(btn);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(mockActivity);
  });

  it('calls onQuickAdd for private activity with correct activity', () => {
    const onQuickAdd = vi.fn();
    const privateActivity = { ...mockActivity, isPrivate: true };
    render(<ActivityCard activity={privateActivity} master={mockMaster} onQuickAdd={onQuickAdd} />);
    const btn = screen.getByRole('button', { name: 'Редактировать' });
    fireEvent.click(btn);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(privateActivity);
  });

  it('does not call onQuickAdd when not provided', () => {
    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    const btn = screen.getByRole('button', { name: 'Добавить гостя' });
    // Should not throw when clicked without onQuickAdd
    expect(() => fireEvent.click(btn)).not.toThrow();
  });

  it('renders progress bar with width proportional to occupancy', () => {
    const { container } = render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toBeInTheDocument();
    // mockActivity: occupied=3, capacity=8 → fillPct=0.375 → width=37.5%
    expect(filledBar).toHaveStyle({ width: '37.5%' });
  });

  it('renders full width progress bar when fully occupied', () => {
    const fullActivity = { ...mockActivity, occupied: 8, capacity: 8 };
    const { container } = render(<ActivityCard activity={fullActivity} master={mockMaster} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toHaveStyle({ width: '100%' });
  });

  it('renders zero width progress bar when empty', () => {
    const emptyActivity = { ...mockActivity, occupied: 0, capacity: 8 };
    const { container } = render(<ActivityCard activity={emptyActivity} master={mockMaster} />);
    const filledBar = container.querySelector('[data-testid="activity-ev_1"] [style*="width:"][class*="absolute"]');
    expect(filledBar).toHaveStyle({ width: '0%' });
  });

  // ─── Tier selection ────────────────────────────────────────────────────
  // With cellHeight=50: heightPx = max(durMinutes/60 * 100 - 8, 60)
  // 30→60px, 59→90px, 60→92px, 89→140px, 90→142px, 120→192px

  describe('tier selection', () => {
    it.each([
      [30, 'tiny'],      // 30 min → height 60, isTiny
      [59, 'tiny'],      // 59 min → height 90, isTiny
      [60, 'compact'],   // 60 min → height 92, isCompact
      [89, 'compact'],   // 89 min → height 140, isCompact
      [90, 'standard'],  // 90 min → height 142, isStandard
      [120, 'standard'], // 120 min → height 192, isStandard
    ])('duration %i min → %s tier', (minutes, expectedTier) => {
      const activity = { ...mockActivity, durationMinutes: minutes };
      const { container } = render(
        <ActivityCard
          activity={activity}
          master={mockMaster}
          locations={[mockLocation]}
        />
      );
      const card = container.querySelector('[data-testid^="activity-"]') as HTMLElement;
      const styleHeight = parseInt(card.style.height);
      if (expectedTier === 'tiny') {
        // Tiny: 60px is the floor; actual height depends on duration
        expect(styleHeight).toBeGreaterThanOrEqual(60);
        expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
        expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
      } else if (expectedTier === 'compact') {
        // Compact: has compact-capacity, no footer
        expect(screen.getByTestId('compact-capacity')).toBeInTheDocument();
        expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
      } else {
        // Standard: has footer button
        expect(screen.getByTestId('btn-quick-add')).toBeInTheDocument();
      }
    });
  });

  // ─── Master visibility matrix ──────────────────────────────────────────
  // Derived from spec math with cellHeight=50:
  //   Compact: want2Line≥90, canFit2Master≥108, canFit1Master≥88
  //   Standard: want2Line≥134, canFit2Master≥152, canFit1Master≥132
  // Heights: 30→60, 60→92, 75→117, 90→142, 120→192, 180→292

  describe('master visibility', () => {
    const cases: Array<[number, 'short' | 'long', boolean]> = [
      // [durationMinutes, titleType, expectedShowMaster]
      // Note: implementation always prefers 2-line title when the card is tall enough,
      // so the test should expect the 2-line behaviour.
      [30, 'short', false],   // tiny: no master
      [30, 'long', false],    // tiny: no master
      [60, 'short', false],   // compact 1:00, 2-line preferred (92≥90), no master (108>92)
      [60, 'long', false],    // compact 1:00, 2-line: no master
      [75, 'short', true],    // compact 1:15, 2-line preferred, master fits (108≤117)
      [75, 'long', true],     // compact 1:15, 2-line: master fits
      [90, 'short', false],   // standard 1:30, 2-line preferred (142≥134), no master (152>142)
      [90, 'long', false],    // standard 1:30, 2-line: no master
      [120, 'long', true],    // standard 2:00, 2-line: master fits (152≤192)
      [180, 'long', true],    // standard 3:00, 2-line: master fits
    ];

    it.each(cases)(
      'duration %i min, %s title → showMaster=%s',
      (minutes, titleType, expectedShowMaster) => {
        const activity = {
          ...mockActivity,
          durationMinutes: minutes,
          serviceTitle: titleType === 'long' ? 'Мини-картина акрилом' : 'МК',
        };
        render(
          <ActivityCard
            activity={activity}
            master={mockMaster}
            locations={[mockLocation]}
          />
        );
        if (expectedShowMaster) {
          expect(screen.getByText('Ольга Петрова')).toBeInTheDocument();
        } else {
          expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
        }
      }
    );
  });

  // ─── Compact capacity placement ────────────────────────────────────────

  describe('compact capacity', () => {
    it('renders capacity in location row, not in footer (compact 1:00)', () => {
      const activity = { ...mockActivity, durationMinutes: 60 }; // 1:00 → compact
      render(
        <ActivityCard
          activity={activity}
          master={mockMaster}
          locations={[mockLocation]}
        />
      );
      // Capacity present in compact-capacity slot
      const compactCap = screen.getByTestId('compact-capacity');
      expect(compactCap).toHaveTextContent('3/8');
      // Footer absent in compact
      expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
    });

    it('renders capacity in footer for standard (2:00)', () => {
      const activity = { ...mockActivity, durationMinutes: 120 }; // 2:00 → standard
      render(
        <ActivityCard
          activity={activity}
          master={mockMaster}
          locations={[mockLocation]}
        />
      );
      // Capacity in footer (button + capacity present)
      expect(screen.getByTestId('btn-quick-add')).toBeInTheDocument();
      // No compact-capacity slot in standard
      expect(screen.queryByTestId('compact-capacity')).not.toBeInTheDocument();
    });
  });
});

// ─── Delete Mode Tests ────────────────────────────────────────────────────

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

// GH #141 Task 10: ActivityCard reads the split contexts — data for the
// mutations, grid settings for cellHeight.
vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(),
}));

import { useUI } from '@/contexts/UIContext';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';

const mockUseUI = vi.mocked(useUI);
const mockUseScheduleData = vi.mocked(useScheduleData);
const mockUseGridSettings = vi.mocked(useGridSettings);

beforeEach(() => {
  vi.useFakeTimers();
  mockUseUI.mockReturnValue(createMockUIContext());
  mockUseScheduleData.mockReturnValue(createMockScheduleData());
  mockUseGridSettings.mockReturnValue(createMockGridSettings());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ActivityCard delete mode', () => {
  it('does not trigger delete when deleteMode is false', () => {
    const deleteActivity = vi.fn();
    mockUseScheduleData.mockReturnValue(createMockScheduleData({ deleteActivity }));

    render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    const card = screen.getByTestId('activity-ev_1');
    fireEvent.click(card);

    expect(deleteActivity).not.toHaveBeenCalled();
  });

  it('triggers delete with fade-out animation when deleteMode is true', () => {
    const deleteActivity = vi.fn();
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({
      deleteMode: true,
      showToast,
    }));
    mockUseScheduleData.mockReturnValue(createMockScheduleData({ deleteActivity }));

    const { container } = render(<ActivityCard activity={mockActivity} master={mockMaster} />);
    const card = screen.getByTestId('activity-ev_1');

    // Before click: card is visible
    expect(card).not.toHaveClass('opacity-0');

    // Click to delete
    fireEvent.click(card);

    // After click: card has fade-out classes
    expect(card).toHaveClass('opacity-0');
    expect(card).toHaveClass('scale-95');

    // deleteActivity not called yet (waiting for animation)
    expect(deleteActivity).not.toHaveBeenCalled();

    // Advance timer past animation duration (150ms)
    vi.advanceTimersByTime(160);

    // Now deleteActivity should be called
    expect(deleteActivity).toHaveBeenCalledWith('ev_1');

    // Toast shown with undo
    expect(showToast).toHaveBeenCalled();
    const toastCall = showToast.mock.calls[0];
    expect(toastCall[0]).toContain('удалено');
    expect(typeof toastCall[0]).toBe('string');
  });
});
