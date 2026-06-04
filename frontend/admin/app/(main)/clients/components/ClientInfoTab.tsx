'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ClientWithStats } from '@memo/api-client';

interface ClientInfoTabProps {
  client: ClientWithStats | null;
  mode?: 'view' | 'create';
  onSave: (data: Partial<ClientWithStats>) => Promise<void>;
  onDelete?: () => void;
}

export function ClientInfoTab({ client, mode = 'view', onSave, onDelete }: ClientInfoTabProps) {
  const [name, setName] = useState(client?.name || '');
  const [phone, setPhone] = useState(client?.phone || '');
  const [email, setEmail] = useState(client?.email || '');
  const [channel, setChannel] = useState(client?.channel || '');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setName(client?.name || '');
    setPhone(client?.phone || '');
    setEmail(client?.email || '');
    setChannel(client?.channel || '');
    setHasChanges(false);
  }, [client]);

  const handleChange = useCallback(() => setHasChanges(true), []);

  const handleSave = useCallback(async () => {
    await onSave({ name, phone, email, channel });
    setHasChanges(false);
  }, [name, phone, email, channel, onSave]);

  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4">
      {/* Contact data group */}
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Контактные данные</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="client-name" className="text-xs font-medium text-ink-mid block mb-1">Имя</label>
            <input
              id="client-name"
              className={inputClass}
              style={inputStyle}
              value={name}
              onChange={e => {
                setName(e.target.value);
                handleChange();
              }}
            />
          </div>
          <div>
            <label htmlFor="client-phone" className="text-xs font-medium text-ink-mid block mb-1">Телефон</label>
            <input
              id="client-phone"
              className={inputClass}
              style={inputStyle}
              value={phone}
              onChange={e => {
                setPhone(e.target.value);
                handleChange();
              }}
            />
          </div>
          <div>
            <label htmlFor="client-channel" className="text-xs font-medium text-ink-mid block mb-1">Канал</label>
            <select
              id="client-channel"
              className={`${inputClass} appearance-none`}
              style={inputStyle}
              value={channel}
              onChange={e => {
                setChannel(e.target.value);
                handleChange();
              }}
            >
              <option value="">Не указан</option>
              <option value="telegram">Telegram</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="max">Max</option>
            </select>
          </div>
          <div>
            <label htmlFor="client-email" className="text-xs font-medium text-ink-mid block mb-1">Email</label>
            <input
              id="client-email"
              className={inputClass}
              style={inputStyle}
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                handleChange();
              }}
            />
          </div>
        </div>
      </div>

      {/* Metrics group (read-only, view mode only) */}
      {mode === 'view' && client && (
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Метрики</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-surface rounded-lg">
          <div className="text-center">
            <div className="text-lg font-semibold">{client.visits_count}</div>
            <div className="text-xs text-ink-light">Визитов</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">{client.missed_visits}</div>
            <div className="text-xs text-ink-light">Пропущено</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">
              {client.last_visit
                ? new Date(client.last_visit).toLocaleDateString('ru-RU')
                : '—'}
            </div>
            <div className="text-xs text-ink-light">Последний</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">
              {client.total_paid.toLocaleString('ru-RU')} ₽
            </div>
            <div className="text-xs text-ink-light">Оплачено</div>
          </div>
        </div>
      </div>
      )}

      {/* Dates group (read-only, view mode only) */}
      {mode === 'view' && client && (
      <div>
        <h4 className="text-xs font-medium text-ink-mid mb-2">Даты</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-ink-light">Создан: </span>
            <span className="text-sm">
              {new Date(client.created_at).toLocaleDateString('ru-RU')}
            </span>
          </div>
          <div>
            <span className="text-xs text-ink-light">Обновлён: </span>
            <span className="text-sm">
              {new Date(client.updated_at).toLocaleDateString('ru-RU')}
            </span>
          </div>
        </div>
      </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
        <button
          disabled={!hasChanges}
          onClick={handleSave}
          className="px-4 py-2 text-sm text-white rounded-lg disabled:bg-gray-300"
          style={{ backgroundColor: hasChanges ? 'var(--brand)' : undefined }}
        >
          {mode === 'create' ? 'Создать' : 'Сохранить'}
        </button>
        {mode === 'view' && onDelete && (
        <button
          onClick={onDelete}
          className="px-4 py-2 text-sm text-red-500 hover:text-red-600"
        >
          Удалить клиента
        </button>
        )}
      </div>
    </div>
  );
}
