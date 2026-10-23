"use client";

import { useState } from "react";
import { Header } from "../../ui/Header";
import { CabinetLogin } from "../../ui/CabinetLogin";
import { CabinetSessionCard } from "../../ui/CabinetSessionCard";
import { CabinetNav } from "../../ui/CabinetNav";
import { MyPaymentRow } from "../../ui/MyPaymentRow";
import { ListPagination } from "../../ui/ListPagination";
import { useCabinetAuth } from "../../hooks/useCabinetAuth";
import { useMyPayments } from "../../hooks/useMyPayments";

/**
 * «Мои платежи» (#513 Task 9): the client's payment history as rows —
 * amount, Russian method label (`cash` → «Наличные», `card` → «Карта»,
 * `transfer` → «Перевод», null → «Способ не указан»), the payment's own
 * date, and the lesson context from the always-present record (service
 * title + lesson date). Anonymous on ANY cabinet section sees the login
 * form and no data (spec С5).
 */
export default function CabinetPaymentsPage() {
  const auth = useCabinetAuth();
  const handleLogout = auth.handleLogout;
  const client = auth.session.client;
  const [page, setPage] = useState(1);
  const payments = useMyPayments(page, client !== null);

  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20 max-w-2xl mx-auto">
        {client === null ? (
          <>
            <h1 className="text-2xl font-bold text-ink">Личный кабинет</h1>
            {auth.session.status === "checking" ? (
              <p className="mt-6 text-sm text-ink-mid" data-testid="cabinet-checking">
                Загрузка…
              </p>
            ) : (
              <CabinetLogin auth={auth} />
            )}
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-ink">Мои платежи</h1>

            <div className="mt-6 space-y-4">
              <CabinetSessionCard
                client={client}
                onLogout={() => void handleLogout()}
              />
              <CabinetNav active="payments" />
            </div>

            <div className="mt-6">
              {payments.isPending ? (
                <p className="text-sm text-ink-mid" data-testid="my-payments-loading">
                  Загрузка…
                </p>
              ) : payments.error !== null ? (
                <p className="text-sm text-ink-mid" data-testid="my-payments-error">
                  Не удалось загрузить платежи. Попробуйте позже
                </p>
              ) : payments.rows.length === 0 ? (
                <div
                  className="rounded-2xl border border-line bg-white px-4 py-12 text-center"
                  data-testid="my-payments-empty"
                >
                  <p className="text-ink-mid">У вас пока нет платежей</p>
                </div>
              ) : (
                <>
                  <ul className="space-y-3">
                    {payments.rows.map((payment) => (
                      <MyPaymentRow key={payment.id} payment={payment} />
                    ))}
                  </ul>
                  <ListPagination
                    page={payments.page}
                    pageCount={payments.pageCount}
                    onChange={setPage}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
