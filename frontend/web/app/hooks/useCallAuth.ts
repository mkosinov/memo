"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { initiateCallAuth, callAuthStatus, ApiError } from "@memo/api-client";
import { structuredServerMessage } from "@/app/lib/errors";
import { toCanonicalPhone } from "@/app/lib/model/domain/phones";
import { OTP_UNAVAILABLE_MESSAGE, OTP_FAILURE_MESSAGE } from "./useOtpLogin";

/**
 * The «подтвердить звонком» branch of the auth screen (#593 spec §Фронт web).
 *
 * initiate → the call screen (number + countdown) → ~4 s status poll until a
 * terminal state. The poll result BEATS the countdown: `confirmed` applies
 * even after the local window display ran out (the last-second call). A 404
 * (handle consumed/replaced) is the `invalid` dead end — «Начать заново».
 */

/** Poll cadence (#593 §Фронт web): «опрос ~4 с». */
const POLL_INTERVAL_MS = 4000;

/** Phases of the call branch; `calling` is the live call screen. */
export type CallAuthPhase =
  | "idle" // picker visible
  | "initiating" // initiate request in flight
  | "calling" // call screen: number, countdown, poll on
  | "confirmed" // session cookie is set — caller continues the flow
  | "expired" // window ran out (countdown or poll) — «Позвонить ещё раз»
  | "invalid"; // 404: handle consumed/replaced — «Начать заново»

/** The active check as the call screen renders it. */
export interface CallAuthInfo {
  /** Raw one-time status handle — never displayed, only polled. */
  handle: string;
  /** The number the CLIENT calls, strictly `+7XXXXXXXXXX` (tel: href). */
  phone: string;
  /** Display form, e.g. `+7 999 555-22-55`. */
  pretty: string;
  /** Window deadline, ms epoch. */
  expiresAt: number;
}

function callErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return OTP_UNAVAILABLE_MESSAGE;
    return structuredServerMessage(err, OTP_FAILURE_MESSAGE);
  }
  return OTP_FAILURE_MESSAGE;
}

export interface CallAuth {
  phase: CallAuthPhase;
  /** Step-local initiate error (server structured text; 503 → unavailable). */
  error: string | null;
  /** The active check; null until a successful initiate. */
  call: CallAuthInfo | null;
  /** Whole seconds until `expiresAt` while calling/expired (mm:ss display). */
  secondsLeft: number | null;
  /** Canonicalize + initiate. Resolves false → `error` is set. */
  initiate: (phone: string) => Promise<boolean>;
  /** «Позвонить ещё раз»: a fresh initiate of the same phone (new handle+window). */
  retry: () => Promise<boolean>;
  /** Back to the picker: drop the check, stop polling. */
  reset: () => void;
}

export function useCallAuth(): CallAuth {
  const [phase, setPhase] = useState<CallAuthPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [call, setCall] = useState<CallAuthInfo | null>(null);
  const [lastPhone, setLastPhone] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ── Status poll (~4 s; stops on terminal results and 404) ────────────────
  // Stays enabled one breath past the local countdown so a late `confirmed`
  // (the last-second call) can still land — the SERVER closes the window, the
  // countdown is only a display. `refetchInterval` functional form per spec.
  const handle = call?.handle ?? null;
  const statusQuery = useQuery({
    queryKey: ["auth-call-status", handle],
    queryFn: () => callAuthStatus(handle as string),
    enabled: handle !== null && (phase === "calling" || phase === "expired"),
    retry: false,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      const status = query.state.data?.status;
      return status === "confirmed" || status === "expired"
        ? false
        : POLL_INTERVAL_MS;
    },
  });

  const status = statusQuery.data?.status;

  // Poll result → phase. `confirmed` always applies (beats the countdown);
  // `expired` never downgrades an already-confirmed check.
  useEffect(() => {
    if (status === "confirmed") {
      setPhase("confirmed");
    } else if (status === "expired") {
      setPhase((prev) => (prev === "confirmed" ? prev : "expired"));
    }
  }, [status]);

  // 404: invalid/consumed/replaced handle — the indistinguishable dead end.
  useEffect(() => {
    if (statusQuery.error instanceof ApiError && statusQuery.error.status === 404) {
      setPhase((prev) => (prev === "confirmed" ? prev : "invalid"));
    }
  }, [statusQuery.error]);

  // ── Visible countdown (мм:сс) ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "calling") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const secondsLeft = call
    ? Math.max(0, Math.ceil((call.expiresAt - now) / 1000))
    : null;

  // Local countdown expiry → expired. A `confirmed` poll still overrides it
  // afterwards (the effect above applies regardless of the current phase).
  useEffect(() => {
    if (phase === "calling" && call !== null && now >= call.expiresAt) {
      setPhase("expired");
    }
  }, [phase, call, now]);

  // ── Initiate ──────────────────────────────────────────────────────────────
  const initiate = useCallback(async (phoneInput: string): Promise<boolean> => {
    setPhase("initiating");
    setError(null);
    const phone = toCanonicalPhone(phoneInput);
    if (phone === null) {
      // The form validates first; this guard keeps the wire canonical.
      setError(OTP_FAILURE_MESSAGE);
      setPhase("idle");
      setCall(null);
      return false;
    }
    setLastPhone(phone);
    try {
      const res = await initiateCallAuth(phone);
      if (res.handle === undefined || res.call === undefined) {
        // The silent staff skip: an indistinguishable empty 202 — nothing was
        // created, there is nothing to poll.
        setError(OTP_FAILURE_MESSAGE);
        setPhase("idle");
        setCall(null);
        return false;
      }
      setNow(Date.now());
      setCall({
        handle: res.handle,
        phone: res.call.phone,
        pretty: res.call.pretty,
        expiresAt: Date.parse(res.call.expires_at),
      });
      setPhase("calling");
      return true;
    } catch (err) {
      setError(callErrorMessage(err));
      setPhase("idle");
      setCall(null);
      return false;
    }
  }, []);

  const retry = useCallback((): Promise<boolean> => {
    if (lastPhone === null) return Promise.resolve(false);
    return initiate(lastPhone);
  }, [initiate, lastPhone]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setCall(null);
  }, []);

  return { phase, error, call, secondsLeft, initiate, retry, reset };
}
