"use client";

import { Button } from "./Button";

/** Terminal/live phases the screen renders; `confirmed` unmounts it. */
export type AuthCallScreenPhase = "calling" | "expired" | "invalid";

export interface AuthCallScreenProps {
  /** The number the client calls — strictly `+7XXXXXXXXXX` (the tel: href). */
  phone: string;
  /** Visible display form, e.g. `+7 999 555-22-55`. */
  pretty: string;
  /** Whole seconds until the window closes (мм:сс display). */
  secondsLeft: number | null;
  phase: AuthCallScreenPhase;
  /** A «Позвонить ещё раз» initiate is in flight. */
  initiating: boolean;
  /** «Позвонить ещё раз»: a fresh initiate (new handle and window). */
  onRetry: () => void;
  /** «Начать заново»: back to the method picker (404 dead end). */
  onRestart: () => void;
  /** «Другой способ»: back to the method picker. */
  onOtherMethod: () => void;
}

/** мм:сс — the visible remaining-window timer (#593 рев.6). */
export function formatWindow(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * The «подтвердите звонком» screen (#593 §Фронт web): the number to dial as a
 * RFC 3966 `tel:` link (plus and digits in the href, pretty text visible),
 * the honest call facts, the remaining-window timer, and the terminal
 * states — expiry («Время вышло») and the 404 dead end
 * («Проверка недействительна»).
 */
export function AuthCallScreen({
  phone,
  pretty,
  secondsLeft,
  phase,
  initiating,
  onRetry,
  onRestart,
  onOtherMethod,
}: AuthCallScreenProps) {
  return (
    <div data-testid="auth-call-screen">
      {/* Top bar — «Другой способ» returns to the method picker; the label
          doubles as the arrow's accessible name. */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={onOtherMethod}
          className="text-[#555555] hover:text-[#1a1a1a] text-xl transition"
          aria-label="Другой способ"
        >
          ←
        </button>
        <h2 className="text-xl font-semibold text-[#1a1a1a]">
          Подтвердите телефон звонком
        </h2>
      </div>

      {phase === "invalid" ? (
        <p className="text-base font-medium text-[#1a1a1a] mb-2" role="status">
          Проверка недействительна
        </p>
      ) : phase === "expired" ? (
        <p className="text-base font-medium text-[#1a1a1a] mb-2" role="status">
          Время вышло
        </p>
      ) : (
        <p className="text-sm text-[#555555] mb-4">
          Позвоните на этот номер — звонок подтвердит ваш телефон
        </p>
      )}

      {/* The number to dial: tel: link, digits + plus in the href (#593 —
          without the plus some operators reject the call, especially from
          abroad); the visible text is the pretty form. */}
      <a
        href={`tel:${phone}`}
        data-testid="auth-call-number"
        className="block text-center text-3xl font-semibold text-[#004D56] hover:text-[#006670] transition mb-4"
      >
        {pretty}
      </a>

      {/* Honest call facts (#593 рев.5): free incl. roaming/abroad, the
          voice message-beep, the call is dropped and never charged. */}
      <p className="text-xs text-[#888888] mb-6 text-center">
        Звонок бесплатен — в том числе в роуминге и с зарубежного номера.
        Прозвучит голосовое сообщение-гудок, звонок сбросится и не будет
        тарифицирован.
      </p>

      {phase === "calling" && (
        <div className="text-center mb-6" aria-live="polite">
          <p className="text-xs text-[#888888] mb-1">Осталось времени</p>
          <p
            data-testid="auth-call-timer"
            className="text-2xl font-semibold text-[#1a1a1a] tabular-nums"
          >
            {formatWindow(secondsLeft ?? 0)}
          </p>
        </div>
      )}

      {phase === "expired" && (
        <Button
          variant="primary"
          size="lg"
          onClick={onRetry}
          disabled={initiating}
          className="w-full mb-3"
        >
          Позвонить ещё раз
        </Button>
      )}

      {phase === "invalid" && (
        <Button variant="primary" size="lg" onClick={onRestart} className="w-full mb-3">
          Начать заново
        </Button>
      )}
    </div>
  );
}

export default AuthCallScreen;
