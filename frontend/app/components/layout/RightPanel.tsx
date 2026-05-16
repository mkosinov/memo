'use client';

import React, { useState } from 'react';
import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { StampPanel } from '@/app/components/stamp/StampPanel';

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
  const { rightPanelCollapsed, toggleRightPanel, showToast } = useUI();
  const { copyLastWeek } = useSchedule();

  const handleCopyLastWeek = () => {
    copyLastWeek();
    showToast('Прошлая неделя скопирована');
  };

  // Floating tab when collapsed
  if (rightPanelCollapsed) {
    return (
      <button
        onClick={toggleRightPanel}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-6 h-16 rounded-l-lg bg-white border border-l-0 shadow-sm transition-colors hover:bg-surface"
        style={{ borderColor: 'var(--line)' }}
        aria-label="Развернуть панель"
        title="Развернуть"
      >
        <svg className="h-4 w-4" style={{ color: 'var(--ink-mid)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    );
  }

  return (
    <aside
      data-testid="right-panel"
      className="fixed right-0 top-0 z-20 h-full border-l bg-white transition-all duration-200"
      style={{
        width: 'var(--right-w)',
        borderColor: 'var(--line)',
        paddingTop: 'var(--toolbar-h)',
        overflow: 'hidden',
      }}
    >
      <div className="h-full overflow-y-auto">
        {/* Header with toggle */}
        <div
          className="flex items-center justify-between px-4 py-3 text-sm font-semibold"
          style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line)' }}
        >
          <span>Инструменты</span>
          <button
            onClick={toggleRightPanel}
            className="flex items-center justify-center w-6 h-6 rounded-md bg-white/80 border border-line shadow-sm text-ink-mid transition-colors hover:bg-surface"
            aria-label="Свернуть панель"
            title="Свернуть"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Штамп Section */}
        <AccordionSection title="Штамп" contentTestId="stamp-content">
          <StampPanel />
        </AccordionSection>

        {/* Неделя Section */}
        <AccordionSection title="Неделя" contentTestId="week-content">
          <div className="space-y-2">
            <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
              Управление событиями недели
            </p>
            <button
              onClick={handleCopyLastWeek}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-surface"
              style={{ color: 'var(--ink-mid)' }}
              aria-label="Копировать прошлую неделю"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              Копировать прошлую неделю
            </button>
          </div>
        </AccordionSection>
      </div>
    </aside>
  );
}
