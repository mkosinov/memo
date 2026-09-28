import React from 'react';
import Link from 'next/link';
import { AuthCard } from '../../components/auth/AuthCard';

/**
 * Static success screen of the public password setup (GH #348 spec §6).
 * A separate public address: after the redirect the fragment is long gone
 * and the token is consumed server-side, so a page refresh can NEVER
 * re-issue the setup request — the page holds no logic and makes no calls.
 */
export default function PasswordSetupSuccessPage() {
  return (
    <AuthCard title="Пароль установлен">
      <p className="text-sm text-center" style={{ color: 'var(--ink-mid)' }}>
        Войдите с телефоном и новым паролем
      </p>
      <Link
        href="/login"
        className="mt-6 block rounded-lg py-2 text-center text-sm font-medium text-white transition-colors"
        style={{ backgroundColor: 'var(--brand)' }}
      >
        Войти
      </Link>
    </AuthCard>
  );
}
