import type { MyPaymentItem } from "@memo/api-client";
import type { MyPaymentRowView } from "@/app/lib/model/view/my-payments";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_UNSET_LABEL,
} from "@/app/lib/model/domain/payment-method";
import { formatDate, formatPrice } from "@/app/lib/mappers/format";

/** Contract payment (GET /my/payments items[]) → «Мои платежи» row view
 * (#513): amount render-ready, method translated to its Russian label
 * (null → «Способ не указан»), the payment's own date, and the lesson
 * context from the always-present record (service title + activity
 * date — a payment always rides a record). */
export function toMyPaymentRowView(raw: MyPaymentItem): MyPaymentRowView {
  return {
    id: raw.id,
    amountFormatted: formatPrice(raw.amount),
    methodLabel:
      raw.method === null
        ? PAYMENT_METHOD_UNSET_LABEL
        : PAYMENT_METHOD_LABELS[raw.method],
    dateFormatted: formatDate(raw.created_at),
    serviceTitle: raw.record.service_title,
    lessonDateFormatted: formatDate(raw.record.activity_date),
  };
}
