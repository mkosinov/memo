'use client';

import React, { useMemo, useState } from 'react';
import { getClientsPaged, getActivities } from '@memo/api-client';
import { useTagsRaw } from '@/hooks/useTags';
import RemoteSearchSelect from '@/app/components/shared/RemoteSearchSelect';
import { Combobox, type ComboboxOption } from '@/app/components/shared/Combobox';
import { usePhotosTable } from '@/contexts/PhotosContext';
import { formatActivityLabel } from '@/lib/utils';

/**
 * Photos filter bar (GH #211 Task 8) — layout modeled on BookingFilters
 * (flex-wrap, label+control markup, records-style reset button). Every control
 * change → context setFilters (page resets to 1 there); Сбросить → resetFilters.
 *
 * Controls (spec §7.3):
 *   Клиент     — RemoteSearchSelect over getClientsPaged (active clients only, §7.3)
 *   Активность — RemoteSearchSelect over getActivities; options render THE canonical
 *                label (spec §7.7) via formatActivityLabel + the context locationsMap
 *   Услуга     — Combobox over servicesMap («Все услуги» pinned clear option)
 *   Локация    — Combobox over locationsMap («Все локации»)
 *   Теги       — chips + add-typeahead over useTagsRaw() (PhotoModal multi pattern)
 */
export function PhotosFilters() {
  const { filters, setFilters, resetFilters, servicesMap, locationsMap } = usePhotosTable();

  // RemoteSearchSelect keeps its selected label in LOCAL state — a context reset
  // cannot reach it, so the reset button bumps this key to remount the two
  // typeaheads clean (chips/comboboxes are context-derived and clear on their own).
  const [resetKey, setResetKey] = useState(0);

  // Tags dictionary — /all once via useTagsRaw (#140: shared ['tags'] key,
  // 1h staleTime); client-side typeahead below.
  const { data: tags = [] } = useTagsRaw();

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

  // GH #214 Task 9 (§6 rows 13-14): the two dictionary selects become
  // Combobox — data stays the context maps' values (raw shapes, §6.2
  // haystacks). The filter state keeps its `undefined` sentinel, adapted at
  // this boundary (`?? ''` in, `v || undefined` out — spec §5 contract note).
  const serviceOptions: ComboboxOption[] = Array.from(servicesMap.values()).map((s) => ({
    value: s.id,
    label: s.title,
  }));
  const locationOptions: ComboboxOption[] = Array.from(locationsMap.values()).map((l) => ({
    value: l.id,
    label: l.name,
    searchText: `${l.name} ${l.short_title ?? ''}`.trim(),
  }));

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
  const labelStyle = { color: 'var(--ink-light)' };

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Клиент — server search, active clients only (spec §7.3) */}
      <div className="w-56">
        <RemoteSearchSelect
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
        <RemoteSearchSelect
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

      {/* Услуга — Combobox over the /services/all map (§6 row 13) */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={labelStyle}>Услуга</label>
        <Combobox
          clearLabel="Все услуги"
          value={filters.service_id ?? ''}
          options={serviceOptions}
          onChange={(v) => setFilters({ service_id: v || undefined })}
          className={selectClass}
          ariaLabel="Фильтр по услуге"
        />
      </div>

      {/* Локация — Combobox over the /locations/all map (§6 row 14) */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={labelStyle}>Локация</label>
        <Combobox
          clearLabel="Все локации"
          value={filters.location_id ?? ''}
          options={locationOptions}
          onChange={(v) => setFilters({ location_id: v || undefined })}
          className={selectClass}
          ariaLabel="Фильтр по локации"
        />
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
        <RemoteSearchSelect
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
