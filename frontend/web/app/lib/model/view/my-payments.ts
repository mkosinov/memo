/** One payment row on «Мои платежи» (#513). */
export interface MyPaymentRowView {
  id: string;
  /** Render-ready amount, e.g. "6 000 ₽". */
  amountFormatted: string;
  /** «Наличные» / «Карта» / «Перевод» / «Способ не указан» (method null). */
  methodLabel: string;
  /** The payment's own date (created_at), e.g. "16 июня". */
  dateFormatted: string;
  /** Lesson context — the record's service title. */
  serviceTitle: string;
  /** Lesson context — the record's activity date, e.g. "15 июня". */
  lessonDateFormatted: string;
}
