'use client';

export interface RecordCommentsProps {
  value: string;
  onChange: (value: string) => void;
}

export function RecordComments({ value, onChange }: RecordCommentsProps) {
  return (
    <div data-testid="record-comments">
      <label className="text-xs font-medium text-ink-mid block mb-1">Комментарий</label>
      <textarea
        className="w-full rounded-lg border px-3 py-2 text-sm bg-white resize-y"
        style={{ borderColor: 'var(--line)' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Добавить комментарий..."
        rows={2}
        data-testid="input-comment"
      />
    </div>
  );
}
