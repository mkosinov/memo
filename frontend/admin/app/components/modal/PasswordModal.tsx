'use client';

// GH #262 T7 — PasswordModal (spec §5.3, D6/D12).
//
// Small modal over the shared Modal shell: Старый пароль, Новый пароль,
// Повторите новый + the shared PASSWORD_POLICY_HINT_RU hint. The mutation is
// the useChangePassword hook (POST /auth/change-password).
//
// Error mapping (backend src/auth/service.py change_password):
//  - wrong current password → 401 AUTH_INVALID_CREDENTIALS → INLINE
//    «Неверный пароль» on the current field (a normal flow, never a toast);
//  - policy breach → 422 PASSWORD_POLICY → error toast (the shared hint
//    already explains the rule inline);
//  - any other error → error toast.
// On success: toast «Пароль изменён» + close. The CURRENT session stays
// alive — no redirect, no logout (D6).

import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/app/components/shared/modal/Modal';
import { useChangePassword } from '@/hooks/useMyProfile';
import { useUI } from '@/contexts/UIContext';
import { ApiError } from '@memo/api-client';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { PASSWORD_POLICY_HINT_RU } from '@/lib/constants';

export interface PasswordModalProps {
  onClose: () => void;
}

interface PasswordFields {
  current: string;
  next: string;
  repeat: string;
}

const WRONG_CURRENT = 'Неверный пароль';
const MISMATCH = 'Пароли не совпадают';

function PasswordInput({
  testId,
  label,
  value,
  onChange,
  error,
  autoComplete,
}: {
  testId: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete: string;
}) {
  const errorId = `${testId}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={testId}
        className="text-xs font-medium"
        style={{ color: 'var(--ink-light)' }}
      >
        {label}
      </label>
      <input
        id={testId}
        data-testid={testId}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm transition-colors"
        style={{
          borderColor: error ? 'var(--danger)' : 'var(--line)',
          backgroundColor: 'var(--white)',
          color: 'var(--ink)',
        }}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <span
          className="text-xs"
          style={{ color: 'var(--danger)' }}
          id={errorId}
          data-testid={errorId}
        >
          {error}
        </span>
      )}
    </div>
  );
}

export function PasswordModal({ onClose }: PasswordModalProps) {
  const { showToast } = useUI();
  const changePassword = useChangePassword();

  const [fields, setFields] = useState<PasswordFields>({ current: '', next: '', repeat: '' });
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);

  const setField = useCallback((key: keyof PasswordFields) => (v: string) => {
    setFields((prev) => ({ ...prev, [key]: v }));
    if (key === 'current') setCurrentError(null);
    if (key === 'repeat') setRepeatError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setCurrentError(null);
    setRepeatError(null);

    const { current, next, repeat } = fields;
    if (!current || !next || !repeat) return; // client guard — buttons stay inert
    if (next !== repeat) {
      setRepeatError(MISMATCH);
      return;
    }

    try {
      await changePassword.mutateAsync({
        current_password: current,
        new_password: next,
      });
      showToast('Пароль изменён', 'success');
      onClose();
    } catch (err) {
      // 401 on change-password = wrong CURRENT password (normal flow) →
      // inline field error, never a toast (spec §5.3).
      if (err instanceof ApiError && err.status === 401) {
        setCurrentError(WRONG_CURRENT);
        return;
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [fields, changePassword, showToast, onClose]);

  // Escape closes (PhotoModal pattern) — a password form has no dirty guard.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const busy = changePassword.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <Modal
        title="Сменить пароль"
        onClose={onClose}
        size="small"
        testId="password-modal"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border transition-colors"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              Отмена
            </button>
            <button
              data-testid="password-submit"
              onClick={() => void handleSubmit()}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {busy ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        }
      >
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p
            className="text-xs"
            style={{ color: 'var(--ink-mid)' }}
            data-testid="password-hint"
          >
            {PASSWORD_POLICY_HINT_RU}
          </p>
          <PasswordInput
            testId="password-current"
            label="Старый пароль"
            value={fields.current}
            onChange={setField('current')}
            error={currentError ?? undefined}
            autoComplete="current-password"
          />
          <PasswordInput
            testId="password-new"
            label="Новый пароль"
            value={fields.next}
            onChange={setField('next')}
            autoComplete="new-password"
          />
          <PasswordInput
            testId="password-repeat"
            label="Повторите новый"
            value={fields.repeat}
            onChange={setField('repeat')}
            error={repeatError ?? undefined}
            autoComplete="new-password"
          />
        </div>
      </Modal>
    </div>
  );
}
