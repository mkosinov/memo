'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Master, Location } from '@memo/domain';

// ─── Types ───────────────────────────────────────────────────────────────

interface FilterDropdownProps {
  masters: Master[];
  locations: Location[];
  selectedMasterIds: string[];
  selectedLocationIds: string[];
  onMasterSelectionChange: (ids: string[]) => void;
  onLocationSelectionChange: (ids: string[]) => void;
}

interface SpecialtyGroup {
  specialty: string;
  masters: Master[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function groupMastersBySpecialty(masters: Master[]): SpecialtyGroup[] {
  const map = new Map<string, Master[]>();
  for (const master of masters) {
    const spec = master.specialty || 'Без специальности';
    const arr = map.get(spec) || [];
    arr.push(master);
    map.set(spec, arr);
  }
  // Sort groups alphabetically by specialty
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([specialty, masters]) => ({ specialty, masters }));
}

// ─── FilterDropdown Component ────────────────────────────────────────────

export function FilterDropdown({
  masters,
  locations,
  selectedMasterIds,
  selectedLocationIds,
  onMasterSelectionChange,
  onLocationSelectionChange,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const handleToggle = useCallback(() => setIsOpen(prev => !prev), []);

  // Group masters by specialty
  const specialtyGroups = useMemo(() => groupMastersBySpecialty(masters), [masters]);

  // Master selection handlers
  const handleToggleMaster = useCallback(
    (id: string) => {
      const next = selectedMasterIds.includes(id)
        ? selectedMasterIds.filter(i => i !== id)
        : [...selectedMasterIds, id];
      onMasterSelectionChange(next);
    },
    [selectedMasterIds, onMasterSelectionChange],
  );

  const handleSelectAllMasters = useCallback(() => {
    onMasterSelectionChange(masters.map(m => m.id));
  }, [masters, onMasterSelectionChange]);

  const handleClearAllMasters = useCallback(() => {
    onMasterSelectionChange([]);
  }, [onMasterSelectionChange]);

  // Location selection handlers
  const handleToggleLocation = useCallback(
    (id: string) => {
      const next = selectedLocationIds.includes(id)
        ? selectedLocationIds.filter(i => i !== id)
        : [...selectedLocationIds, id];
      onLocationSelectionChange(next);
    },
    [selectedLocationIds, onLocationSelectionChange],
  );

  const handleSelectAllLocations = useCallback(() => {
    onLocationSelectionChange(locations.map(l => l.id));
  }, [locations, onLocationSelectionChange]);

  const handleClearAllLocations = useCallback(() => {
    onLocationSelectionChange([]);
  }, [onLocationSelectionChange]);

  // Total counts
  const totalMasters = masters.length;
  const totalLocations = locations.length;
  const selectedCount = selectedMasterIds.length + selectedLocationIds.length;
  const totalCount = totalMasters + totalLocations;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50"
        style={{
          borderColor: 'var(--line)',
          color: selectedCount > 0 ? 'var(--brand)' : 'var(--ink-mid)',
          backgroundColor: 'var(--white)',
        }}
        aria-label="Фильтры"
        aria-expanded={isOpen}
      >
        <span className="text-sm">👥</span>
        <span>
          Фильтры ({selectedCount}/{totalCount})
        </span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute z-50 mt-1 min-w-[240px] bg-white border rounded-lg shadow-lg"
          style={{ borderColor: 'var(--line, #e5e7eb)' }}
          data-testid="filter-dropdown"
        >
          {/* Masters section */}
          <div className="px-3 pt-2 pb-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                Мастера
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllMasters}
                  className="text-[10px] font-medium transition-colors hover:underline"
                  style={{ color: 'var(--brand)' }}
                >
                  Все
                </button>
                <button
                  type="button"
                  onClick={handleClearAllMasters}
                  className="text-[10px] font-medium transition-colors hover:underline"
                  style={{ color: 'var(--ink-light, #9ca3af)' }}
                >
                  Снять
                </button>
              </div>
            </div>
          </div>

          {/* Masters grouped by specialty */}
          <div className="max-h-[200px] overflow-y-auto px-3 pb-2">
            {specialtyGroups.map(group => (
              <div key={group.specialty} className="mb-2">
                <div className="text-[10px] font-medium uppercase tracking-wide py-1" style={{ color: 'var(--ink-light, #9ca3af)' }}>
                  {group.specialty}
                </div>
                <div className="space-y-0.5">
                  {group.masters.map(master => {
                    const isChecked = selectedMasterIds.includes(master.id);
                    return (
                      <button
                        key={master.id}
                        type="button"
                        onClick={() => handleToggleMaster(master.id)}
                        className="w-full flex items-center gap-2 px-2 py-1 text-left text-xs hover:bg-gray-50 transition-colors rounded"
                        data-testid={`filter-master-${master.id}`}
                      >
                        <div
                          className={`flex items-center justify-center w-3.5 h-3.5 rounded border transition-colors shrink-0 ${
                            isChecked ? 'border-[var(--brand)] bg-[var(--brand)]' : 'border-gray-300 bg-white'
                          }`}
                        >
                          {isChecked && (
                            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: master.color }}
                        />
                        <span style={{ color: 'var(--ink, #1a1a1a)' }}>{master.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {masters.length === 0 && (
              <div className="px-2 py-1 text-xs text-center" style={{ color: 'var(--ink-light, #9ca3af)' }}>
                Нет мастеров
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t" style={{ borderColor: 'var(--line, #e5e7eb)' }} />

          {/* Locations section */}
          <div className="px-3 pt-2 pb-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                Локации
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllLocations}
                  className="text-[10px] font-medium transition-colors hover:underline"
                  style={{ color: 'var(--brand)' }}
                >
                  Все
                </button>
                <button
                  type="button"
                  onClick={handleClearAllLocations}
                  className="text-[10px] font-medium transition-colors hover:underline"
                  style={{ color: 'var(--ink-light, #9ca3af)' }}
                >
                  Снять
                </button>
              </div>
            </div>
          </div>

          {/* Locations list */}
          <div className="max-h-[120px] overflow-y-auto px-3 pb-2">
            {locations.map(location => {
              const isChecked = selectedLocationIds.includes(location.id);
              return (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => handleToggleLocation(location.id)}
                  className="w-full flex items-center gap-2 px-2 py-1 text-left text-xs hover:bg-gray-50 transition-colors rounded"
                  data-testid={`filter-location-${location.id}`}
                >
                  <div
                    className={`flex items-center justify-center w-3.5 h-3.5 rounded border transition-colors shrink-0 ${
                      isChecked ? 'border-[var(--brand)] bg-[var(--brand)]' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {isChecked && (
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span style={{ color: 'var(--ink, #1a1a1a)' }}>{location.name}</span>
                </button>
              );
            })}
            {locations.length === 0 && (
              <div className="px-2 py-1 text-xs text-center" style={{ color: 'var(--ink-light, #9ca3af)' }}>
                Нет локаций
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t" style={{ borderColor: 'var(--line, #e5e7eb)' }} />

          {/* Footer actions */}
          <div className="flex items-center justify-between px-3 py-1.5">
            <button
              type="button"
              onClick={() => {
                onMasterSelectionChange(masters.map(m => m.id));
                onLocationSelectionChange(locations.map(l => l.id));
              }}
              className="text-[11px] font-medium transition-colors hover:underline"
              style={{ color: 'var(--brand)' }}
            >
              Выбрать все
            </button>
            <button
              type="button"
              onClick={() => {
                onMasterSelectionChange([]);
                onLocationSelectionChange([]);
              }}
              className="text-[11px] font-medium transition-colors hover:underline"
              style={{ color: 'var(--ink-light, #9ca3af)' }}
            >
              Снять все
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
