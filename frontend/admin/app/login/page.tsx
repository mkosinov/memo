'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getMe } from '@memo/api-client';
import { useUI } from '@/contexts/UIContext';
import { useAuth } from '@/contexts/AuthContext';
import { parseApiError } from '../lib/api/parseApiError';

/**
 * Login page (GH #247 spec §4.2).
 * Outside the (main) route group — no sidebar / user block. Controlled
 * phone + password inputs; success routes to returnTo ?? "/"; failure shows
 * an inline error plus the standard error toast. Already-authenticated
 * visitors are bounced to "/". No password-policy hint here (spec decision 10
 * — nothing is being set on this page).
 */
// useSearchParams needs a Suspense boundary for static prerender (repo
// precedent: clients/page.tsx).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useUI();
  // Submit goes through the context (not the api-client directly): login must
  // flip AuthContext state to authenticated, or the (main) AuthGate would
  // bounce the freshly logged-in user right back to /login.
  const { login } = useAuth();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated → straight to the app (spec §4.2).
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled && me) router.replace('/');
      })
      .catch(() => {
        /* guest or network down — stay on the form */
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(phone.trim(), password);
      const returnTo = searchParams.get('returnTo');
      router.replace(returnTo ?? '/');
    } catch (err) {
      const { message } = parseApiError(err);
      setError(message);
      showToast(message, 'error');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{
          backgroundColor: 'var(--card-bg)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        <h1
          className="text-xl font-semibold mb-6 text-center"
          style={{ color: 'var(--ink)' }}
        >
          Вход в Memo
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-phone"
              className="text-xs font-medium"
              style={{ color: 'var(--ink-mid)' }}
            >
              Телефон
            </label>
            <input
              id="login-phone"
              type="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)', backgroundColor: 'var(--white)' }}
              placeholder="+7 900 000-00-00"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-password"
              className="text-xs font-medium"
              style={{ color: 'var(--ink-mid)' }}
            >
              Пароль
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)', backgroundColor: 'var(--white)' }}
            />
          </div>

          {error && (
            <p
              data-testid="login-error"
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
            {submitting ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
