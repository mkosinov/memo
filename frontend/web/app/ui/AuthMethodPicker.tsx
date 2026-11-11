"use client";

import type { AuthMethod } from "@memo/api-client";
import { OTP_UNAVAILABLE_MESSAGE } from "@/app/hooks/useOtpLogin";

export interface AuthMethodPickerProps {
  /** The raw `GET /auth/methods` registry — the picker shows only `available`. */
  methods: AuthMethod[];
  loading: boolean;
  onSelectCall: () => void;
  onSelectSms: () => void;
}

/**
 * The client-auth method picker (#593 §Фронт web): honest availability from
 * the backend registry — a method whose transport is off is not offered.
 * Empty registry (or a failed fetch — the caller passes `[]`) → the
 * «Вход временно недоступен» dead end with the «Связаться» panel beside it.
 */
export function AuthMethodPicker({
  methods,
  loading,
  onSelectCall,
  onSelectSms,
}: AuthMethodPickerProps) {
  if (loading) {
    return (
      <p className="text-sm text-[#555555]" data-testid="auth-methods-loading">
        Загрузка…
      </p>
    );
  }

  const available = methods.filter((m) => m.available);
  if (available.length === 0) {
    return (
      <p
        className="text-sm text-[#555555]"
        data-testid="auth-methods-unavailable"
      >
        {OTP_UNAVAILABLE_MESSAGE}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="auth-method-picker">
      {available.some((m) => m.id === "call") && (
        <button
          type="button"
          onClick={onSelectCall}
          data-testid="auth-method-call"
          className="w-full rounded-lg bg-[#004D56] px-6 py-3 text-lg font-medium text-white transition hover:bg-[#006670]"
        >
          Подтвердить звонком
        </button>
      )}
      {available.some((m) => m.id === "sms_otp") && (
        <button
          type="button"
          onClick={onSelectSms}
          data-testid="auth-method-sms"
          className="w-full rounded-lg border border-[#004D56] px-6 py-3 text-lg font-medium text-[#004D56] transition hover:bg-[#004D56] hover:text-white"
        >
          Код по SMS
        </button>
      )}
    </div>
  );
}

export default AuthMethodPicker;
