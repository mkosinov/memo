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
