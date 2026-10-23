"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Header } from "../ui/Header";
import { CabinetLogin } from "../ui/CabinetLogin";
import { useCabinetAuth } from "../hooks/useCabinetAuth";

/**
 * «Личный кабинет» entry (#523 shell + #513 Task 7): anonymous — the
 * phone → code login (the SAME «Подтвердите телефон» step as the booking
 * form); authenticated — a redirect to the first section, /cabinet/records.
 */
export default function CabinetPage() {
  const auth = useCabinetAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.session.status === "authenticated") {
      router.replace("/cabinet/records");
    }
  }, [auth.session.status, router]);

  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20 max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-ink">Личный кабинет</h1>

        {auth.session.status === "anonymous" || auth.session.status === "error" ? (
          <CabinetLogin auth={auth} />
        ) : (
          // Session check in flight, or the redirect to /cabinet/records
          // already fired — either way a brief loader frame.
          <p className="mt-6 text-sm text-ink-mid" data-testid="cabinet-checking">
            Загрузка…
          </p>
        )}
      </div>
    </main>
  );
}
