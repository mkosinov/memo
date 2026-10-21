"use client";

import { useCallback, useState } from "react";
import { requestOtpCode, verifyOtpCode, ApiError } from "@memo/api-client";
import type { MyClient } from "@memo/api-client";
import { structuredServerMessage } from "@/app/lib/errors";

/** Stages of the «подтвердите телефон» step (spec §4.2/§8). */
export type OtpLoginStage = "idle" | "requesting" | "entering" | "verifying";

/** Fail-closed transport (#499 US-4): no configured transport → 503 → this message. */
export const OTP_UNAVAILABLE_MESSAGE = "Вход временно недоступен";

/** Localized step fallback — used unless the refusal carries a structured server message. */
const OTP_FAILURE_MESSAGE = "Не удалось подтвердить телефон";

function otpErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return OTP_UNAVAILABLE_MESSAGE;
    return structuredServerMessage(err, OTP_FAILURE_MESSAGE);
  }
  return "Не удалось отправить код. Проверьте соединение";
}

export interface OtpLogin {
  stage: OtpLoginStage;
  /** Step-local error (spec: ошибки шага — в самом шаге). */
  error: string | null;
  /** Dev transport only (ENV == development): the code echoed for manual checks. */
  devCode: string | null;
  requestCode: (phone: string) => Promise<boolean>;
  verify: (phone: string, code: string) => Promise<MyClient | null>;
  reset: () => void;
}

/** The phone-confirmation step logic of the anonymous booking flow (#499). */
export function useOtpLogin(): OtpLogin {
  const [stage, setStage] = useState<OtpLoginStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const requestCode = useCallback(async (phone: string): Promise<boolean> => {
    setStage("requesting");
    setError(null);
    try {
      const res = await requestOtpCode(phone);
      setDevCode(res.dev_code ?? null);
      setStage("entering");
      return true;
    } catch (err) {
      setError(otpErrorMessage(err));
      setStage("idle");
      return false;
    }
  }, []);

  const verify = useCallback(async (phone: string, code: string): Promise<MyClient | null> => {
    setStage("verifying");
    setError(null);
    try {
      const client = await verifyOtpCode(phone, code);
      setStage("idle");
      return client;
    } catch (err) {
      setError(otpErrorMessage(err));
      setStage("entering");
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setDevCode(null);
  }, []);

  return { stage, error, devCode, requestCode, verify, reset };
}
