'use client';

import React from 'react';
import { TIME_COL_WIDTH } from '@/lib/utils';

interface ScheduleColumnHeaderProps {
  /** Sticky top offset — differs between DayView (has toolbar above) and WeekView */
  stickyTop?: string;
  /** Z-index — default 25 to layer above the time column grid */
  zIndex?: number;
  /** Column header items rendered inside the flex container */
  children: React.ReactNode;
}

/**
 * Shared sticky column header wrapper used by DayView and WeekView.
 *
 * Provides consistent styling: background, border, padding, sticky positioning.
 * Each view supplies its own column items as children.
 */
export function ScheduleColumnHeader({
  stickyTop = '0',
  zIndex = 25,
  children,
}: ScheduleColumnHeaderProps) {
  return (
    <div
      className="sticky flex bg-white border-b shrink-0"
      style={{
        top: stickyTop,
        paddingLeft: TIME_COL_WIDTH,
        borderColor: 'var(--line)',
        zIndex,
      }}
    >
      {children}
    </div>
  );
}
