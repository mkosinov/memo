import React from 'react';

/**
 * Shared public-auth card shell (GH #247 login layout, reused by the public
 * password-setup pages #348 spec §6 — «переиспользование компонентов и
 * стиля формы входа»). Presentational only: no hooks, so both client pages
 * and static server pages can render it.
 */
export interface AuthCardProps {
  /** Card heading, centered (e.g. «Вход в Memo»). */
  title: string;
  children: React.ReactNode;
}

export function AuthCard({ title, children }: AuthCardProps) {
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
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
