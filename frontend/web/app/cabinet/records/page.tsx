"use client";

import { useState } from "react";
import Link from "next/link";
import { Header } from "../../ui/Header";
import { CabinetLogin } from "../../ui/CabinetLogin";
import { CabinetSessionCard } from "../../ui/CabinetSessionCard";
import { CabinetNav } from "../../ui/CabinetNav";
import { MyRecordCard } from "../../ui/MyRecordCard";
import { ListPagination } from "../../ui/ListPagination";
import { useCabinetAuth } from "../../hooks/useCabinetAuth";
import { useMyRecords } from "../../hooks/useMyRecords";

/**
 * «Мои записи» (#513 Task 7): lesson cards by descending activity start —
 * date, start–end time, service, the client's own comment; a visitor row
 * per seat (name, Russian status label, snapshot price). Anonymous on ANY
 * cabinet section sees the login form and no data (spec С5).
 */
export default function CabinetRecordsPage() {
  const auth = useCabinetAuth();
  const handleLogout = auth.handleLogout;
  const client = auth.session.client;
  const [page, setPage] = useState(1);
  const records = useMyRecords(page, client !== null);

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
            <h1 className="text-2xl font-bold text-ink">Мои записи</h1>

            <div className="mt-6 space-y-4">
              <CabinetSessionCard
                client={client}
                onLogout={() => void handleLogout()}
              />
              <CabinetNav active="records" />
            </div>

            <div className="mt-6">
              {records.isPending ? (
                <p className="text-sm text-ink-mid" data-testid="my-records-loading">
                  Загрузка…
                </p>
              ) : records.error !== null ? (
                <p className="text-sm text-ink-mid" data-testid="my-records-error">
                  Не удалось загрузить записи. Попробуйте позже
                </p>
              ) : records.cards.length === 0 ? (
                <div
                  className="rounded-2xl border border-line bg-white px-4 py-12 text-center"
                  data-testid="my-records-empty"
                >
                  <p className="text-ink-mid">У вас пока нет записей</p>
                  <Link
                    href="/"
                    className="mt-3 inline-block text-brand underline underline-offset-4"
                  >
                    Перейти к бронированию
                  </Link>
                </div>
              ) : (
                <>
                  <ul className="space-y-4">
                    {records.cards.map((record) => (
                      <MyRecordCard key={record.id} record={record} />
                    ))}
                  </ul>
                  <ListPagination
                    page={records.page}
                    pageCount={records.pageCount}
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
