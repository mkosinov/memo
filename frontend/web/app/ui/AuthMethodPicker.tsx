"use client";

import type { AuthMethod } from "@memo/api-client";
import { OTP_UNAVAILABLE_MESSAGE } from "@/app/hooks/useOtpLogin";

export interface AuthMethodPickerProps {
  /** The raw `GET /auth/methods` registry — the picker shows only `available`. */
  methods: AuthMethod[];
  loading: boolean;
  onSelectCall: () => void;
  onSelectSms: () => void;
  /** Preselection highlight (the cabinet login form's «предвыбор способа»,
   * rev.8): the picked button renders pressed. null = nothing picked. */
  selected?: "sms" | "call" | null;
}

/** Base classes per method button — selection adds the ring on top. */
const CALL_BUTTON_BASE =
  "w-full rounded-lg px-6 py-3 text-lg font-medium transition ";
const CALL_BUTTON_IDLE = CALL_BUTTON_BASE + "bg-[#004D56] text-white hover:bg-[#006670]";
const CALL_BUTTON_SELECTED =
  CALL_BUTTON_BASE +
  "bg-[#004D56] text-white ring-2 ring-[#004D56] ring-offset-2";

const SMS_BUTTON_BASE = "w-full rounded-lg px-6 py-3 text-lg font-medium transition ";
const SMS_BUTTON_IDLE =
  SMS_BUTTON_BASE + "border border-[#004D56] text-[#004D56] hover:bg-[#004D56] hover:text-white";
const SMS_BUTTON_SELECTED =
  SMS_BUTTON_BASE +
  "border border-[#004D56] bg-[#004D56]/10 text-[#004D56] ring-2 ring-[#004D56] ring-offset-2";

/**
 * The client-auth method picker (#593 §Фронт web): honest availability from
 * the backend registry — a method whose transport is off is not offered.
 * Empty registry (or a failed fetch — the caller passes `[]`) → the
 * «Вход временно недоступен» dead end with the «Связаться» panel beside it.
 *
 * Two placements: the auth step (a plain choice) and the cabinet login form
 * (a prechoice — `selected` highlights it; «Войти» then applies it).
 */
export function AuthMethodPicker({
  methods,
  loading,
  onSelectCall,
  onSelectSms,
  selected = null,
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
          aria-pressed={selected === "call"}
          className={selected === "call" ? CALL_BUTTON_SELECTED : CALL_BUTTON_IDLE}
        >
          Подтвердить звонком
        </button>
      )}
      {available.some((m) => m.id === "sms_otp") && (
        <button
          type="button"
          onClick={onSelectSms}
          data-testid="auth-method-sms"
          aria-pressed={selected === "sms"}
          className={selected === "sms" ? SMS_BUTTON_SELECTED : SMS_BUTTON_IDLE}
        >
          Код по SMS
        </button>
      )}
    </div>
  );
}

export default AuthMethodPicker;
