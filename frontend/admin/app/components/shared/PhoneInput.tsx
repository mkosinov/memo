'use client';

import { useCallback } from 'react';
import { AsYouType } from 'libphonenumber-js/min';
import RemoteSearchSelect from '@/app/components/shared/RemoteSearchSelect';

// Upstream typing gap: `getNationalNumber()` exists at runtime (this is the
// documented digits source for search queries) but is missing from the
// shipped .d.ts. Augment here — this wrapper is the isolation seam (GH #221
// decision 8), so the augmentation stays local to the phone feature.
declare module 'libphonenumber-js/min' {
  interface AsYouType {
    getNationalNumber(): string | undefined;
  }
}

// Record-form phone typeahead (GH #221, spec §5): adaptive mask via
// libphonenumber-js AsYouType (min metadata, imported here so it rides
// per-route splitting), 4-DIGIT search threshold, ?phone=<national digits>
// requests, read-only "name · phone" state after pick.
//
// Caret is NOT managed (spec decision 8): end-of-string typing is exact;
// mid-string edits may jump the caret — accepted v1 limitation. This wrapper
// is the isolation seam for any future caret fix.

export interface PickedClient {
  id: string;
  name: string | null;
  phone: string;
}

interface RemoteSearchItem {
  id: string;
  name?: string | null;
  phone?: string | null;
  [key: string]: unknown;
}

export interface PhoneInputProps {
  /** Client-list search — receives `{ phone: <national digits>, per_page: 10 }`. */
  onSearch: (params: { phone: string; per_page: number }) => Promise<RemoteSearchItem[]>;
  /** Called when a suggestion is picked. */
  onPick: (client: PickedClient) => void;
  /** Called when the pick is cleared via ×. */
  onClear?: () => void;
  /** National-number search digits of the current pick (controls read-only mode). */
  picked?: PickedClient | null;
  label?: string;
  placeholder?: string;
}

/** Threshold counts DIGITS, never mask characters (spec decision 4). */
const MIN_DIGITS = 4;

/**
 * Keystroke loop (spec §5): strip non-digits, re-format through AsYouType
 * ("RU" as national default; a typed "+" switches to international mode).
 * The digits-source amendment (G1b): search digits come from
 * `getNationalNumber()` — never scraped off the display string, so the
 * decorative trunk `8`/country code the mask may prepend cannot leak into
 * the query and break tail-of-number search.
 */
function formatPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // A typed "+" switches AsYouType to international mode (country auto-detect
  // from the prefix: +7 → RU grouping, +375 → BY, +49 → DE).
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (!digits) return plus ? '+' : '';
  const asyou = new AsYouType('RU');
  return asyou.input(plus ? `+${digits}` : digits) || raw;
}

/** National digits of the current input (the value sent as `?phone=`). */
export function getNationalDigits(input: string): string {
  const asyou = new AsYouType('RU');
  asyou.input(input);
  return asyou.getNationalNumber() ?? '';
}

function optionLabel(item: RemoteSearchItem): string {
  return `${item.name || 'Без имени'} · ${item.phone ?? ''}`;
}

export default function PhoneInput({
  onSearch,
  onPick,
  onClear,
  picked = null,
  label = 'Телефон',
  placeholder = '+7 (___) ___-__-__',
}: PhoneInputProps) {
  const handlePick = useCallback(
    (item: RemoteSearchItem) => {
      onPick({
        id: item.id,
        name: item.name ?? null,
        phone: item.phone ?? '',
      });
    },
    [onPick],
  );

  return (
    <RemoteSearchSelect<{ phone: string; per_page: number }>
      value={picked?.id ?? null}
      onChange={(id) => {
        if (id === null) onClear?.();
      }}
      onSelectItem={handlePick}
      onSearch={onSearch}
      label={label}
      placeholder={placeholder}
      displayField="phone"
      canSearch={(input) => getNationalDigits(input).length >= MIN_DIGITS}
      buildParams={(input) => ({
        phone: getNationalDigits(input),
        per_page: 10,
      })}
      formatInput={formatPhone}
      getDisplayLabel={optionLabel}
      inputTestId="input-phone"
    />
  );
}
