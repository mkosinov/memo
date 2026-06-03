'use client';

import React from 'react';

export interface Tab {
  id: string;
  label: string;
  sublabel?: string;
  color?: string;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onAddClick: () => void;
}

export function TabNav({ tabs, activeTab, onTabChange, onAddClick }: TabNavProps) {
  return (
    <div
      data-testid="tab-nav"
      className="flex flex-col w-44 border-r shrink-0"
      style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
    >
      <div className="flex flex-col gap-0.5 p-1.5 flex-1 overflow-y-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            data-testid={tab.id === 'settings' ? 'tab-settings' : `tab-${tab.id}`}
            className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-brand text-white font-medium'
                : 'text-ink-mid hover:bg-white/60'
            }`}
          >
            <div className="truncate">{tab.label}</div>
            {tab.sublabel && (
              <div
                className={`text-xs truncate mt-0.5 ${
                  activeTab === tab.id ? 'text-white/70' : 'text-ink-light'
                }`}
              >
                {tab.sublabel}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Add button at bottom */}
      <div className="p-1.5 border-t" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={onAddClick}
          aria-label="Добавить запись"
          data-testid="tab-add"
          className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm
                     text-ink-light hover:bg-white/60 hover:text-brand transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Запись
        </button>
      </div>
    </div>
  );
}
