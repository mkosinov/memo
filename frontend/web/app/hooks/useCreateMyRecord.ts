"use client";

import { useCallback, useState } from "react";
import { createMyRecord, ApiError } from "@memo/api-client";
import type { MyRecordCreate } from "@memo/api-client";
import { structuredServerMessage } from "@/app/lib/errors";

export type MyRecordStatus = "idle" | "submitting" | "error";

const CONNECTION_HINT = "Не удалось отправить запись. Проверьте соединение и попробуйте еще раз";

/** Localized booking fallback — used unless the refusal carries a structured server message. */
const BOOKING_FAILURE_MESSAGE = "Не удалось создать запись. Попробуйте еще раз";

function bookingErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return structuredServerMessage(err, BOOKING_FAILURE_MESSAGE);
  }
  return CONNECTION_HINT;
}

export interface MyRecordSubmission {
  status: MyRecordStatus;
  /** Booking-refusal message for the booking-error block (US-3). */
  error: string | null;
  /** Resolves true on 201 (success screen), false on refusal. */
  submit: (payload: MyRecordCreate) => Promise<boolean>;
  /** Clear a refusal (e.g. the overlay reopens for a fresh attempt). */
  reset: () => void;
}

/** `POST /api/v1/my/records` submission state (#499 spec §5). */
export function useCreateMyRecord(): MyRecordSubmission {
  const [status, setStatus] = useState<MyRecordStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (payload: MyRecordCreate): Promise<boolean> => {
    setStatus("submitting");
    setError(null);
    try {
      await createMyRecord(payload);
      setStatus("idle");
      return true;
    } catch (err) {
      setError(bookingErrorMessage(err));
      setStatus("error");
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, submit, reset };
}
