"use client";

import { useEffect, useRef, useState } from "react";
import { AuthMethodPicker } from "./AuthMethodPicker";
import { AuthCallScreen } from "./AuthCallScreen";
import { AuthContactChannels } from "./AuthContactChannels";
import { OtpStep } from "./OtpStep";
import { useAuthMethods } from "@/app/hooks/useAuthMethods";
import { useCallAuth } from "@/app/hooks/useCallAuth";
import type { CallAuth, CallAuthPhase } from "@/app/hooks/useCallAuth";
import type { OtpLogin } from "@/app/hooks/useOtpLogin";
import type { AuthCallScreenPhase } from "./AuthCallScreen";

/** Internal branch of the auth screen. */
type AuthView = "picker" | "sms" | "call";

/** Maps the call hook's phase onto the screen's render phases.
 *
 * - the dead ends pass through;
 * - a retry-initiate in flight keeps the EXPIRED view (its «Позвонить ещё
 *   раз» button goes disabled) until the new check lands;
 * - everything else — `calling`, and `confirmed`/`idle` for their single
 *   frame before the parent continues its flow — renders the live screen.
 */
export function toScreenPhase(phase: CallAuthPhase): AuthCallScreenPhase {
  if (phase === "expired" || phase === "invalid") return phase;
  if (phase === "initiating") return "expired";
  return "calling";
}

export interface AuthScreenProps {
  /** The phone being confirmed (existing field's value; normalized per method). */
  phone: string;
  /** «Связаться» prefilled text: booking — the request details; cabinet — a greeting. */
  contactMessage: string;
  /** The SMS-branch hook instance (useOtpLogin from the caller — shared wiring). */
  otp: OtpLogin;
  /** The SMS code step's verify — the caller continues its own flow. */
  onSmsVerify: (code: string) => void;
  /** The call branch confirmed — the session cookie is already set by the poll. */
  onCallConfirmed: () => void;
  /** Back to the caller's surface (booking form / cabinet phone form). */
  onBack: () => void;
}

/**
 * The single client-auth screen (#593 §Фронт web) shared by the booking form
 * (BookingActivityOverlay's `auth` step) and the cabinet login: the method
 * picker (honest registry), the SMS-code branch (the existing OtpStep), the
 * call-check branch (AuthCallScreen with its poll), and the always-available
 * «Связаться» panel. The two call sites differ ONLY in context: the
 * prefilled contact message and the post-`confirmed` continuation.
 */
export function AuthScreen({
  phone,
  contactMessage,
  otp,
  onSmsVerify,
  onCallConfirmed,
  onBack,
}: AuthScreenProps) {
  const registry = useAuthMethods();
  const call: CallAuth = useCallAuth();
  const [view, setView] = useState<AuthView>("picker");
  const [contactOpen, setContactOpen] = useState(false);

  // `confirmed` continues the caller's flow exactly once per check (handle):
  // the parent unmounts this screen as it switches its own step.
  const firedHandleRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      call.phase === "confirmed" &&
      call.call !== null &&
      firedHandleRef.current !== call.call.handle
    ) {
      firedHandleRef.current = call.call.handle;
      onCallConfirmed();
    }
  }, [call.phase, call.call, onCallConfirmed]);

  const handleSelectCall = async () => {
    const ok = await call.initiate(phone);
    if (ok) setView("call");
    // A refusal keeps the picker with the step-local error (503/429/422 —
    // the server's structured text via the existing channel).
  };

  const backToPicker = () => {
    call.reset();
    setView("picker");
  };

  // The call screen lives only with an active check; a failed «Позвонить ещё
  // раз» drops back to the picker with the error.
  const showCall = view === "call" && call.call !== null;
  const showSms = view === "sms" && !showCall;

  return (
    <div>
      {showCall && call.call !== null ? (
        <AuthCallScreen
          phone={call.call.phone}
          pretty={call.call.pretty}
          secondsLeft={call.secondsLeft}
          phase={toScreenPhase(call.phase)}
          initiating={call.phase === "initiating"}
          onRetry={() => void call.retry()}
          onRestart={backToPicker}
          onOtherMethod={backToPicker}
        />
      ) : showSms ? (
        <OtpStep
          phone={phone}
          requesting={otp.stage === "requesting"}
          codeSent={otp.stage === "entering" || otp.stage === "verifying"}
          verifying={otp.stage === "verifying"}
          error={otp.error}
          devCode={otp.devCode}
          onRequestCode={() => void otp.requestCode(phone)}
          onVerify={onSmsVerify}
          onBack={backToPicker}
        />
      ) : (
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
            <h2 className="text-xl font-semibold text-[#1a1a1a]">
              Подтвердите телефон
            </h2>
          </div>

          <p className="text-sm text-[#555555] mb-6">
            Выберите, как подтвердить телефон{" "}
            <span className="font-medium text-[#1a1a1a]">{phone}</span>
          </p>

          <AuthMethodPicker
            methods={registry.methods}
            loading={registry.isPending}
            onSelectCall={() => void handleSelectCall()}
            onSelectSms={() => setView("sms")}
          />

          {call.error && (
            <p
              data-testid="otp-step-error"
              className="text-sm text-[#C8503C] mt-4"
              role="alert"
            >
              {call.error}
            </p>
          )}
        </div>
      )}

      {/* «Связаться» — always on the auth screen (#593): who cannot log in
          still reaches the administrator. */}
      <div className="mt-6 pt-6 border-t border-[#E0E0E1]">
        <button
          type="button"
          onClick={() => setContactOpen((prev) => !prev)}
          className="text-sm text-[#004D56] underline underline-offset-2 hover:opacity-80 transition"
          aria-expanded={contactOpen}
        >
          Связаться
        </button>
        {contactOpen && <div className="mt-3"><AuthContactChannels message={contactMessage} /></div>}
      </div>
    </div>
  );
}

export default AuthScreen;
