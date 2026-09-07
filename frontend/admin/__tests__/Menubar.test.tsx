import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Menubar } from '../app/components/layout/Menubar';
import { NavigationProvider } from '../contexts/NavigationContext';
import { UIProvider } from '../contexts/UIContext';
import { DAYS_FULL, MONTHS_GENITIVE } from '../lib/utils';

vi.mock('@memo/api-client', () => {
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return ({
  getAllMasters: vi.fn().mockResolvedValue([
    { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm2', first_name: 'Юлия', last_name: 'Большакова', color: '#6B7E9C', position: 'мастер', specialty: 'керамика', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm3', first_name: 'Анастасия', last_name: 'П.', color: '#A07060', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm4', first_name: 'Дарья', last_name: 'Тюльпина', color: '#7A6E9C', position: 'мастер', specialty: 'керамика', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm5', first_name: 'Александра', last_name: 'В.', color: '#8A7840', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm7', first_name: 'Ирина', last_name: 'Горох', color: '#9A5870', position: 'мастер', specialty: 'керамика', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
  ]),
  getAllLocations: vi.fn().mockResolvedValue([]),
  getAllServices: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue(wrap([])),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  });
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/schedule',
}));

// GH #141 Task 11: Menubar imports ONLY the ViewModeType type from the split
// view context (erased at runtime); Menubar tracks viewMode/selectedDay via
// the __memo-* event bus. Defensive mock kept at the new module path.
vi.mock('@/contexts/schedule/ScheduleViewContext', () => ({
  useScheduleView: vi.fn(() => ({
    viewMode: 'week',
    selectedDay: new Date(),
    setViewMode: vi.fn(),
    setSelectedDay: vi.fn(),
  })),
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <NavigationProvider>
          <Menubar />
        </NavigationProvider>
      </UIProvider>
    </QueryClientProvider>
  );
}

// Freeze system time so date-dependent assertions (mini calendar month name,
// "Сегодня" button text) are deterministic regardless of the real calendar
// date (avoids month/year-edge flakes, see GH #123).
// NOTE: intentionally NOT using vi.useFakeTimers() here — several tests in
// this file rely on real async timing via `waitFor`/`fireEvent`, and fake
// timers would need manual advancing that isn't otherwise required. Per
// Vitest docs, vi.setSystemTime() without useFakeTimers() only mocks
// `Date.*` calls while leaving real timers (setTimeout, etc.) untouched.
const MOCK_NOW = new Date('2026-06-15T12:00:00');

describe('Menubar', () => {
  beforeEach(() => {
    vi.setSystemTime(MOCK_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the logo with alt text "Colour Mountains"', () => {
    renderWithProviders();
    expect(screen.getByRole('img', { name: 'Colour Mountains' })).toBeInTheDocument();
  });

  it('renders navigation links (Расписание, Записи, Клиенты)', () => {
    renderWithProviders();
    expect(screen.getByRole('link', { name: 'Расписание' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Записи' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Клиенты' })).toBeInTheDocument();
  });

  it('does not render Chat menu item', () => {
    renderWithProviders();
    expect(screen.queryByRole('link', { name: 'Чат' })).not.toBeInTheDocument();
  });

  it('renders Мастера and Справочники as buttons', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: 'Мастера' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Справочники' })).toBeInTheDocument();
  });

  it('shows master list when Мастера is clicked', async () => {
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: 'Мастера' }));
    await waitFor(() => {
      expect(screen.getByText(/Середа Ольга/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Большакова Юлия/)).toBeInTheDocument();
  });

  it('hides master list when Мастера is clicked again', async () => {
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: 'Мастера' }));
    await waitFor(() => {
      expect(screen.getByText(/Середа Ольга/)).toBeInTheDocument();
    });
    // Click again to close
    fireEvent.click(screen.getByRole('button', { name: 'Мастера' }));
    await waitFor(() => {
      expect(screen.queryByText(/Середа Ольга/)).not.toBeInTheDocument();
    });
  });

  it('shows directory links when Справочники is clicked', async () => {
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: 'Справочники' }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Услуги' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Локации' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Теги' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Услуги' })).toHaveAttribute('href', '/services');
      expect(screen.getByRole('link', { name: 'Локации' })).toHaveAttribute('href', '/locations');
      expect(screen.getByRole('link', { name: 'Теги' })).toHaveAttribute('href', '/tags');
    });
  });

  it('renders Фото as a standalone link', () => {
    renderWithProviders();
    expect(screen.getByRole('link', { name: 'Фото' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Фото' })).toHaveAttribute('href', '/photos');
  });

  it('highlights the active navigation link (Расписание)', () => {
    renderWithProviders();
    const activeLink = screen.getByRole('link', { name: 'Расписание' });
    expect(activeLink).toHaveClass('bg-brand');
  });

  it('renders theme toggle as a slider switch', () => {
    renderWithProviders();
    // The slider container should be clickable
    const slider = screen.getByRole('button', { name: /Переключить/i });
    expect(slider).toBeInTheDocument();
    // Should contain sun and moon indicators
    expect(slider.querySelector('svg')).toBeInTheDocument();
  });

  it('renders collapse/expand button', () => {
    renderWithProviders();
    const collapseBtn = screen.getByRole('button', { name: /Свернуть|Развернуть/i });
    expect(collapseBtn).toBeInTheDocument();
  });

  it('renders version number at bottom', () => {
    renderWithProviders();
    expect(screen.getByText(/v0\.0\.1/i)).toBeInTheDocument();
  });

  it('renders mini calendar with current month name', () => {
    renderWithProviders();
    const now = new Date();
    const monthNames = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
    ];
    const currentMonth = monthNames[now.getMonth()];
    // The month text is rendered alongside the year, so use a regex
    expect(screen.getByText(new RegExp(currentMonth))).toBeInTheDocument();
  });

  it('renders day headers in the mini calendar', () => {
    renderWithProviders();
    expect(screen.getByText('ПН')).toBeInTheDocument();
    expect(screen.getByText('ВС')).toBeInTheDocument();
  });

  it('renders "Сегодня" button with current date and weekday', () => {
    renderWithProviders();
    const now = new Date();
    const day = now.getDate();
    const month = MONTHS_GENITIVE[now.getMonth()];
    const weekday = DAYS_FULL[(now.getDay() + 6) % 7];
    const expectedText = `Сегодня ${day} ${month}, ${weekday}`;
    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });

  it('collapses menubar when collapse button is clicked', () => {
    renderWithProviders();
    const sidebar = screen.getByTestId('menubar');
    // Initially not collapsed (width is 230px)
    expect(sidebar).toHaveStyle({ width: 'var(--sidebar-w)' });

    // Find and click collapse button
    const collapseBtn = screen.getByRole('button', { name: /Свернуть/i });
    fireEvent.click(collapseBtn);

    // After click, sidebar should be collapsed (width is 56px)
    expect(sidebar).toHaveStyle({ width: 'var(--sidebar-collapsed-w)' });
  });

  it('toggles theme when theme button is clicked', () => {
    renderWithProviders();
    const toggle = screen.getByRole('button', { name: /Переключить/i });
    const html = document.documentElement;
    const initialTheme = html.getAttribute('data-theme');
    fireEvent.click(toggle);
    const newTheme = html.getAttribute('data-theme');
    expect(newTheme).toBe('dark');
  });
});
