'use client';

import React from 'react';
import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

interface SortableColumnHeaderProps {
  col: { id: string; name: string };
  isDropTarget: boolean;
}

/**
 * A column header wrapped with useSortable from @dnd-kit/sortable.
 * Enables drag-to-reorder columns within the unified DndContext.
 */
export function SortableColumnHeader({ col, isDropTarget }: SortableColumnHeaderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.id, data: { type: 'column', column: col }, animateLayoutChanges: defaultAnimateLayoutChanges });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    color: 'var(--ink-mid)',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`column-header-${col.id}`}
      className={`flex-1 text-center py-2 text-xs font-medium transition-all duration-150 cursor-grab select-none ${
        isDropTarget ? 'border-l-2 border-l-[var(--brand)]' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      <div className="uppercase tracking-wide flex items-center justify-center gap-1">
        <span>{col.name}</span>
      </div>
    </div>
  );
}
