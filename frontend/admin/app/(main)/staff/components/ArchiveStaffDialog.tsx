'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { StaffResponse, StaffArchiveRequest } from '@memo/api-client';

/**
 * ArchiveStaffDialog — the D6 dismissal dialog (GH #266 «Увольнение»).
 *
 * Archiving a PERSON never silently cascades: the admin explicitly opts in
 * per linked resource via preselected checkboxes:
 *   • «Архивировать мастера (расписание)» — visible only when an ACTIVE
 *     master section exists (master && !master.archived). An already-archived
 *     section has nothing to flip.
 *   • «Архивировать учётку (вход)» — visible only when has_user (a linked
 *     account row exists, ANY is_active — Gap B).
 * Both default true (mirrors the backend defaults); unchecking leaves the link
 * as-is (D3: «уволен, досиживает занятия» / «вход разрешён»).
 *
 * onConfirm receives the explicit checkbox body so the admin's choice is a
 * visible wire payload, not a hidden cascade.
 */
export interface ArchiveStaffDialogProps {
  staff: StaffResponse;
  onConfirm: (checkboxes: StaffArchiveRequest) => Promise<void>;
  onClose: () => void;
}

export function ArchiveStaffDialog({ staff, onConfirm, onClose }: ArchiveStaffDialogProps) {
  // Visibility per D6: master checkbox only for a live active section; account
  // checkbox only when an account is linked.
  const showMaster = staff.master !== null && !staff.master.archived;
  const showUser = staff.has_user;

  // Both preselected (D6 «предвыбраны»). A hidden checkbox is irrelevant to
  // the body (the backend applies a flag only to an existing active link), so
  // we always send both keys with their (possibly default) values.
  const [archiveMaster, setArchiveMaster] = useState(true);
  const [archiveUser, setArchiveUser] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ archive_master: archiveMaster, archive_user: archiveUser });
      // Parent closes on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось архивировать. Попробуйте ещё раз.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-testid="archive-staff-dialog-overlay"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl px-5 py-4"
        style={{ backgroundColor: 'var(--white)' }}
        data-testid="archive-staff-dialog"
      >
        <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>
          Архивировать «{staff.last_name} {staff.first_name}»
        </h2>
        <p className="text-sm mt-3" style={{ color: 'var(--ink-mid)' }}>
          Сотрудник перейдёт в архив. Что сделать со связями:
        </p>

        <div className="flex flex-col gap-2 my-3">
          {showMaster && (
            <label
              className="flex items-center gap-2 cursor-pointer"
              style={{ color: 'var(--ink)' }}
            >
              <input
                type="checkbox"
                data-testid="archive-master-checkbox"
                checked={archiveMaster}
                disabled={busy}
                onChange={() => setArchiveMaster((v) => !v)}
                className="shrink-0 rounded accent-[var(--brand)]"
              />
              <span className="text-sm">Архивировать мастера (расписание)</span>
            </label>
          )}
          {showUser && (
            <label
              className="flex items-center gap-2 cursor-pointer"
              style={{ color: 'var(--ink)' }}
            >
              <input
                type="checkbox"
                data-testid="archive-user-checkbox"
                checked={archiveUser}
                disabled={busy}
                onChange={() => setArchiveUser((v) => !v)}
                className="shrink-0 rounded accent-[var(--brand)]"
              />
              <span className="text-sm">Архивировать учётку (вход)</span>
            </label>
          )}
          {!showMaster && !showUser && (
            <p className="text-sm" style={{ color: 'var(--ink-light)' }}>
              Нет связанных мастера или учётки — будет архивирован только сотрудник.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }} data-testid="archive-staff-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            data-testid="archive-staff-cancel-btn"
            onClick={handleClose}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg border transition-colors"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            Отмена
          </button>
          <button
            data-testid="archive-staff-confirm-btn"
            onClick={handleConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {busy ? 'Архивирование…' : 'Архивировать'}
          </button>
        </div>
      </div>
    </div>
  );
}
