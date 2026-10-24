import type { MyPaymentRowView } from "@/app/lib/model/view/my-payments";

export interface MyPaymentRowProps {
  payment: MyPaymentRowView;
}

/** One payment row on «Мои платежи» (#513): amount, Russian method label
 * (incl. «Способ не указан» for a null method), the payment's own date,
 * and the lesson context from the record (service + lesson date).
 * my-payment-row is pinned by the Visual Compliance Checks. */
export function MyPaymentRow({ payment }: MyPaymentRowProps) {
  return (
    <li
      data-testid="my-payment-row"
      className="rounded-2xl border border-line bg-white p-4 shadow-[0_2px_16px_rgba(0,0,0,.05)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          data-testid="my-payment-amount"
          className="font-playfair text-lg font-bold text-ink"
        >
          {payment.amountFormatted}
        </span>
        <span
          data-testid="my-payment-method"
          className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand"
        >
          {payment.methodLabel}
        </span>
      </div>
      <p data-testid="my-payment-date" className="mt-1 text-sm text-ink-mid">
        {payment.dateFormatted}
      </p>
      <p data-testid="my-payment-lesson" className="mt-2 text-sm text-ink">
        {payment.serviceTitle}, {payment.lessonDateFormatted}
      </p>
    </li>
  );
}

export default MyPaymentRow;
