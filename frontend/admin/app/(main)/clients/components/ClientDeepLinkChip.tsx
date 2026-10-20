'use client';

import { useCallback } from 'react';
import { buildUrlWithoutClientId } from '@/lib/client-id-param';
import { usePathname, useSearchParams } from 'next/navigation';

export interface ClientDeepLinkChipProps {
  /**
   * Valid deep-link ids currently in the address (#232 §3.3 — parsed by
   * `parseClientIds`). The chip renders only for a non-empty list; the ids
   * themselves are never shown (no UUIDs — the rows are visible in the
   * narrowed table, and vanished names have none).
   */
  clientIds: string[];
  /**
   * #412 US-4 (spec §3.2): display name of the single narrowed client,
   * resolved by the page from the narrowed rows — substituted into the ✕
   * accessible name («Убрать фильтр по клиенту: <имя>»). Null for a dead
   * link (rows empty) and for multi-id links (several names, count wins).
   * Optional so the chip stays renderable bare (unit tests, #232 suites).
   */
  clientName?: string | null;
  /**
   * #349 single-writer wiring: the ✕ no longer calls the router itself —
   * the page passes the hook's `navigate()` here. A direct router.replace
   * racing a pending coalesced `update()` flush would resurrect the dropped
   * param from the stale pre-navigation snapshot; going through the hook
   * makes the navigated URL the write base for the pending flush.
   */
  onRemove: (url: string, options?: { history?: 'push' | 'replace' }) => void;
}

/**
 * #232 §3.5 — narrowing chip: the visible affordance for an active deep-link
 * narrowing («Открыт по ссылке» / «Открыто по ссылке: N») and its removal.
 *
 * The ✕ does exactly ONE thing: removes every `clientId` occurrence from
 * the address (`URLSearchParams.delete` → `onRemove(buildUrlWithout…)`),
 * preserving all other query params. The page's URL hook then converges the
 * provider state — this component deliberately holds NO `setFilters` (the
 * address stays the single writer) and is not a ClientsContext consumer.
 *
 * #412 US-4 (spec §3.2): the chip rides in the toolbar's left group right
 * AFTER the filters panel (a sibling of its `clients-filters` root, never a
 * child). After removal, focus moves to the FILTERS PANEL (the sibling root
 * carries tabIndex={-1} as its programmatic focus target), not the page
 * body — a keyboard user closing the chip lands on the filters, where the
 * next interaction lives.
 */
export function ClientDeepLinkChip({ clientIds, clientName, onRemove }: ClientDeepLinkChipProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const removeNarrowing = useCallback(() => {
    onRemove(buildUrlWithoutClientId(searchParams, pathname));
    // #412 US-4: the ✕ unmounts itself on convergence — move focus off it
    // synchronously, or the browser would drop it to <body> on unmount.
    // Focused BEFORE the address converges, the panel keeps focus through
    // the chip's unmount (the panel itself never remounts here).
    document.querySelector<HTMLElement>('[data-testid="clients-filters"]')?.focus();
  }, [onRemove, pathname, searchParams]);

  const label = clientIds.length === 1 ? 'Открыт по ссылке' : `Открыто по ссылке: ${clientIds.length}`;

  // #412 US-4: accessible name of the ✕ substitutes the client when the
  // narrowing points at exactly one KNOWN client; honest fallbacks
  // otherwise (dead link — nothing to substitute; multi-id — the count).
  const removeLabel =
    clientIds.length === 1
      ? clientName
        ? `Убрать фильтр по клиенту: ${clientName}`
        : 'Убрать фильтр по клиенту'
      : `Убрать фильтр по клиентам: ${clientIds.length}`;

  return (
    <div
      className="inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-xs"
      style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)', color: 'var(--ink-mid)' }}
      data-testid="client-deep-link-chip"
    >
      <span aria-live="polite">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={removeNarrowing}
        className="flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none transition-colors hover:bg-card hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        title={removeLabel}
      >
        ✕
      </button>
    </div>
  );
}
