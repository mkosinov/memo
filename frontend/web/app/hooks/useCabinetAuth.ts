"use client";

import { useState } from "react";
import { logout } from "@memo/api-client";
import { isValidPhoneNumber } from "libphonenumber-js";
import { useClientSession } from "./useClientSession";
import type { ClientSession } from "./useClientSession";
import { useOtpLogin } from "./useOtpLogin";
import type { OtpLogin } from "./useOtpLogin";

/** The cabinet login/logout wiring (#523 shell, extracted for reuse by the
 * section screens #513): session detection + the phone → OTP step flow +
 * logout. Pure wiring — the markup lives in CabinetLogin/CabinetSessionCard. */
export interface CabinetAuth {
  session: ClientSession;
  otp: OtpLogin;
  /** Login sub-step: the phone form or the «Подтвердите телефон» step. */
  step: "login" | "otp";
  phone: string;
  setPhone: (phone: string) => void;
  /** Phone-form submit: a valid RU phone advances to the OTP step. */
  submitPhone: () => void;
  /** Back from the OTP step to the phone form. */
  backToPhone: () => void;
  /** OTP verify — on success refreshes the session (screen flips). */
  verifyCode: (code: string) => Promise<void>;
  /** «Выйти»: drops the session cookie and returns to the login form. */
  handleLogout: () => Promise<void>;
}

export function useCabinetAuth(): CabinetAuth {
  const session = useClientSession(true);
  const otp = useOtpLogin();
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"login" | "otp">("login");

  const submitPhone = () => {
    if (!isValidPhoneNumber(phone, "RU")) return;
    setStep("otp");
  };

  const backToPhone = () => {
    otp.reset();
    setStep("login");
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
    verifyCode,
    handleLogout,
  };
}
