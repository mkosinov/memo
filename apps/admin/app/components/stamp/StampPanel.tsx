'use client';

import React from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';

export function StampPanel() {
  const { artists, services, studios, stamp, setStamp } = useSchedule();
  const { deleteMode, toggleDeleteMode } = useUI();

  const selectedMaster = stamp.masterId
    ? artists.find((a) => a.id === stamp.masterId)
    : null;
  const selectedService = stamp.serviceId
    ? services.find((s) => s.id === stamp.serviceId)
    : null;
  const selectedLocations = studios.filter((s) => stamp.locations.has(s.id));

  const handleMasterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const masterId = e.target.value || null;
    setStamp({
      ...stamp,
      masterId,
      ready:
        !!masterId && !!stamp.serviceId && stamp.locations.size > 0,
    });
  };

  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const serviceId = e.target.value || null;
    setStamp({
      ...stamp,
      serviceId,
      ready:
        !!stamp.masterId && !!serviceId && stamp.locations.size > 0,
    });
  };

  const handleLocationToggle = (studioId: string) => {
    const newLocations = new Set(stamp.locations);
    if (newLocations.has(studioId)) {
      newLocations.delete(studioId);
    } else {
      newLocations.add(studioId);
    }
    setStamp({
      ...stamp,
      locations: newLocations,
      ready:
        !!stamp.masterId && !!stamp.serviceId && newLocations.size > 0,
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

      {/* Master dropdown */}
      <div>
        <label
          htmlFor="stamp-master"
          className="mb-1 block text-xs font-medium"
          style={{ color: 'var(--ink-mid)' }}
        >
          Мастер
        </label>
        <select
          id="stamp-master"
          aria-label="Мастер"
          className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          value={stamp.masterId || ''}
          onChange={handleMasterChange}
        >
          <option value="">Выберите мастера</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.shortName}
            </option>
          ))}
        </select>
      </div>

      {/* Service dropdown */}
      <div>
        <label
          htmlFor="stamp-service"
          className="mb-1 block text-xs font-medium"
          style={{ color: 'var(--ink-mid)' }}
        >
          Услуга
        </label>
        <select
          id="stamp-service"
          aria-label="Услуга"
          className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          value={stamp.serviceId || ''}
          onChange={handleServiceChange}
        >
          <option value="">Выберите услугу</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
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
