'use client';

import type { StaffResponse } from '@memo/api-client';
import type { ColumnDef, RowAction } from '@/app/components/shared/tableTypes';
import { displayMasterName } from '@/lib/utils';

/**
 * Columns config for the Staff table (GH #266 «Сотрудники»).
 *
 * Columns: имя, должности, специальность, цвет, архив (+ hidden avatar).
 * Sorting follows the backend whitelist (name, specialty, color, avatar,
 * status) — `positions` is EXCLUDED (M2M, server-side sort is ambiguous,
 * spec «API»/«List contract»), so that column renders a plain label.
 *
 * Specialty + color read from the optional master section (D5): a card
 * without one shows an em-dash in both. `positionTitle` maps position ids to
 * dictionary titles (D4); unknown ids fall back to the raw id.
 */
export const staffColumns = (
  positionTitle: (id: string) => string,
): ColumnDef<StaffResponse>[] => [
  {
    key: 'name',
    label: 'Имя',
    width: 'flex-1',
    defaultVisible: true,
    render: (s) => <span className="font-medium">{displayMasterName(s)}</span>,
  },
  {
    key: 'positions',
    label: 'Должности',
    width: 'w-[180px]',
    defaultVisible: true,
    // NOT sortable — the backend /staff sort whitelist excludes `position`
    // (M2M ambiguity). A non-sortable column renders a plain <th> label.
    sortable: false,
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>
        {s.position_ids.length > 0
          ? s.position_ids.map(positionTitle).join(', ')
          : '—'}
      </span>
    ),
  },
  {
    key: 'specialty',
    label: 'Специальность',
    width: 'w-[150px]',
    defaultVisible: true,
    // The master section is optional — no section → em-dash (S1: a СММ card).
    render: (s) => (
      <span style={{ color: 'var(--ink-mid)' }}>{s.master?.specialty ?? '—'}</span>
    ),
  },
  {
    key: 'color',
    label: 'Цвет',
    width: 'w-[80px]',
    defaultVisible: true,
    render: (s) =>
      s.master ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: s.master.color }} />
          <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
            {s.master.color}
          </span>
        </div>
      ) : (
        <span style={{ color: 'var(--ink-light)' }}>—</span>
      ),
  },
  {
    key: 'avatar',
    label: 'Аватар',
    width: 'w-[60px]',
    defaultVisible: false,
    render: (s) =>
      s.avatar_url ? (
        <img src={s.avatar_url} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
      ) : (
        <span style={{ color: 'var(--ink-light)' }}>—</span>
      ),
  },
  {
    key: 'status',
    label: 'Архив',
    width: 'w-[100px]',
    defaultVisible: true,
    // Badge driven by the inverted `archived` field (#207).
    render: (s) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          s.archived ? 'bg-gray-100 text-gray-500' : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {s.archived ? 'Архив' : 'Активен'}
      </span>
    ),
  },
];

/**
 * Action config factory (§6.3). The person archive/restore toggle uses the
 * #266 terminology «Архивировать / Вернуть из архива» (D2/D11). Archive is
 * NOT a one-click toggle here — it opens the D6 dismissal dialog (checkboxes
 * for the master section + account), so the callback opens the dialog rather
 * than firing the mutation directly. Then danger "Удалить" (GH #207 dry-run).
 */
export const staffActions = (cbs: {
  onArchive: (s: StaffResponse) => void;
  onRestore: (s: StaffResponse) => void;
  onDelete: (s: StaffResponse) => void;
}): ((row: StaffResponse) => RowAction<StaffResponse>[]) => {
  return (row: StaffResponse): RowAction<StaffResponse>[] => [
    row.archived
      ? { label: 'Вернуть из архива', onClick: () => cbs.onRestore(row) }
      : { label: 'Архивировать', onClick: () => cbs.onArchive(row) },
    { label: 'Удалить', danger: true, onClick: () => cbs.onDelete(row) },
  ];
};
