"use client";

import { useCallback, useState } from "react";
import { createMyRecord, ApiError } from "@memo/api-client";
import type { MyRecordCreate } from "@memo/api-client";

export type MyRecordStatus = "idle" | "submitting" | "error";

const CONNECTION_HINT = "Не удалось отправить запись. Проверьте соединение и попробуйте еще раз";

function bookingErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || "Не удалось создать запись. Попробуйте еще раз";
  }
  return CONNECTION_HINT;
}

export interface MyRecordSubmission {
  status: MyRecordStatus;
  /** Booking-refusal message for the booking-error block (US-3). */
  error: string | null;
  /** Resolves true on 201 (success screen), false on refusal. */
  submit: (payload: MyRecordCreate) => Promise<boolean>;
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

  return { status, error, submit };
}
