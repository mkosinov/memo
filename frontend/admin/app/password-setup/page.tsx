'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  validatePasswordSetup,
  passwordSetup,
  ApiError,
} from '@memo/api-client';
import { AuthCard } from '../components/auth/AuthCard';
import { parseApiError } from '../lib/api/parseApiError';
import { PASSWORD_POLICY_HINT_RU } from '@/lib/constants';

/** Extract the token from the URL fragment (`#token=…`) — spec §6: the
 *  fragment never hits server logs or Referer. Anything unparsable counts
 *  as «no token». */
function readTokenFromHash(hash: string): string | null {
  const m = hash.match(/^#token=(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

type Screen = 'checking' | 'form' | 'invalid';

const MISMATCH = 'Пароли не совпадают';

/**
 * Public password-setup page (GH #348 spec §6, S2/S4).
 *
 * Outside the (main) route group — exactly like /login, the client-side
 * AuthGate never touches it; the link's token is the only authority
 * (spec §7). On open: read the token from the fragment, STRIP it from the
 * address bar, validate; 200 → the «Придумайте пароль» form, the single
 * 422 PASSWORD_LINK_INVALID → «Ссылка недействительна или истекла». The
 * form carries the policy hint inline; a 422 PASSWORD_POLICY answer is the
 * single inline message; success routes to the static
 * /password-setup/success — since the fragment is already gone and the
 * token is consumed server-side, refreshing never re-issues the request.
 */
export default function PasswordSetupPage() {
  const router = useRouter();

  const [screen, setScreen] = useState<Screen>('checking');
  // The token lives ONLY in state after the fragment is stripped — the
  // submit call carries it, the address bar never shows it again.
  const tokenRef = useRef<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = readTokenFromHash(window.location.hash);
    // Strip the fragment right after reading (spec §6): the token must not
    // linger in the address bar (refresh / copy-paste of the URL would
    // otherwise re-arm a consumed link).
    if (window.location.hash) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }

    if (!token) {
      setScreen('invalid');
      return;
    }
    tokenRef.current = token;

    let cancelled = false;
    validatePasswordSetup(token)
      .then(() => {
        if (!cancelled) setScreen('form');
      })
      .catch(() => {
        // The single 422 PASSWORD_LINK_INVALID for every dead-link state —
        // and any transport failure also lands here (dead screen, no
        // enumeration, no retry loop on a link we cannot confirm).
        if (!cancelled) setScreen('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password !== confirm) {
      setError(MISMATCH);
      return;
    }
    const token = tokenRef.current;
    if (!token) {
      setScreen('invalid');
      return;
    }
    setSubmitting(true);
    try {
      await passwordSetup(token, password);
      router.replace('/password-setup/success');
    } catch (err) {
      // The link died between validate and submit (used / expired /
      // re-issued) — the same dead-link screen, not an inline error.
      if (err instanceof ApiError && err.code === 'PASSWORD_LINK_INVALID') {
        setScreen('invalid');
        return;
      }
      // One inline message for the policy (the shared hint string); any
      // other failure keeps the form retryable with the parsed message.
      setError(parseApiError(err).message);
      setSubmitting(false);
    }
  }

  if (screen === 'checking') {
    return (
      <AuthCard title="Memo">
        <p
          data-testid="password-setup-checking"
          className="text-sm text-center"
          style={{ color: 'var(--ink-mid)' }}
        >
          Проверка ссылки…
        </p>
      </AuthCard>
    );
  }

  if (screen === 'invalid') {
    return (
      <AuthCard title="Memo">
        <p
          data-testid="password-setup-invalid"
          className="text-sm text-center"
          style={{ color: 'var(--ink)' }}
        >
          Ссылка недействительна или истекла
        </p>
        <p
          className="mt-2 text-xs text-center"
          style={{ color: 'var(--ink-light)' }}
        >
          Запросите новую ссылку у администратора.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Придумайте пароль">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password-setup-password"
            className="text-xs font-medium"
            style={{ color: 'var(--ink-mid)' }}
          >
            Пароль
          </label>
          <input
            id="password-setup-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
            style={{
              borderColor: 'var(--line)',
              color: 'var(--ink)',
              backgroundColor: 'var(--white)',
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password-setup-confirm"
            className="text-xs font-medium"
            style={{ color: 'var(--ink-mid)' }}
          >
            Повторите пароль
          </label>
          <input
            id="password-setup-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
            style={{
              borderColor: 'var(--line)',
              color: 'var(--ink)',
              backgroundColor: 'var(--white)',
            }}
          />
        </div>

        <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
          {PASSWORD_POLICY_HINT_RU}
        </p>

        {error && (
          <p
            data-testid="password-setup-error"
            className="text-xs"
            style={{ color: 'var(--danger)' }}
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          {submitting ? 'Установка…' : 'Установить пароль'}
        </button>
      </form>
    </AuthCard>
  );
}
