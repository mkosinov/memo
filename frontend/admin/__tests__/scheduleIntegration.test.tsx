import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UIProvider } from '../contexts/UIContext';
import { NavigationProvider } from '../contexts/NavigationContext';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { WeekView } from '../app/components/schedule/WeekView';

// ─── Mock api-client ─────────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getServices: vi.fn(),
  getActivities: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  patchActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

import {
  getMasters,
  getLocations,
  getServices,
  getActivities,
} from '@memo/api-client';

// ─── Mock @dnd-kit/core ──────────────────────────────────────────────────────
// Keep DndContext, DragOverlay, sensors but make useDroppable/useDraggable
// return no-ops so the components render without errors in jsdom.

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    useDroppable: () => ({
      isOver: false,
      setNodeRef: vi.fn(),
    }),
    useDraggable: () => ({
      attributes: {} as Record<string, string>,
      listeners: {} as Record<string, (e: unknown) => void>,
      setNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    }),
  };
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Schedule pipeline integration: enrichment from API to ActivityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock masters API (raw MasterResponse, not transformed Artist)
    vi.mocked(getMasters).mockResolvedValue([
      {
        id: 'm1',
        first_name: 'Ольга',
        last_name: 'Середа',
        color: '#5B8C7A',
        position: 'мастер',
        specialty: 'живопись',
        avatar_url: null,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);

    // Mock services API (raw ServiceResponse, not transformed Service)
    vi.mocked(getServices).mockResolvedValue([
      {
        id: 's1',
        title: 'Картина маслом',
        description: 'Рисование масляными красками',
        image_url: '',
        specialty: 'живопись',
        min_age: 12,
        max_age: 99,
        duration: 150,
        record_info: '',
        tariffs: [
          { id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 3500 },
        ],
        tags: [],
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);

    // Mock locations API (raw LocationResponse, not transformed Location)
    vi.mocked(getLocations).mockResolvedValue([
      {
        id: 'loc1',
        name: 'Альпика',
        address: 'Альпика, 1 этаж',
        description: null,
        capacity: 10,
        yandex_map_url: null,
        review_url: null,
        record_info: null,
        image_url: null,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);

    // ═══ CRITICAL: Mock activities WITHOUT service_name or min_age ═══
    // This simulates what the real backend returns — ActivityResponse
    // does NOT include service_name or min_age fields.
    // transformActivity() in transformers.ts does NOT set them either.
    // The enrichment MUST come from toScheduleItems() in buildSchedule.ts.
    vi.mocked(getActivities).mockResolvedValue([
      {
        id: 'a1',
        master_id: 'm1',
        service_id: 's1',
        location_id: 'loc1',
        start: '2026-06-01T10:00:00Z', // Monday of current week, 10:00
        duration: 120, // minutes
        capacity: 8,
        is_private: false,
        comment: null,
        record_info: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        is_active: true,
        occupied: 3,
      },
    ]);
  });

  it('should enrich activity with serviceName from service data and display it in ActivityCard', async () => {
    // ARRANGE
    const queryClient = createTestQueryClient();

    // ACT — render the full provider chain + WeekView
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <ScheduleProvider>
              <WeekView />
            </ScheduleProvider>
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>,
    );

    // ASSERT — wait for loading to finish and the activity card to appear
    // The enrichment pipeline should:
    //   1. Fetch ActivityResponse (no serviceName/minAge) via useActivities
    //   2. Transform via transformActivity() → Activity (still no serviceName/minAge)
    //   3. Enrich via toScheduleItems() → ScheduleItem (serviceName from matching Service)
    //   4. Pass through ScheduleProvider → WeekView → DayColumn → ActivityCard
    //   5. Render {activity.serviceName} inside the card
    await waitFor(() => {
      expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    });
  });

  it('should enrich activity with minAge from service data and display it in ActivityCard', async () => {
    // ARRANGE
    const queryClient = createTestQueryClient();

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <NavigationProvider>
            <ScheduleProvider>
              <WeekView />
            </ScheduleProvider>
          </NavigationProvider>
        </UIProvider>
      </QueryClientProvider>,
    );

    // ASSERT — minAge should be '12+' (from service min_age: 12 → transformService → '12+')
    // Note: minAge only renders when the card is tall enough (height >= 90px).
    // Activity duration=2h → height = 2*120-10 = 230px → showExtra = true → minAge is visible.
    await waitFor(() => {
      expect(screen.getByText('12+')).toBeInTheDocument();
    });
  });
});

// THIS TEST IS RED — REPRODUCES BUG #service-name-missing
// If the test PASSES (GREEN), the enrichment pipeline (ScheduleProvider → toScheduleItems)
// is working correctly. The bug must be elsewhere (CSS/build/deployment/context wiring issue).
// If the test FAILS (RED), the enrichment pipeline is broken — activities reach
// ActivityCard without serviceName/minAge populated.
