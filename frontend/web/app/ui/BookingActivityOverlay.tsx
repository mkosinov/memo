"use client";

import type { ActivityView } from "@/app/lib/model/view/activity";
import { useState, useCallback } from "react";
import { Overlay } from "./Overlay";
import { Button } from "./Button";
import { Counter } from "./Counter";
import { ContactForm } from "./ContactForm";

export interface Tariff {
  label: string;
  price: number;
}

export interface BookingActivityOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  activityId: string;
  activities: ActivityView[];
}

function computeTariffs(maxPrice: number): Tariff[] {
  return [
    { label: "Взрослый", price: maxPrice },
    { label: "Детский (5–11 лет)", price: Math.round(maxPrice * 0.7) },
  ];
}

export function BookingActivityOverlay({ isOpen, onClose, activityId, activities }: BookingActivityOverlayProps) {
  const activity = activities.find((a) => a.id === activityId);
  const tariffs = activity ? computeTariffs(activity.priceMax) : [];
  const [counts, setCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(tariffs.map((_, i) => [i, 0])),
  );
  const [isFormValid, setIsFormValid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const total = tariffs.reduce(
    (sum, tariff, i) => sum + counts[i] * tariff.price,
    0,
  );
  const totalCount = Object.values(counts).reduce((sum, c) => sum + c, 0);
  const canSubmit = totalCount > 0 && isFormValid && !!activity;

  const handleValidityChange = useCallback((valid: boolean) => {
    setIsFormValid(valid);
  }, []);

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
            <p className="text-sm">{time} · {activity.location.name}</p>
            <p className="text-sm">
              {tariffs
                .filter((_, i) => counts[i] > 0)
                .map((tariff, i) => `${tariff.label}: ${counts[i]}`)
                .join(" · ")}
            </p>
            <p className="text-lg font-semibold text-[#1a1a1a] mt-2">
              Итого: {total.toLocaleString("ru-RU")} ₽
            </p>
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
          <p className="text-sm text-[#555555]">{activity.location.name}</p>
        </div>
      </div>

      {/* Counters */}
      <div className="space-y-4 mb-6">
        {tariffs.map((tariff, index) => (
          <Counter
            key={tariff.label}
            label={tariff.label}
            subLabel={`${tariff.price.toLocaleString("ru-RU")} ₽`}
            value={counts[index]}
            onChange={(value) => setCounts((prev) => ({ ...prev, [index]: value }))}
            min={0}
          />
        ))}
      </div>

      {/* Total */}
      <div className="text-lg font-semibold text-[#1a1a1a] mb-6">
        Итого: {total.toLocaleString("ru-RU")} ₽
      </div>

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
