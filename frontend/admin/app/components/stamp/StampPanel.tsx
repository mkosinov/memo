'use client';

import React from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView } from '@/contexts/schedule/ScheduleViewContext';
import { useUI } from '@/contexts/UIContext';
import { MasterPicker } from '@/app/components/shared/MasterPicker';
import { Combobox } from '@/app/components/shared/Combobox';

export function StampPanel() {
  const { masters, services, locations: studios } = useScheduleData();
  const { stamp, setStamp } = useScheduleView();
  const { deleteMode, toggleDeleteMode } = useUI();

  const selectedMaster = stamp.masterId
    ? masters.find((a) => a.id === stamp.masterId)
    : null;
  const selectedService = stamp.serviceId
    ? services.find((s) => s.id === stamp.serviceId)
    : null;
  const selectedLocations = studios.filter((s) => stamp.locations.has(s.id));

  const handleMasterChange = (v: string) => {
    const masterId = v !== '' ? v : null;
    setStamp((prev) => ({
      ...prev,
      masterId,
      ready:
        !!masterId && !!prev.serviceId && prev.locations.size > 0,
    }));
  };

  const handleServiceChange = (v: string) => {
    const serviceId = v !== '' ? v : null;
    setStamp((prev) => ({
      ...prev,
      serviceId,
      ready:
        !!prev.masterId && !!serviceId && prev.locations.size > 0,
    }));
  };

  const handleLocationToggle = (studioId: string) => {
    setStamp((prev) => {
      const newLocations = new Set(prev.locations);
      if (newLocations.has(studioId)) {
        newLocations.delete(studioId);
      } else {
        newLocations.add(studioId);
      }
      return {
        ...prev,
        locations: newLocations,
        ready:
          !!prev.masterId && !!prev.serviceId && newLocations.size > 0,
      };
    });
  };

  return (
    <div className="space-y-3">
      {/* Ready indicator */}
      <div
        data-testid="ready-indicator"
        data-ready={stamp.ready}
        className="flex items-center gap-2"
      >
        <div
          className={`h-2 w-2 rounded-full ${
            stamp.ready
              ? 'bg-green-500 animate-pulse'
              : 'bg-ink-faint'
          }`}
        />
        <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
          {stamp.ready
            ? 'Готов к созданию'
            : 'Выберите мастера, услугу и локации'}
        </span>
      </div>

      {/* Master picker */}
      <div data-testid="stamp-master-picker">
        <label
          className="mb-1 block text-xs font-medium"
          style={{ color: 'var(--ink-mid)' }}
        >
          Мастер
        </label>
        <MasterPicker
          masters={masters}
          value={stamp.masterId ?? ''}
          onChange={handleMasterChange}
          className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
          ariaLabel="Мастер"
        />
      </div>

      {/* Service picker */}
      <div>
        <label
          className="mb-1 block text-xs font-medium"
          style={{ color: 'var(--ink-mid)' }}
        >
          Услуга
        </label>
        <Combobox
          clearLabel="Выберите услугу"
          value={stamp.serviceId ?? ''}
          options={services.map((s) => ({ value: s.id, label: s.name }))}
          onChange={handleServiceChange}
          className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
          ariaLabel="Услуга"
        />
      </div>

      {/* Location checkboxes */}
      <div>
        <label
          className="mb-1 block text-xs font-medium"
          style={{ color: 'var(--ink-mid)' }}
        >
          Локации
        </label>
        <div className="space-y-1">
          {studios.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--ink)' }}
            >
              <input
                type="checkbox"
                checked={stamp.locations.has(s.id)}
                onChange={() => handleLocationToggle(s.id)}
                className="rounded"
              />
              {s.emoji} {s.name}
            </label>
          ))}
        </div>
      </div>

      {/* Summary */}
      {stamp.ready && (
        <div
          data-testid="stamp-summary"
          className="rounded-lg bg-surface p-2 text-xs"
          style={{ color: 'var(--ink-light)' }}
        >
          {selectedMaster?.shortName} — {selectedService?.name}
          {selectedLocations.length > 0 && (
            <> — {selectedLocations.map((l) => l.name).join(', ')}</>
          )}
        </div>
      )}

      {/* Delete mode toggle */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={toggleDeleteMode}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            deleteMode
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'text-ink-mid hover:bg-surface'
          }`}
          aria-label="Режим удаления"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Режим удаления
        </button>
      </div>
    </div>
  );
}
