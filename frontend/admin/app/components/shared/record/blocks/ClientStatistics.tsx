'use client';

export interface ClientStatisticsStats {
  visitsCount?: number;
  missedVisits?: number;
  lastVisit?: string | null;
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-surface rounded-lg">
        <div className="text-center">
          <div className="text-lg font-semibold">
            {stats?.visitsCount ?? '—'}
          </div>
          <div className="text-xs text-ink-light">Визитов</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {stats?.missedVisits ?? '—'}
          </div>
          <div className="text-xs text-ink-light">Пропущено</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold">
            {stats?.lastVisit
              ? new Date(stats.lastVisit).toLocaleDateString('ru-RU')
              : '—'}
          </div>
          <div className="text-xs text-ink-light">Последний</div>
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
