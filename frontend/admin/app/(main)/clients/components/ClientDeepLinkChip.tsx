'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { buildUrlWithoutClientId } from '@/lib/client-id-param';

export interface ClientDeepLinkChipProps {
  /**
   * Valid deep-link ids currently in the address (#232 §3.3 — parsed by
   * `parseClientIds`). The chip renders only for a non-empty list; the ids
   * themselves are never shown (no UUIDs, no client names — the rows are
   * visible in the narrowed table, and vanished names have none).
   */
  clientIds: string[];
}

/**
 * #232 §3.5 — narrowing chip: the visible affordance for an active deep-link
 * narrowing («Открыт по ссылке» / «Открыто по ссылке: N») and its removal.
 *
 * The ✕ does exactly ONE thing: removes every `clientId` occurrence from the
 * address (`URLSearchParams.delete` → `router.replace(..., { scroll: false })`),
 * preserving all other query params. The Task 4 sync effect then converges the
 * `clientIds` machine filter — this component deliberately holds NO
 * `setFilters` (the address stays the single writer) and is not a
 * ClientsContext consumer at all.
 */
export function ClientDeepLinkChip({ clientIds }: ClientDeepLinkChipProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const removeNarrowing = useCallback(() => {
    router.replace(buildUrlWithoutClientId(searchParams, pathname), { scroll: false });
  }, [router, pathname, searchParams]);

  const label = clientIds.length === 1 ? 'Открыт по ссылке' : `Открыто по ссылке: ${clientIds.length}`;

  return (
    <div
      className="inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-xs"
      style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)', color: 'var(--ink-mid)' }}
      data-testid="client-deeplink-chip"
    >
      <span aria-live="polite">{label}</span>
      <button
        type="button"
        aria-label="Снять сужение"
        onClick={removeNarrowing}
        className="flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none transition-colors hover:bg-card hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        title="Снять сужение"
      >
        ✕
      </button>
    </div>
  );
}
