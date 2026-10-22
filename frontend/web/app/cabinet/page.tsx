"use client";

import { useState } from "react";
import { logout } from "@memo/api-client";
import { isValidPhoneNumber } from "libphonenumber-js";
import { Header } from "../ui/Header";
import { Button } from "../ui/Button";
import { OtpStep } from "../ui/OtpStep";
import { useClientSession } from "../hooks/useClientSession";
import { useOtpLogin } from "../hooks/useOtpLogin";

/**
 * «Личный кабинет» (#499 §7): anonymous — the phone → code login (the SAME
 * «Подтвердите телефон» step as the booking form); authenticated — the
 * session phone and «Выйти». No section placeholders (#513).
 */
export default function CabinetPage() {
  const session = useClientSession(true);
  const otp = useOtpLogin();
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"login" | "otp">("login");

  const client = session.status === "authenticated" ? session.client : null;

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhoneNumber(phone, "RU")) return;
    setStep("otp");
  };

  const handleVerify = async (code: string) => {
    const verified = await otp.verify(phone, code);
    if (verified) void session.refresh();
  };

  const handleOtpBack = () => {
    otp.reset();
    setStep("login");
  };

  const handleLogout = async () => {
    await logout();
    otp.reset();
    setPhone("");
    setStep("login");
    void session.refresh();
  };

  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20 max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-ink">Личный кабинет</h1>

        {client !== null ? (
          <div className="mt-6 space-y-4" data-testid="cabinet-logged-in">
            <div className="rounded-lg border border-line bg-white px-4 py-3">
              <p className="text-sm text-ink-mid mb-1">Ваш телефон</p>
              <p data-testid="cabinet-phone" className="text-lg font-medium text-ink">
                {client.phone}
              </p>
            </div>
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => void handleLogout()}
            >
              Выйти
            </Button>
          </div>
        ) : session.status === "checking" ? (
          <p className="mt-6 text-sm text-ink-mid" data-testid="cabinet-checking">
            Загрузка…
          </p>
        ) : step === "otp" ? (
          <div className="mt-6">
            <OtpStep
              phone={phone}
              requesting={otp.stage === "requesting"}
              codeSent={otp.stage === "entering" || otp.stage === "verifying"}
              verifying={otp.stage === "verifying"}
              error={otp.error}
              devCode={otp.devCode}
              onRequestCode={() => void otp.requestCode(phone)}
              onVerify={handleVerify}
              onBack={handleOtpBack}
            />
          </div>
        ) : (
          <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-ink-mid mb-1">
                Номер телефона
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (999) 999-99-99"
                className="w-full px-4 py-3 rounded-lg border border-line bg-white text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <Button variant="primary" size="lg" className="w-full" type="submit">
              Войти
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
