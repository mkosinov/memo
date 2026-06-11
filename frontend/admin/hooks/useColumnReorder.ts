'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { reorderMasters, reorderLocations } from '@memo/api-client';

interface UseColumnReorderOptions {
  columns: ReadonlyArray<{ id: string; name: string; sortOrder?: number }>;
  columnMode: 'masters' | 'locations';
}

export function useColumnReorder({ columns, columnMode }: UseColumnReorderOptions) {
  const [modifierHeld, setModifierHeld] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);

  // Initialize column order from columns sorted by sortOrder
  useEffect(() => {
    const sorted = [...columns].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    setColumnOrder(sorted.map((c) => c.id));
  }, [columns]);

  // Track Cmd/Alt modifier
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey) setModifierHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.altKey) setModifierHeld(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const onColumnDrop = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;

      setColumnOrder((prev) => {
        const newOrder = [...prev];
        const dragIdx = newOrder.indexOf(draggedId);
        const targetIdx = newOrder.indexOf(targetId);

        if (dragIdx === -1 || targetIdx === -1) return prev;

        // Remove dragged item and insert before target
        newOrder.splice(dragIdx, 1);
        const newTargetIdx = newOrder.indexOf(targetId);
        newOrder.splice(newTargetIdx, 0, draggedId);

        // Persist to backend
        const reorderFn = columnMode === 'masters' ? reorderMasters : reorderLocations;
        reorderFn(newOrder).catch(console.error);

        return newOrder;
      });
    },
    [columnMode],
  );

  const orderedColumns = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; sortOrder?: number }>(
      columns.map((c) => [c.id, c]),
    );
    return columnOrder.map((id) => byId.get(id)!).filter(Boolean) as typeof columns;
  }, [columns, columnOrder]);

  return {
    modifierHeld,
    columnOrder,
    orderedColumns,
    onColumnDrop,
  };
}
