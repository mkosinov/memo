import type { MyRecordCardView } from "@/app/lib/model/view/my-records";
import type { VisitStatus } from "@memo/api-client";

export interface MyRecordCardProps {
  record: MyRecordCardView;
}

/** Badge tint per visit status (#513) — the label text itself comes
 * pre-translated from the view model; this only picks the color. */
const STATUS_BADGE_CLASSES: Record<VisitStatus, string> = {
  waiting: "bg-[#C49A2E]/15 text-[#8a6d1f]",
  visited: "bg-[#5B8C7A]/15 text-[#3e6b58]",
  missed: "bg-[#D4789A]/15 text-[#a4446c]",
  cancelled: "bg-[#E0E0E1] text-ink-mid",
};

/** One lesson card on «Мои записи» (#513): date, start–end time, service,
 * the client's own comment, and a row per visitor — name, Russian status
 * label (my-visit-status — pinned by the Visual Compliance Checks), price. */
export function MyRecordCard({ record }: MyRecordCardProps) {
  return (
    <li
      data-testid="my-record-card"
      className="rounded-2xl border border-line bg-white p-4 shadow-[0_2px_16px_rgba(0,0,0,.05)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3
          data-testid="my-record-service"
          className="font-playfair text-lg font-bold text-ink"
        >
          {record.serviceTitle}
        </h3>
        <p data-testid="my-record-date" className="text-sm text-ink-mid whitespace-nowrap">
          {record.dateFormatted}
        </p>
      </div>
      <p data-testid="my-record-time" className="mt-0.5 text-sm text-ink-mid">
        {record.timeFormatted}
      </p>

      {record.comment !== null && (
        <p
          data-testid="my-record-comment"
          className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-ink-mid"
        >
          {record.comment}
        </p>
      )}

      <ul className="mt-3 divide-y divide-line">
        {record.visits.map((visit) => (
          <li
            key={visit.id}
            data-testid="my-visit-row"
            className="flex items-center justify-between gap-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {visit.visitorName}
            </span>
            <span
              data-testid="my-visit-status"
              className={["rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_BADGE_CLASSES[visit.status]].join(" ")}
            >
              {visit.statusLabel}
            </span>
            <span className="text-sm font-semibold text-ink whitespace-nowrap">
              {visit.priceFormatted}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default MyRecordCard;
