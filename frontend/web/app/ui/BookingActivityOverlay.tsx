"use client";

import type { ActivityView } from "@/app/lib/model/view/activity";
import { useState, useCallback } from "react";
import { Overlay } from "./Overlay";
import { Button } from "./Button";
import { Counter } from "./Counter";
import { ContactForm } from "./ContactForm";

/** State of the tariffs data (#499): drives loading/error blocks in place of counters. */
export type TariffsStatus = "ready" | "loading" | "error";

export interface BookingActivityOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  activityId: string;
  activities: ActivityView[];
  tariffsStatus?: TariffsStatus;
}

interface SeatCounter {
  id: string;
  label: string;
  price: number;
  testId?: string;
}

/** One row of the optional visitors-names table: a seat with its read-only tariff. */
interface VisitorRow {
  key: string;
  tariffLabel: string;
}

interface VisitorName {
  name: string;
  age: string;
}

/** Counter key for tariff-free services: a single unnamed seats counter (US-2). */
const SEATS_KEY = "seats";
const SEATS_LABEL = "Места";
const NO_TARIFF_LABEL = "—";

function formatPrice(price: number): string {
  return `${price.toLocaleString("ru-RU")} ₽`;
}

export function BookingActivityOverlay({
  isOpen,
  onClose,
  activityId,
  activities,
  tariffsStatus = "ready",
}: BookingActivityOverlayProps) {
  const activity = activities.find((a) => a.id === activityId);
  const tariffs = activity?.tariffs ?? [];
  const hasTariffs = tariffs.length > 0;

  // One counter per tariff (US-1); tariff-free service gets a single seats counter (US-2).
  const counters: SeatCounter[] = hasTariffs
    ? tariffs.map((t) => ({
        id: t.id,
        label: t.title,
        price: t.price,
        testId: `tariff-counter-${t.id}`,
      }))
    : [{ id: SEATS_KEY, label: SEATS_LABEL, price: 0 }];

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [visitors, setVisitors] = useState<Record<string, VisitorName>>({});
  const [showVisitors, setShowVisitors] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const total = counters.reduce(
    (sum, counter) => sum + (counts[counter.id] ?? 0) * counter.price,
    0,
  );
  const totalCount = counters.reduce(
    (sum, counter) => sum + (counts[counter.id] ?? 0),
    0,
  );
  const tariffsReady = tariffsStatus === "ready";
  const canSubmit = totalCount > 0 && isFormValid && !!activity && tariffsReady;

  /** One row per selected seat; the trailing seats of each counter keep a stable key. */
  const visitorRows: VisitorRow[] = hasTariffs
    ? tariffs.flatMap((t) =>
        Array.from({ length: counts[t.id] ?? 0 }, (_, k) => ({
          key: `${t.id}#${k}`,
          tariffLabel: t.title,
        })),
      )
    : Array.from({ length: counts[SEATS_KEY] ?? 0 }, (_, k) => ({
        key: `${SEATS_KEY}#${k}`,
        tariffLabel: NO_TARIFF_LABEL,
      }));

  const handleValidityChange = useCallback((valid: boolean) => {
    setIsFormValid(valid);
  }, []);

  const handleCountChange = (counterId: string, value: number) => {
    setCounts((prev) => ({ ...prev, [counterId]: value }));
  };

  const handleVisitorChange = (rowKey: string, field: keyof VisitorName, value: string) => {
    setVisitors((prev) => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] ?? { name: "", age: "" }), [field]: value },
    }));
  };

  const handleSubmit = () => {
    setSubmitted(true);
    if (canSubmit) {
      setIsSuccess(true);
    }
  };

  const handleBack = () => {
    onClose();
  };

  if (!activity) return null;

  if (isSuccess) {
    const time = `${activity.dateFormatted}, ${activity.time}`;
    return (
      <Overlay isOpen={isOpen} onClose={onClose} size="full">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          {/* Palette icon */}
          <div className="w-20 h-20 rounded-full bg-[#004D56] flex items-center justify-center mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-10 h-10 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
              />
            </svg>
          </div>

          <h2 className="text-2xl font-semibold text-[#1a1a1a] mb-2">Вы записаны!</h2>

          <div className="space-y-1 text-[#555555] mb-8">
            <p className="text-base">{activity.title}</p>
            <p className="text-sm">{time} · {activity.location.title}</p>
            <p className="text-sm">
              {hasTariffs
                ? tariffs
                    .filter((t) => (counts[t.id] ?? 0) > 0)
                    .map((t) => `${t.title}: ${counts[t.id]}`)
                    .join(" · ")
                : `${SEATS_LABEL}: ${totalCount}`}
            </p>
            {hasTariffs ? (
              <p className="text-lg font-semibold text-[#1a1a1a] mt-2">
                Итого: {formatPrice(total)}
              </p>
            ) : (
              <p className="text-lg font-semibold text-[#1a1a1a] mt-2">
                Стоимость уточняется
              </p>
            )}
          </div>

          <Button variant="primary" size="lg" onClick={onClose}>
            Готово
          </Button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="full">
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleBack}
          className="text-[#555555] hover:text-[#1a1a1a] text-xl transition"
          aria-label="Назад"
        >
          ←
        </button>
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Оформление записи</h2>
      </div>

      {/* Activity summary */}
      <div className="flex items-center gap-4 mb-6">
        <img
          src={activity.imageUrl}
          alt={activity.title}
          className="w-16 h-16 rounded-lg object-cover"
        />
        <div>
          <h3 className="text-base font-medium text-[#1a1a1a]">{activity.title}</h3>
          <p className="text-sm text-[#555555]">{activity.dateFormatted}, {activity.time}</p>
          <p className="text-sm text-[#555555]">{activity.location.title}</p>
        </div>
      </div>

      {/* Counters / tariffs status */}
      {!tariffsReady ? (
        <div className="mb-6" data-testid={tariffsStatus === "loading" ? "booking-tariffs-loading" : "booking-tariffs-error"}>
          {tariffsStatus === "loading" ? (
            <p className="text-sm text-[#555555]">Загрузка тарифов…</p>
          ) : (
            <p className="text-sm text-[#C8503C]">
              Не удалось загрузить тарифы. Попробуйте позже.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-6">
            {counters.map((counter) => (
              <Counter
                key={counter.id}
                label={counter.label}
                subLabel={hasTariffs ? formatPrice(counter.price) : undefined}
                testId={counter.testId}
                value={counts[counter.id] ?? 0}
                onChange={(value) => handleCountChange(counter.id, value)}
                min={0}
              />
            ))}
          </div>

          {/* Visitors names table toggle */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowVisitors((prev) => !prev)}
              className="text-sm text-[#004D56] underline underline-offset-2 hover:opacity-80 transition"
            >
              Указать имена посетителей
            </button>
          </div>

          {showVisitors && (
            <div className="mb-6">
              <table
                data-testid="visitors-names-table"
                className="w-full text-sm border-collapse"
              >
                <thead>
                  <tr className="text-left text-[#888888]">
                    <th className="py-1 pr-2 font-medium">Имя</th>
                    <th className="py-1 pr-2 font-medium">Возраст</th>
                    <th className="py-1 font-medium">Тариф</th>
                  </tr>
                </thead>
                <tbody>
                  {visitorRows.map((row) => (
                    <tr key={row.key} className="border-t border-[#E0E0E1]/60">
                      <td className="py-1.5 pr-2">
                        <input
                          type="text"
                          aria-label="Имя посетителя"
                          placeholder="Имя"
                          value={visitors[row.key]?.name ?? ""}
                          onChange={(e) => handleVisitorChange(row.key, "name", e.target.value)}
                          className="w-full rounded-lg border border-[#E0E0E1] px-2 py-1.5 text-sm text-[#1a1a1a] placeholder-[#cccccc] transition focus:border-[#004D56] focus:outline-none"
                        />
                      </td>
                      <td className="py-1.5 pr-2 w-24">
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Возраст посетителя"
                          placeholder="Возраст"
                          value={visitors[row.key]?.age ?? ""}
                          onChange={(e) => handleVisitorChange(row.key, "age", e.target.value)}
                          className="w-full rounded-lg border border-[#E0E0E1] px-2 py-1.5 text-sm text-[#1a1a1a] placeholder-[#cccccc] transition focus:border-[#004D56] focus:outline-none"
                        />
                      </td>
                      {/* Read-only tariff column */}
                      <td className="py-1.5 text-[#555555]">{row.tariffLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-[#888888] mt-2">
                Пустые имена останутся анонимными — уточним детали на месте.
              </p>
            </div>
          )}

          {/* Total / price hint */}
          {hasTariffs ? (
            <div className="text-lg font-semibold text-[#1a1a1a] mb-6">
              Итого: {formatPrice(total)}
            </div>
          ) : (
            <div
              data-testid="booking-price-hint"
              className="text-sm text-[#555555] mb-6"
            >
              Стоимость уточняется
            </div>
          )}
        </>
      )}

      {/* Contact form */}
      <div className="mb-6">
        <ContactForm onValidityChange={handleValidityChange} submitted={submitted} />
      </div>

      {/* Submit button */}
      <Button
        variant="primary"
        size="lg"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full"
      >
        Записаться
      </Button>
    </Overlay>
  );
}

export default BookingActivityOverlay;
