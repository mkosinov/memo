'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getClientsPaged, getActivities, getAllTags } from '@memo/api-client';
import type { TagResponse } from '@memo/api-client';
import SearchableSelect from '@/app/components/shared/SearchableSelect';
import { usePhotosTable } from '@/contexts/PhotosContext';
import { formatActivityLabel } from '@/lib/utils';

/**
 * Photos filter bar (GH #211 Task 8) — layout modeled on BookingFilters
 * (flex-wrap, label+control markup, records-style reset button). Every control
 * change → context setFilters (page resets to 1 there); Сбросить → resetFilters.
 *
 * Controls (spec §7.3):
 *   Клиент     — SearchableSelect over getClientsPaged (active clients only, §7.3)
 *   Активность — SearchableSelect over getActivities; options render THE canonical
 *                label (spec §7.7) via formatActivityLabel + the context locationsMap
 *   Услуга     — plain <select> over servicesMap («Все услуги» empty option)
 *   Локация    — plain <select> over locationsMap («Все локации»)
 *   Теги       — chips + add-typeahead over getAllTags() (PhotoModal multi pattern)
 */
export function PhotosFilters() {
  const { filters, setFilters, resetFilters, servicesMap, locationsMap } = usePhotosTable();

  // SearchableSelect keeps its selected label in LOCAL state — a context reset
  // cannot reach it, so the reset button bumps this key to remount the two
  // typeaheads clean (chips/selects are context-derived and clear on their own).
  const [resetKey, setResetKey] = useState(0);

  // Tags dictionary — /all once (same staleTime: Infinity pattern as the
  // context's services/locations dictionaries); client-side typeahead below.
  const { data: tags = [] } = useQuery<TagResponse[]>({
    queryKey: ['tags'],
    queryFn: () => getAllTags(),
    staleTime: Infinity,
  });

  const tagTitleById = useMemo(() => {
    const map = new Map<string, string>();
    tags.forEach((t) => map.set(t.id, t.tag));
    return map;
  }, [tags]);

  // formatActivityLabel's contract is Map<string, { title }> — adapt the
  // context's LocationResponse map (locations carry `name`, not `title`).
  const locationTitleMap = useMemo(() => {
    const map = new Map<string, { title: string }>();
    locationsMap.forEach((l, id) => map.set(id, { title: l.name }));
    return map;
  }, [locationsMap]);

  const handleReset = () => {
    resetFilters();
    setResetKey((k) => k + 1);
  };

  const addTag = (id: string) => {
    if (filters.tag_id.includes(id)) return;
    setFilters({ tag_id: [...filters.tag_id, id] });
  };

  const removeTag = (id: string) => {
    setFilters({ tag_id: filters.tag_id.filter((t) => t !== id) });
  };

  const selectClass = 'rounded-lg border px-2 py-1.5 text-xs';
  const selectStyle = { borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' };
  const labelStyle = { color: 'var(--ink-light)' };

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Клиент — server search, active clients only (spec §7.3) */}
      <div className="w-56">
        <SearchableSelect
          key={`client-${resetKey}`}
          value={filters.client_id ?? null}
          onChange={(uuid) => setFilters({ client_id: uuid ?? undefined })}
          onSearch={(q) =>
            getClientsPaged({ q, per_page: 10, status: 'active' }).then((r) =>
              r.items.map((c) => ({ ...c, name: c.name || 'Дорогой гость' })),
            )
          }
          label="Клиент"
          displayField="name"
          placeholder="Введите имя клиента..."
        />
      </div>

      {/* Активность — options via the canonical label (spec §7.7) */}
      <div className="w-56">
        <SearchableSelect
          key={`activity-${resetKey}`}
          value={filters.activity_id ?? null}
          onChange={(uuid) => setFilters({ activity_id: uuid ?? undefined })}
          onSearch={(q) =>
            getActivities({ q, per_page: 10 }).then((r) =>
              r.items.map((a) => ({ ...a, label: formatActivityLabel(a, locationTitleMap) })),
            )
          }
          label="Активность"
          displayField="label"
          placeholder="Введите для поиска..."
        />
      </div>

      {/* Услуга — plain select over the /services/all map */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={labelStyle}>Услуга</label>
        <select
          value={filters.service_id ?? ''}
          onChange={(e) => setFilters({ service_id: e.target.value || undefined })}
          className={selectClass}
          style={selectStyle}
          aria-label="Фильтр по услуге"
        >
          <option value="">Все услуги</option>
          {Array.from(servicesMap.values()).map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      </div>

      {/* Локация — plain select over the /locations/all map */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={labelStyle}>Локация</label>
        <select
          value={filters.location_id ?? ''}
          onChange={(e) => setFilters({ location_id: e.target.value || undefined })}
          className={selectClass}
          style={selectStyle}
          aria-label="Фильтр по локации"
        >
          <option value="">Все локации</option>
          {Array.from(locationsMap.values()).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      {/* Теги — chips + add-typeahead (PhotoModal.tsx multi-emulation pattern) */}
      <div className="flex flex-col gap-1 w-56">
        <label className="text-xs font-medium" style={labelStyle}>Теги</label>
        {filters.tag_id.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {filters.tag_id.map((id) => {
              const title = tagTitleById.get(id) ?? id;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800"
                >
                  {title}
                  <button
                    type="button"
                    onClick={() => removeTag(id)}
                    className="hover:text-blue-600"
                    aria-label={`Удалить тег ${title}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <SearchableSelect
          value={null}
          onChange={() => {}}
          onSelectItem={(item) => addTag(item.id)}
          onSearch={async (q) => {
            const lower = q.toLowerCase();
            return tags.filter((t) => t.tag.toLowerCase().includes(lower));
          }}
          label=""
          displayField="tag"
          placeholder="Добавить тег..."
        />
      </div>

      {/* Сбросить — records' reset button style (BookingFilters) */}
      <button
        onClick={handleReset}
        className="px-3 py-1.5 text-xs font-medium transition-colors rounded-lg"
        style={{ color: 'var(--brand)', border: '1px solid var(--brand)' }}
      >
        Сбросить
      </button>
    </div>
  );
}
