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
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

/**
 * A column header wrapped with useSortable from @dnd-kit/sortable.
 * Enables drag-to-reorder columns within the unified DndContext.
 */
export function SortableColumnHeader({
  col,
  isDropTarget,
  onMoveLeft,
  onMoveRight,
  isFirst,
  isLast,
}: SortableColumnHeaderProps) {
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
      className={`flex-1 text-center py-2 text-xs font-medium transition-all duration-150 cursor-grab select-none relative group ${
        isDragging ? 'z-50' : ''
      } ${isDropTarget ? 'border-l-2 border-l-[var(--brand)]' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="uppercase tracking-wide flex items-center justify-center gap-1">
        {/* Move left arrow */}
        {!isFirst && onMoveLeft && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveLeft(); }}
            data-testid={`move-left-${col.id}`}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/5"
            title="Переместить влево"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <span>{col.name}</span>
        {/* Move right arrow */}
        {!isLast && onMoveRight && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveRight(); }}
            data-testid={`move-right-${col.id}`}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/5"
            title="Переместить вправо"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
