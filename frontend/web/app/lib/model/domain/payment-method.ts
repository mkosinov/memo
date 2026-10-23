import type { PaymentMethod } from "@memo/api-client";

/** Russian labels for the payment method (#513 spec §«Экраны веб-кабинета»):
 * the exact wording the spec pins — keep verbatim. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
};

/** `method` is nullable by model (the payment was taken before the method
 * was recorded) — the screen label for the unset case, spec-verbatim. */
export const PAYMENT_METHOD_UNSET_LABEL = "Способ не указан";
