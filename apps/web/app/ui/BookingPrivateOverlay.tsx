"use client";

import { useState, useCallback, useEffect } from "react";
import { Overlay } from "./Overlay";
import { Button } from "./Button";
import { ContactForm } from "./ContactForm";
import { createPrivateBookingView } from "@/app/lib/model/view/booking";
import type { PrivateBookingView } from "@/app/lib/model/view/booking";

const MATERIAL_OPTIONS = [
  "Не определились",
  "Акрил",
  "Масло",
  "Акварель",
  "Керамика",
] as const;

export interface BookingPrivateOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  preferredDate?: string;
  preferredLocation?: string;
}

export function BookingPrivateOverlay({ isOpen, onClose, preferredDate, preferredLocation }: BookingPrivateOverlayProps) {
  const [booking, setBooking] = useState<PrivateBookingView>(() =>
    createPrivateBookingView(preferredDate, preferredLocation),
  );
  const [isFormValid, setIsFormValid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Reset model when overlay opens with new pre-fill
  useEffect(() => {
    if (isOpen) {
      setBooking(createPrivateBookingView(preferredDate, preferredLocation));
      setIsSuccess(false);
      setSubmitted(false);
    }
  }, [isOpen, preferredDate, preferredLocation]);

  const individualFieldsValid = booking.date !== "" && booking.time !== "";
  const canSubmit = isFormValid && individualFieldsValid;

  const handleValidityChange = useCallback((valid: boolean) => {
    setIsFormValid(valid);
  }, []);

  const updateModel = useCallback((patch: Partial<PrivateBookingView>) => {
    setBooking((prev) => ({ ...prev, ...patch }));
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

  if (isSuccess) {
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
            <p className="text-base">Индивидуальный мастер-класс</p>
            <p className="text-sm">{booking.date} {booking.time}</p>
            <p className="text-sm">Материал: {booking.material}</p>
            <p className="text-lg font-semibold text-[#1a1a1a] mt-2">
              Итого: {booking.price.toLocaleString("ru-RU")} ₽
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
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Индивидуальный мастер-класс</h2>
      </div>

      {/* Activity summary */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-lg bg-[#004D56]/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-8 h-8 text-[#004D56]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-medium text-[#1a1a1a]">Индивидуальный мастер-класс</h3>
          <p className="text-sm text-[#555555]">В удобное для вас время</p>
          <p className="text-sm text-[#555555]">Любая студия</p>
        </div>
      </div>

      {/* Date, time, material */}
      <div className="space-y-4 mb-6">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-[#555555] mb-1">Дата</label>
            <input
              type="date"
              value={booking.date}
              onChange={(e) => updateModel({ date: e.target.value })}
              className={[
                "w-full rounded-lg border px-3 py-2 text-sm transition",
                "border-[#E0E0E1] text-[#1a1a1a]",
                "focus:border-[#004D56] focus:outline-none",
                submitted && !booking.date ? "border-[#C8503C]" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
            {submitted && !booking.date && (
              <p className="text-xs text-[#C8503C] mt-1">Обязательное поле</p>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-[#555555] mb-1">Время</label>
            <input
              type="time"
              value={booking.time}
              onChange={(e) => updateModel({ time: e.target.value })}
              className={[
                "w-full rounded-lg border px-3 py-2 text-sm transition",
                "border-[#E0E0E1] text-[#1a1a1a]",
                "focus:border-[#004D56] focus:outline-none",
                submitted && !booking.time ? "border-[#C8503C]" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
            {submitted && !booking.time && (
              <p className="text-xs text-[#C8503C] mt-1">Обязательное поле</p>
            )}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[#555555] mb-1">
            Материал
          </label>
          <select
            value={booking.material}
            onChange={(e) => updateModel({ material: e.target.value })}
            className="w-full rounded-lg border border-[#E0E0E1] px-3 py-2 text-sm text-[#1a1a1a] transition focus:border-[#004D56] focus:outline-none"
          >
            {MATERIAL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Total + footnote */}
      <div className="mb-6">
        <div className="text-lg font-semibold text-[#1a1a1a]">
          Итого: {booking.price.toLocaleString("ru-RU")} ₽
        </div>
        <p className="text-xs text-[#888888] mt-1">
          Стоимость указана на 1 участника. Дополнительные гости — по стандартным тарифам (зависит от материала)
        </p>
      </div>

      {/* Contact form — controlled via model */}
      <div className="mb-6">
        <ContactForm
          onValidityChange={handleValidityChange}
          submitted={submitted}
          name={booking.name}
          onNameChange={(n) => updateModel({ name: n })}
          phone={booking.phone}
          onPhoneChange={(p) => updateModel({ phone: p })}
          confirmation={booking.confirmationMethod}
          onConfirmationChange={(m) => updateModel({ confirmationMethod: m as PrivateBookingView["confirmationMethod"] })}
        />
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

export default BookingPrivateOverlay;
