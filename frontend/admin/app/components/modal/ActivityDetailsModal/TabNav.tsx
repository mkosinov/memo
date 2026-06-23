'use client';

import React from 'react';

export interface Tab {
  id: string;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
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

      {/* Add button at bottom — height matches ClientTab footer (py-3 + text content) */}
      <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={onAddClick}
          aria-label="Добавить запись"
          data-testid="tab-add"
          className="w-full flex items-center justify-center gap-1 h-5 text-sm
                     text-ink-light hover:bg-white/60 hover:text-brand transition-colors"
        >
          + Запись
        </button>
      </div>
    </div>
  );
}
