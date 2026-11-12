"use client";

import type { FormEvent } from "react";
import { Button } from "./Button";
import { AuthScreen } from "./AuthScreen";
import { AuthMethodPicker } from "./AuthMethodPicker";
import type { CabinetAuth } from "../hooks/useCabinetAuth";
import { useAuthMethods } from "../hooks/useAuthMethods";

/** The cabinet's «Связаться» text (#593): a simple greeting — no booking
 * context exists here (contrast with the booking form's request details). */
const CABINET_CONTACT_MESSAGE =
  "Здравствуйте! Не удаётся войти в личный кабинет — помогите, пожалуйста.";

export interface CabinetLoginProps {
  auth: CabinetAuth;
}

/** The anonymous branch of the cabinet (#523): the phone form → the SAME
 * auth screen as the booking form (#593: method picker — SMS code or
 * confirmation call). Rendered by /cabinet and every cabinet section for an
 * anonymous visitor (#513: no data).
 *
 * Spec rev.8: the method picker renders ON LOAD, next to the phone field,
 * as a PRECHOICE — «Войти» applies it (no choice → the auth screen's own
 * picker, the former order). */
export function CabinetLogin({ auth }: CabinetLoginProps) {
  // Same query key as the auth screen — react-query dedupes; the auth step
  // then shows the cached registry instantly.
  const registry = useAuthMethods();

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
        initialMethod={auth.preferredMethod}
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

      {/* The method prechoice (rev.8): picker on load, applied by «Войти». */}
      <div className="pt-2 border-t border-line">
        <p className="text-sm font-medium text-ink-mid mb-2">
          Как подтвердить телефон{" "}
          <span className="font-normal text-ink-light">(по умолчанию — спросим после)</span>
        </p>
        <AuthMethodPicker
          methods={registry.methods}
          loading={registry.isPending}
          onSelectCall={() => auth.setPreferredMethod("call")}
          onSelectSms={() => auth.setPreferredMethod("sms")}
          selected={auth.preferredMethod}
        />
      </div>

      <Button variant="primary" size="lg" className="w-full" type="submit">
        Войти
      </Button>
    </form>
  );
}

export default CabinetLogin;
