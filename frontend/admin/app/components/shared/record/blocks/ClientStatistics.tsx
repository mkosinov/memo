'use client';

export interface ClientStatisticsStats {
  recordsCount?: number;
  missedRecords?: number;
  lastRecord?: string | null;
  totalPaid?: number;
}

export interface ClientStatisticsProps {
  /** Aggregated client stats. When omitted, all cells show "—". */
  stats?: ClientStatisticsStats;
}

export function ClientStatistics({ stats }: ClientStatisticsProps) {
  return (
    <div data-testid="client-statistics">
      <h4 className="text-xs font-medium text-ink-mid mb-2">Статистика</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-lg border" style={{ borderColor: 'var(--line)' }}>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {stats?.recordsCount ?? '—'}
          </div>
          <div className="text-xs text-ink-light">Записей</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {stats?.missedRecords ?? '—'}
          </div>
          <div className="text-xs text-ink-light">Пропущено</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {stats?.lastRecord
              ? new Date(stats.lastRecord).toLocaleDateString('ru-RU')
              : '—'}
          </div>
          <div className="text-xs text-ink-light">Последняя</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {stats?.totalPaid != null
              ? `${stats.totalPaid.toLocaleString('ru-RU')} ₽`
              : '—'}
          </div>
          <div className="text-xs text-ink-light">Оплачено</div>
        </div>
      </div>
    </div>
  );
}
