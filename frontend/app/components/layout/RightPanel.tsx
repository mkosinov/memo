'use client';

import React, { useState } from 'react';
import { useUI } from '@/contexts/UIContext';

// ─── Accordion Section ────────────────────────────────────────────────────

interface AccordionSectionProps {
  title: string;
  children: React.ReactNode;
  contentTestId?: string;
}

function AccordionSection({ title, children, contentTestId }: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border-b" style={{ borderColor: 'var(--line)' }}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-colors hover:bg-surface"
        style={{ color: 'var(--ink)' }}
        aria-label={title}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <svg
          className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        data-testid={contentTestId}
        className={`overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-96 px-4 pb-3' : 'max-h-0'}`}
      >
        {children}
      </div>
    </div>
  );
}

// ─── RightPanel ───────────────────────────────────────────────────────────

export function RightPanel() {
  const { rightPanelCollapsed } = useUI();

  return (
    <aside
      data-testid="right-panel"
      className="fixed right-0 top-0 z-20 h-full border-l bg-white transition-all duration-200"
      style={{
        width: rightPanelCollapsed ? '0' : 'var(--right-w)',
        borderColor: 'var(--line)',
        paddingTop: 'var(--toolbar-h, 56px)',
        overflow: 'hidden',
      }}
    >
      {!rightPanelCollapsed && (
        <div className="h-full overflow-y-auto">
          {/* Header */}
          <div
            className="px-4 py-3 text-sm font-semibold"
            style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line)' }}
          >
            Инструменты
          </div>

          {/* Штамп Section */}
          <AccordionSection title="Штамп" contentTestId="stamp-content">
            <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
              Настройте параметры для быстрого создания событий
            </p>
          </AccordionSection>

          {/* Неделя Section */}
          <AccordionSection title="Неделя" contentTestId="week-content">
            <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
              Управление событиями недели
            </p>
          </AccordionSection>
        </div>
      )}
    </aside>
  );
}
