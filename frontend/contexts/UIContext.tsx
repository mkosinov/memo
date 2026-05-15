'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface Toast {
  id: string;
  message: string;
  undo?: () => void;
}

interface UIContextType {
  deleteMode: boolean;
  toggleDeleteMode: () => void;
  toasts: Toast[];
  showToast: (message: string, undo?: () => void) => void;
  hideToast: (id: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  rightPanelCollapsed: boolean;
  toggleRightPanel: () => void;
}

const UIContext = createContext<UIContextType | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [deleteMode, setDeleteMode] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  const toggleDeleteMode = useCallback(() => {
    setDeleteMode(prev => !prev);
  }, []);

  const showToast = useCallback((message: string, undo?: () => void) => {
    const id = `toast_${Date.now()}`;
    setToasts(prev => [...prev, { id, message, undo }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightPanelCollapsed(prev => !prev);
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
