'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUI } from '@/contexts/UIContext';
import { useAuth } from '@/contexts/AuthContext';
import { AuthCard } from '../components/auth/AuthCard';
import { parseApiError } from '../lib/api/parseApiError';
import {
  PhoneField,
  phoneCompact,
  type PhoneFieldValue,
} from '../components/shared/phone/PhoneField';
import { DEFAULT_PHONE_COUNTRY } from '../components/shared/phone/countries';

/**
 * Open-redirect hardening: only same-origin absolute paths are accepted —
 * must start with "/" and must not start with "//" (protocol-relative URL).
 * Anything else ("https://evil…", "//evil…", garbage) falls back to "/".
 */
function sanitizeReturnTo(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

/**
 * Login page (GH #247 spec §4.2).
 * Outside the (main) route group — no sidebar / user block. Controlled
 * phone + password inputs; success routes to returnTo ?? "/"; failure shows
 * an inline error plus the standard error toast. Already-authenticated
 * visitors are bounced to "/". No password-policy hint here (spec decision 10
 * — nothing is being set on this page).
 *
 * GH #414 (spec §Экран входа): the login is the PhoneField widget WITHOUT
 * the completeness validator — the only gate is the required-empty one
 * (native `required`), otherwise accounts with legacy spellings («+7 999 …»)
 * or out-of-list countries («+1 …») could not sign in at all. On submit the
 * wire value is the compact when a list country is bound, and just the typed
 * digits in the «no country» state; the backend resolves the account via
 * exact string → unique to_national_digits reduction.
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
  // bounce the freshly logged-in user right back to /login. `status` also
  // drives the already-authenticated redirect — the AuthProvider bootstraps
  // /me on mount, so the page needs no second call.
  const { login, status } = useAuth();

  // Widget state: fresh field → RU selector, empty remainder, pristine.
  const [phone, setPhone] = useState<PhoneFieldValue>({
    country: DEFAULT_PHONE_COUNTRY,
    national: '',
    pristine: true,
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // What goes on the wire (spec §Экран входа): the compact of the bound
  // list country («+79991234567»); digits only while «без страны» — no
  // compact exists there by design. Deliberately NOT gated on completeness.
  const loginPhone = phone.country !== null ? phoneCompact(phone) : phone.national;

  // Already authenticated → straight to the app (spec §4.2). Fires when the
  // bootstrap /me resolves authenticated (also right after a successful
  // login(), before router.replace below — same destination either way).
  useEffect(() => {
    if (status === 'authenticated') router.replace('/');
  }, [status, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(loginPhone, password);
      router.replace(sanitizeReturnTo(searchParams.get('returnTo')));
    } catch (err) {
      const { message } = parseApiError(err);
      setError(message);
      showToast(message, 'error');
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Вход в Memo">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="login-phone"
            className="text-xs font-medium"
            style={{ color: 'var(--ink-mid)' }}
          >
            Телефон
          </label>
          {/* Required-empty is the ONLY validation here (native required);
              the #login-phone anchor moves to the remainder input. */}
          <PhoneField
            id="login-phone"
            autoComplete="tel"
            required
            value={phone}
            onChange={setPhone}
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
    </AuthCard>
  );
}
