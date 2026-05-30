import { useState, useEffect, useCallback } from "react";
import { isValidPhoneNumber } from "libphonenumber-js";

export interface ContactFormProps {
  onValidityChange?: (isValid: boolean) => void;
  submitted?: boolean;
  /** Controlled value for name (overrides internal state) */
  name?: string;
  onNameChange?: (name: string) => void;
  /** Controlled value for phone (overrides internal state) */
  phone?: string;
  onPhoneChange?: (phone: string) => void;
  /** Controlled value for confirmation method (overrides internal state) */
  confirmation?: string;
  onConfirmationChange?: (method: string) => void;
}

const CONFIRMATION_OPTIONS = [
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "max", label: "Max" },
] as const;

export function ContactForm({ onValidityChange, submitted, name: controlledName, onNameChange, phone: controlledPhone, onPhoneChange, confirmation: controlledConfirmation, onConfirmationChange }: ContactFormProps) {
  const [internalName, setInternalName] = useState("");
  const [internalPhone, setInternalPhone] = useState("");
  const [comment, setComment] = useState("");
  const [internalConfirmation, setInternalConfirmation] = useState("telegram");

  const name = controlledName ?? internalName;
  const phone = controlledPhone ?? internalPhone;
  const confirmation = controlledConfirmation ?? internalConfirmation;
  const setName = onNameChange ?? setInternalName;
  const setPhone = onPhoneChange ?? setInternalPhone;
  const setConfirmation = onConfirmationChange ?? setInternalConfirmation;

  const isValid =
    name.trim().length >= 2 &&
    isValidPhoneNumber(phone, "RU") &&
    confirmation !== "";

  const notifyValidity = useCallback(
    (valid: boolean) => {
      onValidityChange?.(valid);
    },
    [onValidityChange],
  );

  useEffect(() => {
    notifyValidity(isValid);
  }, [isValid, notifyValidity]);

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label
          htmlFor="contact-name"
          className="block text-sm font-medium text-[#555555] mb-1"
        >
          Имя
        </label>
        <input
          id="contact-name"
          type="text"
          placeholder="Имя"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={[
            "w-full rounded-lg border px-3 py-2 text-sm transition",
            "border-[#E0E0E1] text-[#1a1a1a] placeholder-[#cccccc]",
            "focus:border-[#004D56] focus:outline-none",
            (
              (name.length > 0 || submitted) && name.trim().length < 2
            ) ? "border-[#C8503C]" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {((name.length > 0 || submitted) && name.trim().length < 2) && (
          <p className="text-xs text-[#C8503C] mt-1">
            {name.trim().length === 0 ? "Обязательное поле" : "Минимум 2 символа"}
          </p>
        )}
      </div>

      {/* Phone */}
      <div>
        <label
          htmlFor="contact-phone"
          className="block text-sm font-medium text-[#555555] mb-1"
        >
          Телефон
        </label>
        <input
          id="contact-phone"
          type="tel"
          placeholder="Телефон"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={[
            "w-full rounded-lg border px-3 py-2 text-sm transition",
            "border-[#E0E0E1] text-[#1a1a1a] placeholder-[#cccccc]",
            "focus:border-[#004D56] focus:outline-none",
            (
              (phone.length > 0 || submitted) && !isValidPhoneNumber(phone, "RU")
            ) ? "border-[#C8503C]" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {((phone.length > 0 || submitted) && !isValidPhoneNumber(phone, "RU")) && (
          <p className="text-xs text-[#C8503C] mt-1">
            {phone.trim().length === 0
              ? "Обязательное поле"
              : "Неверный формат номера"}
          </p>
        )}
      </div>

      {/* Comment */}
      <div>
        <label
          htmlFor="contact-comment"
          className="block text-sm font-medium text-[#555555] mb-1"
        >
          Комментарий{" "}
          <span className="text-[#cccccc] font-normal">(необязательно)</span>
        </label>
        <textarea
          id="contact-comment"
          placeholder="Комментарий"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-[#E0E0E1] px-3 py-2 text-sm text-[#1a1a1a] placeholder-[#cccccc] transition focus:border-[#004D56] focus:outline-none resize-none"
        />
      </div>

      {/* Confirmation */}
      <div>
        <label
          htmlFor="contact-confirm"
          className="block text-sm font-medium text-[#555555] mb-1"
        >
          Отправить детали записи в:
        </label>
        <select
          id="contact-confirm"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className="w-full rounded-lg border border-[#E0E0E1] px-3 py-2 text-sm text-[#1a1a1a] transition focus:border-[#004D56] focus:outline-none"
        >
          {CONFIRMATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default ContactForm;
