'use client';

import { useState } from 'react';
import type { TariffResponse } from '@memo/api-client';
import { VisitorRow, type VisitorRowVisit } from './VisitorRow';
import { resolveDefaultTariff } from '@/lib/tariff-resolver';

export interface AddVisitorPayload {
  name: string;
  age: number | null;
  tariff_id: string;
}

export interface AddVisitorFormProps {
  tariffs: TariffResponse[];
  isReadOnly?: boolean;
  onAdd: (visit: AddVisitorPayload) => void;
  onCancel: () => void;
}

export function AddVisitorForm({ tariffs, isReadOnly, onAdd, onCancel }: AddVisitorFormProps) {
  const [name, setName] = useState('');
  const [age, setAge] = useState<number | ''>('');
  // GH #284: the single resolver owns the initial default (empty age → adult side).
  const [tariffId, setTariffId] = useState(resolveDefaultTariff(tariffs, null)?.id ?? '');

  function handleAgeChange(raw: string) {
    setAge(raw === '' ? '' : Number(raw));
    // Spec §2.5: ANY age change re-substitutes the tariff via the resolver —
    // a manual pick is clobbered by design (owner decision, no undo).
    setTariffId(resolveDefaultTariff(tariffs, raw === '' ? null : Number(raw))?.id ?? '');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      age: age === '' ? null : age,
      tariff_id: tariffId,
    });
  }

  const preview: VisitorRowVisit | null = name.trim()
    ? {
        id: 'preview',
        name: name.trim(),
        age: age === '' ? null : age,
        tariff_id: tariffId || null,
        status: 'waiting',
      }
    : null;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 border-t border-gray-200 pt-2"
      data-testid="add-visitor-form"
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя"
          disabled={isReadOnly}
          className="flex-1 rounded border px-2 py-1 text-sm"
          data-testid="add-visitor-name"
        />
        <input
          type="number"
          value={age}
          onChange={(e) => handleAgeChange(e.target.value)}
          placeholder="Возраст"
          disabled={isReadOnly}
          className="w-16 rounded border px-2 py-1 text-sm"
          data-testid="add-visitor-age"
        />
        <select
          value={tariffId}
          onChange={(e) => setTariffId(e.target.value)}
          disabled={isReadOnly}
          className="rounded border px-2 py-1 text-sm"
          data-testid="add-visitor-tariff"
        >
          {tariffs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} {t.price.toLocaleString('ru-RU')}₽
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isReadOnly || !name.trim()}
          className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
          data-testid="add-visitor-submit"
        >
          Добавить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-600 hover:text-gray-800"
        >
          Отмена
        </button>
      </div>
      {preview && <VisitorRow visit={preview} tariffs={tariffs} />}
    </form>
  );
}
