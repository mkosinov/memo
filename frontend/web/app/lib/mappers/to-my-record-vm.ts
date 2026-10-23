import type { MyRecordItem, MyVisitItem } from "@memo/api-client";
import type {
  MyRecordCardView,
  MyVisitRowView,
} from "@/app/lib/model/view/my-records";
import { VISIT_STATUS_LABELS } from "@/app/lib/model/domain/visit-status";
import { formatDate, formatPrice } from "@/app/lib/mappers/format";

/** «Посетитель» — the screen label for an anonymous seat (visitor_name
 * null is legal per domain); the #513 spec pins the exact wording. */
export const ANONYMOUS_VISITOR_LABEL = "Посетитель";

/** ISO time "15:00:00" → "15:00" (the card shows HH:MM only). */
function formatTime(isoTime: string): string {
  return isoTime.slice(0, 5);
}

function toVisitRowView(raw: MyVisitItem): MyVisitRowView {
  return {
    id: raw.id,
    visitorName: raw.visitor_name ?? ANONYMOUS_VISITOR_LABEL,
    status: raw.status,
    statusLabel: VISIT_STATUS_LABELS[raw.status],
    priceFormatted: formatPrice(raw.price),
  };
}

/** Contract record (GET /my/records items[]) → «Мои записи» card view
 * (#513): date/time render-ready, service title as-is, own comment
 * passthrough (null hides the block in the UI), visits in server order. */
export function toMyRecordCardView(raw: MyRecordItem): MyRecordCardView {
  return {
    id: raw.id,
    dateFormatted: formatDate(raw.activity_date),
    timeFormatted: `${formatTime(raw.activity_start)}–${formatTime(raw.activity_end)}`,
    serviceTitle: raw.service_title,
    comment: raw.comment,
    visits: raw.visits.map(toVisitRowView),
  };
}
