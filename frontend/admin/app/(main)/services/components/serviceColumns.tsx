'use client';

import type { ServiceResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';

// ─── Helpers (verbatim from the pre-#139 ServicesTable) ────────────────────

function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

function minTariffPrice(service: ServiceResponse): number | null {
  if (service.tariffs.length === 0) return null;
  return Math.min(...service.tariffs.map((t) => t.price));
}

function tariffLabel(count: number): string {
  if (count === 0) return '—';
  if (count === 1) return '1 тариф';
  if (count < 5) return `${count} тарифа`;
  return `${count} тарифов`;
}

/**
 * Columns config for the Services table (#139 T5). Extracted VERBATIM from
 * the pre-#139 ServicesTable ALL_COLUMNS + cell JSX. Keys match the backend
 * services sort whitelist (domain-rules/services.md §"List contract (GH #205)":
 * title, duration, age, tariffs, specialty, archived, created_at); `age` and
 * `tariffs` pass through AS-IS — the backend maps age→min_age and tariffs→
 * count subquery — so NO `sortField` anywhere. `tags` and `materials` (GH
 * #223 badges column) have no whitelist mapping → `sortable: false` (§6.2).
 * The `material_hint` column was removed by GH #223 Task 13 (spec §10).
 */
export const serviceColumns = (): ColumnDef<ServiceResponse>[] => [
  {
    key: 'title',
    label: 'Название',
    defaultVisible: true,
    render: (s) => (
      <span className="font-medium" style={{ color: 'var(--ink)' }}>
        {s.title}
      </span>
    ),
  },
  {
    key: 'duration',
    label: 'Длительность',
    defaultVisible: true,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.duration} мин</span>
    ),
  },
  {
    key: 'age',
    label: 'Возраст',
    defaultVisible: true,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {s.min_age}–{s.max_age}
      </span>
    ),
  },
  {
    key: 'materials',
    label: 'Материалы',
    defaultVisible: true,
    sortable: false, // no server sort key — backend whitelist has no materials mapping (GH #223)
    // Compact chips with material TITLES only — the note ?? description
    // fallback governs the web materials text block, NOT badges (GH #223
    // spec §8). Empty → em dash.
    render: (s) =>
      s.materials.length > 0 ? (
        <span className="inline-flex flex-wrap gap-1">
          {s.materials.map((m) => (
            <span
              key={m.id}
              data-testid="material-badge"
              className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: 'var(--surface)', color: 'var(--ink-mid)' }}
            >
              {m.title}
            </span>
          ))}
        </span>
      ) : (
        <span style={{ color: 'var(--ink-mid)' }}>—</span>
      ),
  },
  {
    key: 'tariffs',
    label: 'Тарифы',
    defaultVisible: true,
    render: (s) => {
      const min = minTariffPrice(s);
      return (
        <span style={{ color: 'var(--ink-mid)' }}>
          {tariffLabel(s.tariffs.length)}
          {min !== null && (
            <span className="ml-1 text-xs" style={{ color: 'var(--ink-light)' }}>
              от {formatPrice(min)}
            </span>
          )}
        </span>
      );
    },
  },
  {
    key: 'specialty',
    label: 'Специализация',
    defaultVisible: false,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.specialty || '—'}</span>
    ),
  },
  {
    key: 'tags',
    label: 'Теги',
    defaultVisible: false,
    sortable: false, // no server sort key — backend whitelist has no tags mapping (#205 Task 3)
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {s.tags.length > 0 ? s.tags.map((t) => t.tag).join(', ') : '—'}
      </span>
    ),
  },
  {
    key: 'archived',
    label: 'Статус',
    defaultVisible: false,
    render: (s) => (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium"
        style={{
          backgroundColor: !s.archived ? 'var(--success-bg, #dcfce7)' : 'var(--surface)',
          color: !s.archived ? 'var(--success, #16a34a)' : 'var(--ink-light)',
        }}
      >
        {s.archived ? 'Архив' : 'Активна'}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Создана',
    defaultVisible: false,
    render: (s) => (
      <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
        {new Date(s.created_at).toLocaleDateString('ru-RU')}
      </span>
    ),
  },
];

/**
 * Action config factory (§6.3). Callbacks are captured by the parent wrapper
 * (§6.15: wrapper useMemo's the output); the parent owns the edit modal and
 * the 409 dry-run → DeleteDialog flow (§6.9). Menu items mirror the pre-#139
 * dropdown: archive/restore toggle label driven by the inverted `archived`
 * field (#207 §7.2), then danger "Удалить".
 */
export const serviceActions = (cbs: {
  onToggleArchive: (s: ServiceResponse) => void;
  onDelete: (s: ServiceResponse) => void;
}): ((row: ServiceResponse) => RowAction<ServiceResponse>[]) => {
  return (row: ServiceResponse): RowAction<ServiceResponse>[] => [
    { label: row.archived ? 'Восстановить' : 'В архив', onClick: () => cbs.onToggleArchive(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
