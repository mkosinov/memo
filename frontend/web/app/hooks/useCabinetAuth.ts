"use client";

import { useState } from "react";
import { logout } from "@memo/api-client";
import { isValidPhoneNumber } from "libphonenumber-js";
import { useClientSession } from "./useClientSession";
import type { ClientSession } from "./useClientSession";
import { useOtpLogin } from "./useOtpLogin";
import type { OtpLogin } from "./useOtpLogin";

/** The cabinet login/logout wiring (#523 shell, extracted for reuse by the
 * section screens #513): session detection + the phone → auth step flow +
 * logout. Pure wiring — the markup lives in CabinetLogin/CabinetSessionCard.
 * The step was renamed `otp` → `auth` (#593): several methods, not only the
 * one-time password. */
export interface CabinetAuth {
  session: ClientSession;
  otp: OtpLogin;
  /** Login sub-step: the phone form or the auth screen (method picker). */
  step: "login" | "auth";
  phone: string;
  setPhone: (phone: string) => void;
  /** Phone-form submit: a valid RU phone advances to the auth screen. */
  submitPhone: () => void;
  /** Back from the auth screen to the phone form. */
  backToPhone: () => void;
  /** Auth confirmed (any method) — refresh the session; the screen flips. */
  handleAuthConfirmed: () => void;
  /** OTP verify — on success refreshes the session (screen flips). */
  verifyCode: (code: string) => Promise<void>;
  /** «Выйти»: drops the session cookie and returns to the login form. */
  handleLogout: () => Promise<void>;
}

export function useCabinetAuth(): CabinetAuth {
  const session = useClientSession(true);
  const otp = useOtpLogin();
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"login" | "auth">("login");

  const submitPhone = () => {
    if (!isValidPhoneNumber(phone, "RU")) return;
    setStep("auth");
  };

  const backToPhone = () => {
    otp.reset();
    setStep("login");
  };

  /** The call branch confirmed (#593): the status poll already set the
   * client-session cookie — refresh and let the redirect take over. */
  const handleAuthConfirmed = () => {
    void session.refresh();
  };

  const verifyCode = async (code: string) => {
    const verified = await otp.verify(phone, code);
    if (verified) void session.refresh();
  };

  const handleLogout = async () => {
    await logout();
    otp.reset();
    setPhone("");
    setStep("login");
    void session.refresh();
  };

  return {
    session,
    otp,
    step,
    phone,
    setPhone,
    submitPhone,
    backToPhone,
    handleAuthConfirmed,
    verifyCode,
    handleLogout,
  };
}
