import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  });
});

// #138 T4: MiniCalendar reads the page period from searchParams and pushes
// /schedule URLs — the reactive next/navigation mock (pathname + query)
// replaces the static usePathname stub.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __currentQuery, __lastPushedUrl } from './helpers/nextNavigationMock';

// GH #247 §4.5: the bottom-left user block reads the session user from
// AuthContext. Unit tests mock the context module (MainLayoutGuard pattern).
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/contexts/AuthContext';
import type { AuthStatus } from '../contexts/AuthContext';

const mockUseAuth = vi.mocked(useAuth);

const authUser = {
  id: 'user-uuid-1',
  phone: '+79990000001',
  role: 'admin' as const,
  master_id: null,
  email: null,
};

/** Matches AuthContextType minus the fields Menubar doesn't read. */
function mockAuthState(overrides?: {
  user?: typeof authUser | null;
  role?: string;
  master?: { first_name: string; last_name: string; avatar_url?: string | null } | null | undefined;
  status?: AuthStatus;
  logout?: ReturnType<typeof vi.fn>;
}) {
  const role = overrides?.role ?? authUser.role;
  const user = overrides?.user !== undefined ? overrides.user : { ...authUser, role };
  return {
    user,
    permissions: ['*'],
    master: overrides?.master !== undefined ? overrides.master : null,
    status: overrides?.status ?? ('authenticated' as AuthStatus),
    login: vi.fn(),
    logout: overrides?.logout ?? vi.fn(),
    can: vi.fn(() => true),
  } as unknown as ReturnType<typeof useAuth>;
}

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
    // Default: an authenticated admin (the historical hardcoded state, now real).
    mockUseAuth.mockReturnValue(mockAuthState());
    // #138 T4: default URL = /schedule with no params → today's period.
    __resetNavigation();
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
      // GH #266: «Сотрудники» joins the directories (user decision 2026-09-10).
      expect(screen.getByRole('link', { name: 'Сотрудники' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Сотрудники' })).toHaveAttribute('href', '/staff');
      expect(screen.getByRole('link', { name: 'Услуги' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Локации' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Теги' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Услуги' })).toHaveAttribute('href', '/services');
      expect(screen.getByRole('link', { name: 'Локации' })).toHaveAttribute('href', '/locations');
      expect(screen.getByRole('link', { name: 'Теги' })).toHaveAttribute('href', '/tags');
      // GH #266 T9: the positions dictionary joins the directories.
      expect(screen.getByRole('link', { name: 'Должности' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Должности' })).toHaveAttribute('href', '/positions');
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

  // GH #262 §5.1: the theme slider moved from the sidebar bottom row into the
  // UserMenu popup — the old row must be gone from the panel.
  it('does NOT render the old theme slider row', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /Переключить тему/i })).not.toBeInTheDocument();
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

  it('renders the UserMenu trigger (popup owns the theme toggle now)', () => {
    renderWithProviders();
    const trigger = screen.getByRole('button', { name: 'Меню пользователя' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

// ─── GH #262 §5.1: the user plate is the UserMenu trigger ─────────────────
// Plate content rules (spec rev 3, D1/D9): avatar + first/last name from the
// snapshot (archived cards included), NO role label, NO phone fallback —
// «Аноним» only when the card has no first/last name. The detailed popup
// behaviour (keyboard, focus, item set) lives in UserMenu.test.tsx.

describe('Menubar user block (GH #262 §5.1)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue(mockAuthState());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the snapshot first + last name and NO role label', () => {
    mockUseAuth.mockReturnValue(
      mockAuthState({ master: { first_name: 'Ольга', last_name: 'Середа' } }),
    );
    renderWithProviders();
    expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
    expect(screen.queryByText('Админ')).not.toBeInTheDocument();
    expect(screen.queryByText('Мастер')).not.toBeInTheDocument();
  });

  it('shows «Аноним» (never the phone) when no card is linked', () => {
    mockUseAuth.mockReturnValue(mockAuthState({ master: null }));
    renderWithProviders();
    expect(screen.getByText('Аноним')).toBeInTheDocument();
    expect(screen.queryByText('+79990000001')).not.toBeInTheDocument();
  });

  it('renders the avatar initial from the display name', () => {
    mockUseAuth.mockReturnValue(
      mockAuthState({ master: { first_name: 'Ольга', last_name: 'Середа' } }),
    );
    renderWithProviders();
    expect(screen.getByTestId('user-avatar')).toHaveTextContent('О');
  });

  it('renders <img> when the snapshot carries avatar_url', () => {
    mockUseAuth.mockReturnValue(
      mockAuthState({
        master: {
          first_name: 'Ольга',
          last_name: 'Середа',
          avatar_url: '/api/v1/files/avatar/portrait.png',
        },
      }),
    );
    renderWithProviders();
    const avatar = screen.getByTestId('user-avatar');
    expect(avatar.tagName).toBe('IMG');
    expect(avatar).toHaveAttribute('src', '/api/v1/files/avatar/portrait.png');
  });

  it('does NOT render a standalone «Выйти» button (it lives in the popup)', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: 'Выйти' })).not.toBeInTheDocument();
  });

  it('keeps the avatar trigger visible when the sidebar is collapsed', () => {
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: /Свернуть/i }));
    const trigger = screen.getByRole('button', { name: 'Меню пользователя' });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector('[data-testid="user-avatar"]')).toBeInTheDocument();
    // Collapsed: avatar-only circle, no name text.
    expect(screen.queryByText('Ольга Середа')).not.toBeInTheDocument();
  });
});

// ─── GH #263 T9: menu filtering by role ───────────────────────────────────
// Master loses the admin-only destinations: Клиенты (nav) + Сотрудники,
// Локации, Теги, Должности (directories). Allowed items (Расписание, Записи,
// Услуги, Фото) and the #262 bottom block stay untouched.

describe('Menubar role filtering (GH #263)', () => {
  beforeEach(() => {
    vi.setSystemTime(MOCK_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function renderAsMaster() {
    mockUseAuth.mockReturnValue(
      mockAuthState({ role: 'master' as const }),
    );
    renderWithProviders();
  }

  it('master does NOT see the Клиенты nav item', () => {
    renderAsMaster();
    expect(screen.queryByRole('link', { name: 'Клиенты' })).not.toBeInTheDocument();
  });

  it('master does NOT see Сотрудники/Локации/Теги/Должности in directories', () => {
    renderAsMaster();
    fireEvent.click(screen.getByRole('button', { name: 'Справочники' }));
    expect(screen.queryByRole('link', { name: 'Сотрудники' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Локации' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Теги' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Должности' })).not.toBeInTheDocument();
  });

  it('master still sees allowed items: Расписание, Записи, Услуги, Фото', () => {
    renderAsMaster();
    expect(screen.getByRole('link', { name: 'Расписание' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Записи' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Справочники' }));
    expect(screen.getByRole('link', { name: 'Услуги' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Фото' })).toBeInTheDocument();
  });

  it('master does NOT see the Мастера collapsible button', () => {
    renderAsMaster();
    expect(screen.queryByRole('button', { name: 'Мастера' })).not.toBeInTheDocument();
  });

  it('master keeps the #262 bottom block (user menu + collapse + version)', () => {
    renderAsMaster();
    expect(screen.getByRole('button', { name: 'Меню пользователя' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Свернуть|Развернуть/i })).toBeInTheDocument();
    expect(screen.getByText(/v0\.0\.1/i)).toBeInTheDocument();
  });

  it('admin keeps ALL items (no regression)', () => {
    mockUseAuth.mockReturnValue(mockAuthState());
    renderWithProviders();
    expect(screen.getByRole('link', { name: 'Клиенты' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Справочники' }));
    expect(screen.getByRole('link', { name: 'Сотрудники' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Мастера' })).toBeInTheDocument();
  });
});

// ─── #138 T4: MiniCalendar — searchParams-driven navigator + indicator ─────
// Spec §2.3: the mini calendar no longer owns the period (no NavigationContext,
// no __memo-* events). It reads the CURRENT page's period via useSearchParams,
// navigates by pushing /schedule?view=&date=, and mirrors the period:
//   /schedule ?view=&date=  → week-row bg-brand/30 or day bg-brand/40
//   /records valid ?from&to → red range (distinct edges), month from ?from
//   otherwise               → neutral today-week, no day highlight
// Month paging/picker is LOCAL state, re-synced on every navigation.
// MOCK_NOW = 2026-06-15 (a Monday); schedule-highlight tests use JULY dates to
// discriminate against the today-default (June) that the old prop-driven code
// rendered.

describe('MiniCalendar — URL-driven navigator (#138 T4)', () => {
  beforeEach(() => {
    vi.setSystemTime(MOCK_NOW);
    mockUseAuth.mockReturnValue(mockAuthState());
    __resetNavigation();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dayBtn = (label: string) => screen.getByRole('button', { name: label });
  const daySpan = (label: string) => dayBtn(label).querySelector('span');

  // ── Highlight states ──────────────────────────────────────────────────────

  it('/schedule?view=week&date=2026-07-16: week row gets bg-brand/30 + existing inline day toggles', () => {
    __resetNavigation('?view=week&date=2026-07-16');
    renderWithProviders();
    expect(screen.getByText('Июль 2026')).toBeInTheDocument();
    expect(dayBtn('16 июля').parentElement).toHaveClass('bg-brand/30');
    // A different week is NOT highlighted
    expect(dayBtn('2 июля').parentElement).not.toHaveClass('bg-brand/30');
    // Existing inline-toggle logic (unchanged): in week mode every day of the
    // active week carries bg-brand/40, days outside it do not.
    expect(daySpan('16 июля')).toHaveClass('bg-brand/40');
    expect(daySpan('20 июля')).not.toHaveClass('bg-brand/40');
    expect(daySpan('2 июля')).not.toHaveClass('bg-brand/40');
  });

  it('/schedule?view=day&date=2026-07-16: only the ?date day carries bg-brand/40, week row stays tinted', () => {
    __resetNavigation('?view=day&date=2026-07-16');
    renderWithProviders();
    expect(screen.getByText('Июль 2026')).toBeInTheDocument();
    expect(daySpan('16 июля')).toHaveClass('bg-brand/40');
    // Other days of the same week are NOT day-highlighted in day mode
    expect(daySpan('15 июля')).not.toHaveClass('bg-brand/40');
    // Existing row behaviour (unchanged): the week stays tinted bg-brand/30
    expect(dayBtn('16 июля').parentElement).toHaveClass('bg-brand/30');
  });

  it('/records with a valid ?from&to pair: red range with distinct edges, month from ?from, no brand week rows', () => {
    __resetNavigation('?from=2026-06-10&to=2026-06-12', '/records');
    renderWithProviders();
    // Displayed month is initialized from ?from
    expect(screen.getByText('Июнь 2026')).toBeInTheDocument();
    // Start / middle / end of the range
    expect(daySpan('10 июня')).toHaveClass('bg-red-400/45', 'rounded-l-full');
    expect(daySpan('11 июня')).toHaveClass('bg-red-400/25');
    expect(daySpan('11 июня')).not.toHaveClass('rounded-l-full');
    expect(daySpan('11 июня')).not.toHaveClass('rounded-r-full');
    expect(daySpan('12 июня')).toHaveClass('bg-red-400/45', 'rounded-r-full');
    // The red range replaces the brand week-row indicator entirely
    expect(dayBtn('11 июня').parentElement).not.toHaveClass('bg-brand/30');
    expect(dayBtn('15 июня').parentElement).not.toHaveClass('bg-brand/30');
  });

  it('other pages: neutral today-week highlight, no day-level highlight', () => {
    __resetNavigation('', '/clients');
    renderWithProviders();
    expect(dayBtn('15 июня').parentElement).toHaveClass('bg-brand/30'); // week of 2026-06-15
    expect(daySpan('16 июня')).not.toHaveClass('bg-brand/40');
    expect(daySpan('16 июня')).not.toHaveClass('bg-red-400/25');
  });

  it('/records without a valid pair: neutral highlight, no red range', () => {
    __resetNavigation('?from=garbage&to=2026-06-12', '/records');
    renderWithProviders();
    expect(dayBtn('15 июня').parentElement).toHaveClass('bg-brand/30');
    expect(daySpan('12 июня')).not.toHaveClass('bg-red-400/25');
    expect(daySpan('12 июня')).not.toHaveClass('bg-red-400/45');
  });

  // ── Push targets ──────────────────────────────────────────────────────────

  it('day click pushes /schedule?view=week&date=<day>', () => {
    __resetNavigation('?from=2026-06-10&to=2026-06-12', '/records');
    renderWithProviders();
    fireEvent.click(dayBtn('20 июня'));
    expect(__lastPushedUrl()).toBe('/schedule?view=week&date=2026-06-20');
  });

  it('day double-click pushes /schedule?view=day&date=<day>', () => {
    renderWithProviders();
    fireEvent.doubleClick(dayBtn('20 июня'));
    expect(__lastPushedUrl()).toBe('/schedule?view=day&date=2026-06-20');
  });

  it('«Сегодня» pushes view=week&date=today from another page', () => {
    __resetNavigation('', '/records');
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: /Сегодня/ }));
    expect(__lastPushedUrl()).toBe('/schedule?view=week&date=2026-06-15');
  });

  it('«Сегодня» keeps the day view when /schedule is already in day view', () => {
    __resetNavigation('?view=day&date=2026-07-16');
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: /Сегодня/ }));
    expect(__lastPushedUrl()).toBe('/schedule?view=day&date=2026-06-15');
  });

  // ── Local month paging ────────────────────────────────────────────────────

  it('month arrows page the grid locally without touching the URL', () => {
    __resetNavigation('?view=week&date=2026-06-16');
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(screen.getByText('Июль 2026')).toBeInTheDocument();
    expect(__lastPushedUrl()).toBeNull();
    expect(__currentQuery()).toBe('?view=week&date=2026-06-16');
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(screen.getByText('Май 2026')).toBeInTheDocument();
    expect(__lastPushedUrl()).toBeNull();
  });

  it('a day click in a locally paged month pushes that day; navigation re-syncs the month', () => {
    __resetNavigation('?view=week&date=2026-06-16');
    renderWithProviders();
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    fireEvent.click(dayBtn('15 июля'));
    expect(__lastPushedUrl()).toBe('/schedule?view=week&date=2026-07-15');
    // A real navigation re-render → the grid re-syncs to the new page period
    act(() => {
      __resetNavigation('?view=week&date=2026-08-20');
    });
    expect(screen.getByText('Август 2026')).toBeInTheDocument();
  });
});
