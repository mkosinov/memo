"use client";

import type { FormEvent } from "react";
import { Button } from "./Button";
import { AuthScreen } from "./AuthScreen";
import type { CabinetAuth } from "../hooks/useCabinetAuth";

/** The cabinet's «Связаться» text (#593): a simple greeting — no booking
 * context exists here (contrast with the booking form's request details). */
const CABINET_CONTACT_MESSAGE =
  "Здравствуйте! Не удаётся войти в личный кабинет — помогите, пожалуйста.";

/** The anonymous branch of the cabinet (#523): the phone form → the SAME
 * auth screen as the booking form (#593: method picker — SMS code or
 * confirmation call). Rendered by /cabinet and every cabinet section for an
 * anonymous visitor (#513: no data). */
export function CabinetLogin({ auth }: CabinetLoginProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    auth.submitPhone();
  };

  if (auth.step === "auth") {
    return (
      <AuthScreen
        phone={auth.phone}
        contactMessage={CABINET_CONTACT_MESSAGE}
        otp={auth.otp}
        onSmsVerify={auth.verifyCode}
        onCallConfirmed={auth.handleAuthConfirmed}
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

export interface CabinetLoginProps {
  auth: CabinetAuth;
}

export default CabinetLogin;
