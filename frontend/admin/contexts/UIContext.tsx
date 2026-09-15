'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export type ToastKind = 'info' | 'success' | 'error' | 'loading';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  undo?: () => void;
}

interface UIContextType {
  deleteMode: boolean;
  toggleDeleteMode: () => void;
  toasts: Toast[];
  showToast: (message: string, kindOrUndo?: ToastKind | (() => void), undo?: () => void) => string;
  hideToast: (id: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  rightPanelCollapsed: boolean;
  toggleRightPanel: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const UIContext = createContext<UIContextType | null>(null);

const THEME_STORAGE_KEY = 'memo-theme';

function readStoredTheme(): 'light' | 'dark' | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null; // storage blocked (private mode / SSR) — fall back to light
  }
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [deleteMode, setDeleteMode] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // #262 §5.4: restore persisted theme on mount. The pre-hydration script in
  // app/layout.tsx already applied data-theme before React hydrated, so this
  // only syncs React state (and re-applies the attribute defensively).
  useEffect(() => {
    const stored = readStoredTheme();
    if (stored) {
      setTheme(stored);
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  // Clean up all pending toast timers on unmount
  useEffect(() => {
    return () => {
      toastTimers.current.forEach((timerId) => clearTimeout(timerId));
      toastTimers.current.clear();
    };
  }, []);

  const toggleDeleteMode = useCallback(() => {
    setDeleteMode(prev => !prev);
  }, []);

  const showToast = useCallback((
    message: string,
    kindOrUndo?: ToastKind | (() => void),
    undo?: () => void,
  ): string => {
    let kind: ToastKind = 'info';
    let undoFn: (() => void) | undefined;
    if (typeof kindOrUndo === 'function') {
      undoFn = kindOrUndo;
    } else if (kindOrUndo) {
      kind = kindOrUndo;
      undoFn = undo;
    }
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, kind, message, undo: undoFn }]);
    if (kind !== 'loading') {
      const duration = undoFn ? 5000 : 4500; // undo toasts stay 5s
      const timerId = setTimeout(() => {
        toastTimers.current.delete(id);
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
      toastTimers.current.set(id, timerId);
    }
    return id;
  }, []);

  const hideToast = useCallback((id: string) => {
    const timerId = toastTimers.current.get(id);
    if (timerId) {
      clearTimeout(timerId);
      toastTimers.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightPanelCollapsed(prev => !prev);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
      }
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // storage unavailable — theme still applies for this session
        }
      }
      return next;
    });
  }, []);

  return (
    <UIContext.Provider value={{
      deleteMode,
      toggleDeleteMode,
      toasts,
      showToast,
      hideToast,
      sidebarCollapsed,
      toggleSidebar,
      rightPanelCollapsed,
      toggleRightPanel,
      theme,
      toggleTheme,
    }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (!context) throw new Error('useUI must be used within UIProvider');
  return context;
}
