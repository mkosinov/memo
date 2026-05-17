'use client';

import React from 'react';
import { useUI } from '@/contexts/UIContext';

export function StampFab() {
  const { rightPanelCollapsed, toggleRightPanel } = useUI();

  return (
    <button
      onClick={toggleRightPanel}
      className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-12 h-12 rounded-full shadow-lg transition-all duration-200 hover:shadow-xl hover:scale-105 active:scale-95"
      style={{
        backgroundColor: rightPanelCollapsed ? 'var(--brand)' : 'var(--white)',
        border: `2px solid ${rightPanelCollapsed ? 'var(--brand)' : 'var(--line)'}`,
        color: rightPanelCollapsed ? 'var(--white)' : 'var(--brand)',
      }}
      aria-label={rightPanelCollapsed ? 'Открыть панель инструментов' : 'Закрыть панель инструментов'}
      title={rightPanelCollapsed ? 'Инструменты' : 'Закрыть'}
    >
      {/* Stamp SVG icon */}
      <svg
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 21h14" />
        <path d="M5 18h14v3H5z" />
        <path d="M9 18V9l3-6 3 6v9" />
        <path d="M7 18h10" />
        <circle cx="12" cy="11" r="1" fill="currentColor" />
      </svg>
    </button>
  );
}
