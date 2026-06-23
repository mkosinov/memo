'use client';

export interface RecordTimestampsProps {
  createdAt: string;
  updatedAt: string;
}

export function RecordTimestamps({ createdAt, updatedAt }: RecordTimestampsProps) {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="flex items-center gap-2 text-xs text-ink-light" data-testid="record-timestamps">
      <span>Создан: {fmt(createdAt)}</span>
      <span className="text-ink-faint">|</span>
      <span>Обновлён: {fmt(updatedAt)}</span>
    </div>
  );
}
