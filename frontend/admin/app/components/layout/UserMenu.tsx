'use client';

// GH #262 §5.1: UserMenu — the sidebar user plate is the trigger of an
// upward-opening popup with exactly 4 items: theme slider, «Мои данные»,
// «Сменить пароль», «Выйти». Keyboard contract follows the WAI-ARIA Menu
// Button pattern used by the DataTable action menu (roving tabindex,
// arrows/Home/End navigate, Escape closes and returns focus to the trigger,
// Tab moves out AND closes, outside mousedown closes). D1: no header — the
// plate already shows avatar + name. D9: «Аноним» fallback, never the phone.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Moon, Sun, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUI } from '@/contexts/UIContext';
import { MyDataModal } from '@/app/components/modal/MyDataModal';
import { PasswordModal } from '@/app/components/modal/PasswordModal';

// GH #143: hand-written SVGs replaced by lucide-react. Sizing contract: the
// previous inline SVGs were 14×14, so size={14} keeps the popup geometry.

interface UserMenuProps {
  /** Collapsed sidebar: avatar-only circular trigger (spec §5.1). */
  collapsed: boolean;
}

export function UserMenu({ collapsed }: UserMenuProps) {
  const { master, logout } = useAuth();
  const { theme, toggleTheme } = useUI();

  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  // GH #262 T7: the two cabinet modals, opened from the menu items.
  const [myDataOpen, setMyDataOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Plate content per spec rev 3 (D9): first + last name from the /auth/me
  // snapshot (T3 supplies archived-card names too); «Аноним» only when the
  // card carries no name — in practice, when there is no card at all.
  const fullName = master ? `${master.first_name} ${master.last_name}`.trim() : '';
  const displayName = fullName || 'Аноним';
  const avatarUrl = master?.avatar_url ?? null;

  // Outside mousedown closes the popup (DataTable action-menu pattern).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Popup entries for roving focus: menuitem + menuitemcheckbox (the theme
  // row is a checkbox item — fix-round #262 finding 1).
  const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"]';

  // Focus the first item right after the popup opens.
  useEffect(() => {
    if (!open) return;
    setFocusedIdx(0);
    menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [open]);

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    // jsdom (and some AT) deliver Enter/Space as keydown without a click —
    // open explicitly. preventDefault stops Space's native click from
    // toggling the freshly opened menu shut again.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((prev) => !prev);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const moveTo = (i: number) => {
      setFocusedIdx(i);
      items[i]?.focus();
    };
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeAndFocusTrigger();
        break;
      case 'Tab':
        // Spec §5.1: Tab moves focus away AND closes. Fix-round finding 2:
        // focus the trigger FIRST so it survives the popup unmount, then
        // close — the browser's default Tab traversal proceeds from the
        // trigger to the next focusable instead of collapsing to <body>.
        // No preventDefault: it would cancel that default traversal.
        triggerRef.current?.focus();
        setOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveTo((idx + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(idx <= 0 ? items.length - 1 : idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(items.length - 1);
        break;
    }
  };

  const itemClass =
    'w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-xs text-white/70 ' +
    'hover:bg-white/10 hover:text-white transition-colors';

  const avatar = avatarUrl ? (
    <img
      data-testid="user-avatar"
      src={avatarUrl}
      alt=""
      className="w-7 h-7 rounded-full object-cover flex-shrink-0"
    />
  ) : (
    <div
      data-testid="user-avatar"
      className="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center text-xs text-white font-medium flex-shrink-0"
    >
      {displayName.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`relative ${collapsed ? 'flex justify-center py-3' : 'px-3 pt-3 pb-2'}`}
    >
      {/* Trigger — the user plate (expanded) / avatar circle (collapsed) */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-label="Меню пользователя"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'user-menu-popup' : undefined}
        className={
          collapsed
            ? 'flex items-center justify-center rounded-full hover:ring-2 hover:ring-white/20 transition-all'
            : 'w-full flex items-center gap-2 rounded-lg p-1 -m-1 hover:bg-white/5 transition-colors'
        }
      >
        {avatar}
        {!collapsed && (
          <span className="flex-1 min-w-0 text-xs text-white/90 truncate text-left">
            {displayName}
          </span>
        )}
      </button>

      {/* Popup — opens UPWARD (bottom-full), compact rounded card (D1) */}
      {open && (
        <div
          ref={menuRef}
          id="user-menu-popup"
          role="menu"
          aria-label="Меню пользователя"
          onKeyDown={handleMenuKeyDown}
          data-testid="user-menu-popup"
          className="absolute bottom-full left-0 mb-2 z-[var(--z-popover)] w-56 rounded-xl shadow-lg border border-white/10 bg-sidebar p-1.5 space-y-0.5"
        >
          {/* 1. Theme slider (moved from the Menubar bottom row, §5.1).
              Stays open on toggle so the user sees the palette switch.
              Fix-round finding 1: menuitemcheckbox + aria-checked (dark?) and
              a Label-in-Name accessible name that starts with the visible
              «Тема» text (WCAG 2.5.3). */}
          <div
            role="menuitemcheckbox"
            tabIndex={focusedIdx === 0 ? 0 : -1}
            aria-checked={theme === 'dark'}
            aria-label={`Тема: ${theme === 'dark' ? 'тёмная' : 'светлая'}`}
            onClick={toggleTheme}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                toggleTheme();
              }
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer text-white/70 hover:bg-white/10 transition-colors focus:outline-none"
          >
            <span className="text-xs">Тема</span>
            <span className="flex items-center gap-1 bg-white/10 rounded-full p-0.5">
              <span
                className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${theme === 'light' ? 'bg-white/20 text-white' : 'text-white/40'}`}
              >
                <Sun size={14} />
              </span>
              <span
                className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${theme === 'dark' ? 'bg-white/20 text-white' : 'text-white/40'}`}
              >
                <Moon size={14} />
              </span>
            </span>
          </div>

          {/* 2. «Мои данные» — opens MyDataModal (GH #262 T7). */}
          <button
            type="button"
            role="menuitem"
            tabIndex={focusedIdx === 1 ? 0 : -1}
            onClick={() => {
              setOpen(false);
              setMyDataOpen(true);
            }}
            className={itemClass}
          >
            Мои данные
          </button>

          {/* 3. «Сменить пароль» — opens PasswordModal (GH #262 T7). */}
          <button
            type="button"
            role="menuitem"
            tabIndex={focusedIdx === 2 ? 0 : -1}
            onClick={() => {
              setOpen(false);
              setPasswordOpen(true);
            }}
            className={itemClass}
          >
            Сменить пароль
          </button>

          {/* 4. «Выйти» — the AuthContext logout helper (#247 flow → /login
              via the AuthGate guard); no duplicate API call. */}
          <button
            type="button"
            role="menuitem"
            tabIndex={focusedIdx === 3 ? 0 : -1}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className={`${itemClass} text-[var(--danger,#C8503C)] hover:text-white`}
          >
            <LogOut size={14} />
            Выйти
          </button>
        </div>
      )}

      {/* Cabinet modals (GH #262 T7) — fixed overlays, rendered on demand. */}
      {myDataOpen && <MyDataModal onClose={() => setMyDataOpen(false)} />}
      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}
