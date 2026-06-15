'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { reorderMasters, reorderLocations } from '@memo/api-client';

interface UseColumnReorderOptions {
  columns: ReadonlyArray<{ id: string; name: string; sortOrder?: number }>;
  columnMode: 'masters' | 'locations';
  initialOrder?: string[];
  onOrderChange?: (order: string[]) => void;
}

export function useColumnReorder({ columns, columnMode, initialOrder, onOrderChange }: UseColumnReorderOptions) {
  const [modifierHeld, setModifierHeld] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const initializedRef = useRef(false);
  const onOrderChangeRef = useRef(onOrderChange);
  onOrderChangeRef.current = onOrderChange;

  // Sync columnOrder with columns: preserve user order, insert new IDs at correct position
  useEffect(() => {
    if (columns.length === 0) return;
    
    if (!initializedRef.current) {
      // First time: use initialOrder if provided (non-empty), otherwise sort by sortOrder
      if (initialOrder && initialOrder.length > 0) {
        // Filter initialOrder to only include IDs that exist in columns
        const columnIds = new Set(columns.map((c) => c.id));
        const validOrder = initialOrder.filter((id) => columnIds.has(id));
        if (validOrder.length > 0) {
          setColumnOrder(validOrder);
        } else {
          const sorted = [...columns].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          setColumnOrder(sorted.map((c) => c.id));
        }
      } else {
        const sorted = [...columns].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        setColumnOrder(sorted.map((c) => c.id));
      }
      initializedRef.current = true;
      return;
    }
    
    // Subsequent updates: preserve user order, insert new IDs at their position from columns
    // NOTE: We do NOT remove IDs that are missing from columns — they're just filtered out
    // and will reappear at their original position when re-added. The orderedColumns memo
    // handles display filtering by only returning IDs present in both columnOrder and columns.
    setColumnOrder((prev) => {
      // Find new IDs that need to be added
      const existingIds = new Set(prev);
      const newIds = columns.filter((c) => !existingIds.has(c.id)).map((c) => c.id);
      
      if (newIds.length === 0) {
        return prev;
      }
      
      // Insert new IDs at their position relative to existing IDs
      // Strategy: for each new ID, find its position in columns array,
      // then find where it should be inserted based on neighbors
      const newIdSet = new Set(newIds);
      const result: string[] = [...prev];
      
      // Process new IDs in reverse order of their position in columns
      // (so earlier positions don't shift later insertions)
      for (let i = columns.length - 1; i >= 0; i--) {
        const col = columns[i];
        if (!newIdSet.has(col.id)) continue;
        
        // Find the next existing ID after this new ID in columns array
        let insertBeforeId: string | null = null;
        for (let j = i + 1; j < columns.length; j++) {
          if (!newIdSet.has(columns[j].id) && existingIds.has(columns[j].id)) {
            insertBeforeId = columns[j].id;
            break;
          }
        }
        
        if (insertBeforeId) {
          // Insert before this existing ID
          const idx = result.indexOf(insertBeforeId);
          if (idx !== -1) {
            result.splice(idx, 0, col.id);
          } else {
            // Existing ID not found, add at end
            result.push(col.id);
          }
        } else {
          // No existing ID after this new ID, add at end
          result.push(col.id);
        }
      }
      
      return result;
    });
  }, [columns]);

  // Notify parent of order changes (after every state update to columnOrder)
  useEffect(() => {
    if (columnOrder.length > 0 && onOrderChangeRef.current) {
      onOrderChangeRef.current(columnOrder);
    }
  }, [columnOrder]);

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
    // Return columns in order, filtering out any that are no longer in columns list
    return columnOrder
      .map((id) => byId.get(id))
      .filter(Boolean) as typeof columns;
  }, [columns, columnOrder]);

  return {
    modifierHeld,
    columnOrder,
    orderedColumns,
    onColumnDrop,
  };
}
