// GH #262 §5.1: UserMenu popup — the user plate is the trigger; the popup
// opens UPWARD with exactly 4 items (theme slider, Мои данные, Сменить
// пароль, Выйти). A11y per the WAI-ARIA Menu Button pattern (same keyboard
// contract as the DataTable action menu).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { UserMenu } from '../app/components/layout/UserMenu';
import { createMockUIContext } from './helpers/mockContexts';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { useAuth } from '@/contexts/AuthContext';
import { useUI } from '@/contexts/UIContext';

const mockUseAuth = vi.mocked(useAuth);
const mockUseUI = vi.mocked(useUI);

const masterSnapshot = {
  first_name: 'Ольга',
  last_name: 'Середа',
  avatar_url: null as string | null,
};

function mockAuthState(overrides?: {
  master?: typeof masterSnapshot | null;
  logout?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: { id: 'u1', phone: '+79990000001', role: 'admin', master_id: null, email: null },
    permissions: ['*'],
    master: overrides?.master !== undefined ? overrides.master : masterSnapshot,
    status: 'authenticated' as const,
    login: vi.fn(),
    logout: overrides?.logout ?? vi.fn().mockResolvedValue(undefined),
    can: vi.fn(() => true),
  } as unknown as ReturnType<typeof useAuth>;
}

function renderMenu(props?: { collapsed?: boolean }) {
  return render(<UserMenu collapsed={props?.collapsed ?? false} />);
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Меню пользователя' }));
}

const ITEM_NAMES = ['Переключить тему', 'Мои данные', 'Сменить пароль', 'Выйти'];

describe('UserMenu popup', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue(mockAuthState());
    mockUseUI.mockReturnValue(createMockUIContext() as unknown as ReturnType<typeof useUI>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a menu-button trigger with the popup closed', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Меню пользователя' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('click on the plate opens the popup with EXACTLY 4 items in spec order', () => {
    renderMenu();
    openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(ITEM_NAMES);
  });

  it('popup opens UPWARD (anchored above the trigger)', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('menu')).toHaveClass('bottom-full');
  });

  it('Enter on the trigger opens the popup and flips aria-expanded', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Меню пользователя' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('opening moves focus to the first menu item', () => {
    renderMenu();
    openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
  });

  it('Escape closes the popup and returns focus to the trigger', () => {
    renderMenu();
    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Меню пользователя' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Меню пользователя' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('outside mousedown closes the popup', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('ArrowDown/ArrowUp move focus between items (with wrap)', () => {
    renderMenu();
    openMenu();
    const items = screen.getAllByRole('menuitem');
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items[1]).toHaveFocus();
    // Wrap from the first to the last
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items[3]).toHaveFocus();
  });

  it('Tab closes the popup (focus leaves the menu)', () => {
    renderMenu();
    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('«Выйти» calls the AuthContext logout helper exactly once', () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(mockAuthState({ logout }));
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Выйти' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('theme item calls toggleTheme and keeps the popup open', () => {
    const toggleTheme = vi.fn();
    mockUseUI.mockReturnValue(
      createMockUIContext({ toggleTheme }) as unknown as ReturnType<typeof useUI>,
    );
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переключить тему' }));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('collapsed sidebar: circular avatar-only trigger opens the same menu', () => {
    renderMenu({ collapsed: true });
    // No name text in the collapsed plate — avatar circle only.
    expect(screen.queryByText('Ольга Середа')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Меню пользователя' });
    expect(trigger.querySelector('[data-testid="user-avatar"]')).toBeInTheDocument();
    openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(ITEM_NAMES);
  });
});

describe('UserMenu plate content (spec rev 3, D1/D9)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue(mockAuthState());
    mockUseUI.mockReturnValue(createMockUIContext() as unknown as ReturnType<typeof useUI>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows first + last name from the snapshot (incl. archived cards)', () => {
    renderMenu();
    expect(screen.getByText('Ольга Середа')).toBeInTheDocument();
  });

  it('shows NO role label and NO phone fallback', () => {
    renderMenu();
    expect(screen.queryByText('Админ')).not.toBeInTheDocument();
    expect(screen.queryByText('Мастер')).not.toBeInTheDocument();
    expect(screen.queryByText('+79990000001')).not.toBeInTheDocument();
  });

  it('falls back to «Аноним» when the user has no card', () => {
    mockUseAuth.mockReturnValue(mockAuthState({ master: null }));
    renderMenu();
    expect(screen.getByText('Аноним')).toBeInTheDocument();
    expect(screen.queryByText('+79990000001')).not.toBeInTheDocument();
  });

  it('falls back to «Аноним» when the card carries no first/last name', () => {
    mockUseAuth.mockReturnValue(
      mockAuthState({ master: { first_name: '', last_name: '', avatar_url: null } }),
    );
    renderMenu();
    expect(screen.getByText('Аноним')).toBeInTheDocument();
  });

  it('renders <img> when master.avatar_url is present', () => {
    mockUseAuth.mockReturnValue(
      mockAuthState({
        master: { ...masterSnapshot, avatar_url: '/api/v1/files/avatar/x.png' },
      }),
    );
    renderMenu();
    const avatar = screen.getByTestId('user-avatar');
    expect(avatar.tagName).toBe('IMG');
    expect(avatar).toHaveAttribute('src', '/api/v1/files/avatar/x.png');
  });

  it('renders the initial letter when avatar_url is absent', () => {
    renderMenu();
    const avatar = screen.getByTestId('user-avatar');
    expect(avatar.tagName).not.toBe('IMG');
    expect(avatar).toHaveTextContent('О');
  });

  it('renders the «А» initial for «Аноним»', () => {
    mockUseAuth.mockReturnValue(mockAuthState({ master: null }));
    renderMenu();
    expect(screen.getByTestId('user-avatar')).toHaveTextContent('А');
  });
});
