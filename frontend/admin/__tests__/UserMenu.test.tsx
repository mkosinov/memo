// GH #262 §5.1: UserMenu popup — the user plate is the trigger; the popup
// opens UPWARD with exactly 4 items (theme slider, Мои данные, Сменить
// пароль, Выйти). A11y per the WAI-ARIA Menu Button pattern (same keyboard
// contract as the DataTable action menu). The theme item is a
// menuitemcheckbox carrying aria-checked = dark? (fix-round #262).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { UserMenu } from '../app/components/layout/UserMenu';
import { createMockUIContext } from './helpers/mockContexts';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));
// GH #262 T7: the two cabinet modals are wired from the UserMenu items.
// Mocked to lightweight markers — the modals' own behaviour is covered by
// MyDataModal.test.tsx / PasswordModal.test.tsx; here we only assert that
// clicking an item opens the right modal and that it closes again.
vi.mock('@/app/components/modal/MyDataModal', () => ({
  MyDataModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mydata-modal-stub" onClick={onClose} />
  ),
}));
vi.mock('@/app/components/modal/PasswordModal', () => ({
  PasswordModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="password-modal-stub" onClick={onClose} />
  ),
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

/** All menu entries in DOM order — the theme item is a menuitemcheckbox,
 *  the rest are menuitem; both are popup items. */
function menuItems(): HTMLElement[] {
  return Array.from(
    screen.getByRole('menu').querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'),
  );
}

const TRIGGER = 'Меню пользователя';

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
}

// Light theme (the mockContexts default) → the theme item's accessible name
// encodes the current state; aria-checked is false.
const ITEM_NAMES_LIGHT = ['Тема: светлая', 'Мои данные', 'Сменить пароль', 'Выйти'];

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
    const trigger = screen.getByRole('button', { name: TRIGGER });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('click on the plate opens the popup with EXACTLY 4 items in spec order', () => {
    renderMenu();
    openMenu();
    const items = menuItems();
    expect(items).toHaveLength(4);
    expect(items.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(
      ITEM_NAMES_LIGHT,
    );
  });

  it('click on the plate AGAIN closes the popup (toggle)', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole('button', { name: TRIGGER });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('aria-controls points to the menu id when open, absent when closed', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: TRIGGER });
    expect(trigger).not.toHaveAttribute('aria-controls');
    openMenu();
    const menu = screen.getByRole('menu');
    expect(menu.id).toBeTruthy();
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
  });

  it('popup opens UPWARD (anchored above the trigger)', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('menu')).toHaveClass('bottom-full');
  });

  it('Enter on the trigger opens the popup and flips aria-expanded', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: TRIGGER });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('opening moves focus to the first menu item', () => {
    renderMenu();
    openMenu();
    expect(menuItems()[0]).toHaveFocus();
  });

  it('Escape closes the popup and returns focus to the trigger', () => {
    renderMenu();
    openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: TRIGGER });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
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
    const items = menuItems();
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

  it('Home jumps to the first item, End to the last', () => {
    renderMenu();
    openMenu();
    const items = menuItems();
    const menu = screen.getByRole('menu');
    // Move into the middle, then Home → first.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    // End → last.
    fireEvent.keyDown(menu, { key: 'End' });
    expect(items[3]).toHaveFocus();
  });

  it('Tab closes the popup and focus proceeds from the trigger (not lost to body)', async () => {
    const user = userEvent.setup();
    // A focusable control AFTER the menu in DOM order — the next sidebar
    // element (the collapse button). With the fix, Tab from inside the popup
    // moves focus to the trigger first, then the browser's default Tab
    // proceeds from there to this next control. Without the fix the popup
    // unmounts under the focused node and focus collapses to <body>.
    render(
      <>
        <UserMenu collapsed={false} />
        <button type="button" aria-label="Следующий элемент">
          next
        </button>
      </>,
    );
    openMenu();
    expect(menuItems()[0]).toHaveFocus();

    await user.tab(); // default actions run → real focus traversal

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // Focus must NOT be lost to <body>; it lands on/after the trigger.
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Следующий элемент' })).toHaveFocus();
  });

  it('Shift+Tab closes the popup and focus returns toward the trigger', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button" aria-label="Предыдущий элемент">
          before
        </button>
        <UserMenu collapsed={false} />
        <button type="button" aria-label="Следующий элемент">
          next
        </button>
      </>,
    );
    openMenu();
    await user.tab({ shift: true }); // default actions run

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // Focus must NOT be lost to <body>; backward traversal from the trigger
    // lands on the element before it.
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Предыдущий элемент' })).toHaveFocus();
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
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Тема: светлая' }));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('collapsed sidebar: circular avatar-only trigger opens the same menu', () => {
    renderMenu({ collapsed: true });
    // No name text in the collapsed plate — avatar circle only.
    expect(screen.queryByText('Ольга Середа')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: TRIGGER });
    expect(trigger.querySelector('[data-testid="user-avatar"]')).toBeInTheDocument();
    openMenu();
    const items = menuItems();
    expect(items).toHaveLength(4);
    expect(items.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(
      ITEM_NAMES_LIGHT,
    );
  });
});

// GH #262 T7: «Мои данные» / «Сменить пароль» were inert placeholders until
// now — clicking each opens its modal and closes the popup.
describe('UserMenu cabinet modals (GH #262 T7)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue(mockAuthState());
    mockUseUI.mockReturnValue(createMockUIContext() as unknown as ReturnType<typeof useUI>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('neither modal is mounted before an item is clicked', () => {
    renderMenu();
    expect(screen.queryByTestId('mydata-modal-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('password-modal-stub')).not.toBeInTheDocument();
  });

  it('«Мои данные» opens MyDataModal and closes the popup', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Мои данные' }));
    expect(screen.getByTestId('mydata-modal-stub')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closing MyDataModal unmounts it', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Мои данные' }));
    fireEvent.click(screen.getByTestId('mydata-modal-stub'));
    expect(screen.queryByTestId('mydata-modal-stub')).not.toBeInTheDocument();
  });

  it('«Сменить пароль» opens PasswordModal and closes the popup', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Сменить пароль' }));
    expect(screen.getByTestId('password-modal-stub')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closing PasswordModal unmounts it', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Сменить пароль' }));
    fireEvent.click(screen.getByTestId('password-modal-stub'));
    expect(screen.queryByTestId('password-modal-stub')).not.toBeInTheDocument();
  });

  it('opening one modal does not mount the other', () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Мои данные' }));
    expect(screen.queryByTestId('password-modal-stub')).not.toBeInTheDocument();
  });
});

describe('UserMenu theme item — checked state + Label-in-Name (WCAG 2.5.3)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is a menuitemcheckbox with aria-checked=false in light theme', () => {
    mockUseAuth.mockReturnValue(mockAuthState());
    mockUseUI.mockReturnValue(createMockUIContext({ theme: 'light' }) as unknown as ReturnType<typeof useUI>);
    renderMenu();
    openMenu();
    const item = screen.getByRole('menuitemcheckbox');
    expect(item).toHaveAttribute('aria-checked', 'false');
  });

  it('is a menuitemcheckbox with aria-checked=true in dark theme', () => {
    mockUseAuth.mockReturnValue(mockAuthState());
    mockUseUI.mockReturnValue(createMockUIContext({ theme: 'dark' }) as unknown as ReturnType<typeof useUI>);
    renderMenu();
    openMenu();
    const item = screen.getByRole('menuitemcheckbox');
    expect(item).toHaveAttribute('aria-checked', 'true');
    // Accessible name tracks the state too (dark).
    expect(screen.getByRole('menuitemcheckbox', { name: 'Тема: тёмная' })).toBeInTheDocument();
  });

  it('accessible name contains the visible label «Тема» (Label-in-Name)', () => {
    mockUseAuth.mockReturnValue(mockAuthState());
    mockUseUI.mockReturnValue(createMockUIContext({ theme: 'light' }) as unknown as ReturnType<typeof useUI>);
    renderMenu();
    openMenu();
    const item = screen.getByRole('menuitemcheckbox');
    // Visible text the user sees:
    expect(item).toHaveTextContent('Тема');
    // Accessible name starts with the visible label text (WCAG 2.5.3).
    const name = item.getAttribute('aria-label') ?? '';
    expect(name.startsWith('Тема')).toBe(true);
    expect(name).toContain('Тема');
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
    // Optimized contract (GH #301 fix): src flows through /_next/image with
    // the absolutized backend URL (toAvatarSrc) as the url param — the raw
    // relative path would 404 in the optimizer.
    expect(avatar).toHaveAttribute('src', expect.stringContaining('/_next/image'));
    expect(avatar.getAttribute('src')).toContain(
      encodeURIComponent('http://localhost:8000/api/v1/files/avatar/x.png'),
    );
  });

  // GH #301 (img → next/image): intrinsic 28×28 dimensions matching the
  // fixed w-7 h-7 cell.
  it('renders the avatar image with raw src and intrinsic dimensions', () => {
    mockUseAuth.mockReturnValue(
      mockAuthState({
        master: { ...masterSnapshot, avatar_url: '/api/v1/files/avatar/x.png' },
      }),
    );
    renderMenu();
    const avatar = screen.getByTestId('user-avatar');
    expect(avatar).toHaveAttribute('width', '28');
    expect(avatar).toHaveAttribute('height', '28');
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
