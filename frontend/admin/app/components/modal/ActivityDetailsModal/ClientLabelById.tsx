'use client';

import { useClient } from '@/hooks/useClient';
import { formatPhoneDisplay } from '@/app/components/shared/phone/format';

/**
 * Progressive client label for a record tab (spec §5.4, GH #140 US-2).
 *
 * Each record tab mounts its own `useClient(record.client_id)` observer, so
 * every tab — not just the active one — resolves its client (the old paged-map
 * lookup missed clients beyond the first page → «Без контакта»). Shared
 * `['client', id]` key dedupes across tabs of the same client and with
 * ClientQuickCard.
 *
 * States: «…» while pending → name (+phone secondary line) once resolved;
 * «Без контакта» ONLY on error OR an anonymous record (no client_id).
 */
export function ClientLabelById({ clientId }: { clientId: string | undefined }) {
  const { data, isPending, isError } = useClient(clientId);

  if (!clientId || isError) {
    return (
      <div className="flex flex-col min-w-0">
        <span className="truncate">Без контакта</span>
      </div>
    );
  }

  if (isPending || !data) {
    return (
      <div className="flex flex-col min-w-0">
        <span className="truncate">…</span>
      </div>
    );
  }

  const name = data.name?.trim();
  // GH #414 (spec §Форматирование, показ): the phone renders through the
  // shared display formatter — legacy spellings group like compacts, garbage
  // passes through verbatim. Whitespace-only stays «no phone» as before.
  const rawPhone = data.phone?.trim();
  const phone = rawPhone ? formatPhoneDisplay(rawPhone) : '';
  return (
    <div className="flex flex-col min-w-0">
      <span className="truncate">{name || phone || 'Дорогой гость'}</span>
      {phone && <span className="text-xs text-ink-light truncate">{phone}</span>}
    </div>
  );
}