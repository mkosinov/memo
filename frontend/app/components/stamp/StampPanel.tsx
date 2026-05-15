'use client';

import React from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';

export function StampPanel() {
  const { artists, services, studios, stamp, setStamp } = useSchedule();

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
              : 'bg-gray-300'
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
          className="rounded-lg bg-gray-50 p-2 text-xs"
          style={{ color: 'var(--ink-light)' }}
        >
          {selectedMaster?.shortName} — {selectedService?.name}
          {selectedLocations.length > 0 && (
            <> — {selectedLocations.map((l) => l.name).join(', ')}</>
          )}
        </div>
      )}
    </div>
  );
}
