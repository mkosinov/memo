"use client";

import type { FormEvent } from "react";
import { Button } from "./Button";
import { OtpStep } from "./OtpStep";
import type { CabinetAuth } from "../hooks/useCabinetAuth";

export interface CabinetLoginProps {
  auth: CabinetAuth;
}

/** The anonymous branch of the cabinet (#523): the phone form → the SAME
 * «Подтвердите телефон» OTP step as the booking form. Rendered by /cabinet
 * and every cabinet section for an anonymous visitor (#513: no data). */
export function CabinetLogin({ auth }: CabinetLoginProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    auth.submitPhone();
  };

  if (auth.step === "otp") {
    return (
      <OtpStep
        phone={auth.phone}
        requesting={auth.otp.stage === "requesting"}
        codeSent={auth.otp.stage === "entering" || auth.otp.stage === "verifying"}
        verifying={auth.otp.stage === "verifying"}
        error={auth.otp.error}
        devCode={auth.otp.devCode}
        onRequestCode={() => void auth.otp.requestCode(auth.phone)}
        onVerify={auth.verifyCode}
        onBack={auth.backToPhone}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-ink-mid mb-1">
          Номер телефона
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={auth.phone}
          onChange={(e) => auth.setPhone(e.target.value)}
          placeholder="+7 (999) 999-99-99"
          className="w-full px-4 py-3 rounded-lg border border-line bg-white text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <Button variant="primary" size="lg" className="w-full" type="submit">
        Войти
      </Button>
    </form>
  );
}

export default CabinetLogin;
