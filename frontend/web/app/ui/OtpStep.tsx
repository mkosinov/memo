"use client";

import { useState } from "react";
import { Button } from "./Button";

export interface OtpStepProps {
  /** Phone from the booking form — the one the code confirms. */
  phone: string;
  /** A code request is in flight. */
  requesting: boolean;
  /** The code was accepted (202) — the input stage. */
  codeSent: boolean;
  /** A verify request is in flight. */
  verifying: boolean;
  /** Step-local error (spec §4.2/US-4: ошибки шага — в самом шаге). */
  error: string | null;
  /** Dev transport only (ENV == development): echoed code for manual checks. */
  devCode: string | null;
  onRequestCode: () => void;
  onVerify: (code: string) => void;
  onBack: () => void;
}

const CODE_LENGTH = 6;

/** «Подтвердите телефон» step of the anonymous booking flow (#499 §8). */
export function OtpStep({
  phone,
  requesting,
  codeSent,
  verifying,
  error,
  devCode,
  onRequestCode,
  onVerify,
  onBack,
}: OtpStepProps) {
  const [code, setCode] = useState("");

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={onBack}
          className="text-[#555555] hover:text-[#1a1a1a] text-xl transition"
          aria-label="Назад"
        >
          ←
        </button>
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Подтвердите телефон</h2>
      </div>

      <p className="text-sm text-[#555555] mb-6">
        Мы отправим код на телефон{" "}
        <span className="font-medium text-[#1a1a1a]">{phone}</span>
      </p>

      <div className="mb-4">
        <Button
          variant="primary"
          size="lg"
          onClick={onRequestCode}
          disabled={requesting}
          className="w-full"
        >
          Отправить код
        </Button>
      </div>

      {codeSent && (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="otp-code"
              className="block text-sm font-medium text-[#555555] mb-1"
            >
              Код из SMS
            </label>
            <input
              id="otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              data-testid="otp-code-input"
              className="w-full rounded-lg border border-[#E0E0E1] px-3 py-2 text-lg tracking-[0.3em] text-[#1a1a1a] placeholder-[#cccccc] transition focus:border-[#004D56] focus:outline-none"
            />
          </div>

          {devCode && (
            <p className="text-xs text-[#888888]">
              Код для разработки: {devCode}
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            onClick={() => onVerify(code)}
            disabled={verifying || code.length !== CODE_LENGTH}
            className="w-full"
          >
            Подтвердить
          </Button>
        </div>
      )}

      {error && (
        <p
          data-testid="otp-step-error"
          className="text-sm text-[#C8503C] mt-4"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default OtpStep;
