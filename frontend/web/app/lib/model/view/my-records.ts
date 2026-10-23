import type { VisitStatus } from "@memo/api-client";

/** One visitor row inside a lesson card on «Мои записи» (#513). */
export interface MyVisitRowView {
  id: string;
  /** Visitor name; «Посетитель» for an anonymous seat (visitor_name null). */
  visitorName: string;
  /** Raw status — drives the badge color. */
  status: VisitStatus;
  /** Russian status label («Ожидает» / «Состоялось» / «Пропущено» / «Отменено»). */
  statusLabel: string;
  /** Render-ready price («2 000 ₽») — the creation-time snapshot. */
  priceFormatted: string;
}

/** One lesson card on «Мои записи» (#513). */
export interface MyRecordCardView {
  id: string;
  /** «16 июня» */
  dateFormatted: string;
  /** «15:00–16:00» (start–end) */
  timeFormatted: string;
  serviceTitle: string;
  /** The client's own record comment; null → the card hides the block. */
  comment: string | null;
  /** Visitor rows in the server's fixed order (id ASC). */
  visits: MyVisitRowView[];
}
