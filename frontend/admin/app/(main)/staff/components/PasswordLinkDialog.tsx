'use client';

import React, { useEffect, useState } from 'react';

/**
 * PasswordLinkDialog — the one-time password-setup link handover (GH #348
 * spec §6, S1/S3). Shown exactly when a link is ISSUED: the raw token
 * surfaces only in the issue response, so there is nothing to re-open
 * later — a needed link is a new issuance (the block button does that).
 *
 * Two states, decided by the props:
 *  • ready  — the link field + «Скопировать», «действует до …» (local
 *    time), the handover hint «передайте ссылку сотруднику»;
 *  • error  — issuance failed (e.g. right after card creation): the
 *    message + «Повторить»; the account simply waits for the block
 *    button until a link is successfully issued.
 *
 * The URL is ASSEMBLED BY THE CALLER from the page origin
 * (`{origin}/password-setup#token=…`) — the backend knows no public
 * address (spec §5).
 */
/** The one-time link issued for an account (#348 spec §5). */
export interface IssuedPasswordLink {
  token: string;
  expires_at: string;
}

export interface PasswordLinkDialogProps {
  /** The issued link — null renders the error state. */
  link: IssuedPasswordLink | null;
  /** Issuance error message — shown with «Повторить» (S1 fallback). */
  error: string | null;
  /** Disable the buttons while a (re)issue is in flight. */
  busy: boolean;
  /** Error-state retry — re-issues the link. */
  onRetry: () => void;
  onClose: () => void;
}

/** Local time of an ISO instant — the admin's wall-clock, spec §6. */
export function formatLinkExpiry(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/** Assemble the handover URL from the page origin (spec §5) — fragment,
 *  so the token never hits server logs or Referer. */
export function assemblePasswordLinkUrl(token: string): string {
  return `${window.location.origin}/password-setup#token=${token}`;
}

export function PasswordLinkDialog({
  link,
  error,
  busy,
  onRetry,
  onClose,
}: PasswordLinkDialogProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const url = link ? assemblePasswordLinkUrl(link.token) : null;

  const handleCopy = async (): Promise<void> => {
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      // Clipboard may be unavailable (insecure context) — the link stays
      // selectable in the field for a manual copy.
    }
    setCopied(true);
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-testid="password-link-dialog-overlay"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div
        className="relative w-full max-w-md bg-white rounded-xl shadow-2xl px-5 py-4"
        style={{ backgroundColor: 'var(--white)' }}
        data-testid="password-link-dialog"
      >
        <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>
          Ссылка установки пароля
        </h2>

        {link && url ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-1">
              <input
                type="text"
                readOnly
                value={url}
                data-testid="link-url-field"
                onFocus={(e) => e.target.select()}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              />
            </div>
            <p className="text-sm" style={{ color: 'var(--ink-mid)' }}>
              Действует до {formatLinkExpiry(link.expires_at)}
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
              Передайте ссылку сотруднику — по ней он сам придумает пароль.
              Ссылка одноразовая и показывается только сейчас.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p role="alert" data-testid="link-dialog-error" style={{ color: 'var(--danger)' }}>
              {error ?? 'Не удалось выдать ссылку.'}
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
              Учётка создана и ждёт выдачи ссылки — можно повторить сейчас
              или позже кнопкой в блоке «Учётка».
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          {!link && (
            <button
              type="button"
              data-testid="link-dialog-retry-btn"
              onClick={onRetry}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {busy ? 'Выдача…' : 'Повторить'}
            </button>
          )}
          <button
            type="button"
            data-testid="link-dialog-close-btn"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            Закрыть
          </button>
          {link && (
            <button
              type="button"
              data-testid="link-copy-btn"
              onClick={() => void handleCopy()}
              className="px-4 py-2 text-sm rounded-lg text-white transition-colors"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
