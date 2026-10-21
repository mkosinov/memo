/**
 * Domain logic for the client booking wire (#499 spec §5).
 *
 * Pure state → `MyRecordCreate` mapping: the owner and prices are deliberately
 * NOT part of it (server-side: session owner, tariff prices). Empty visitor
 * names stay anonymous visits (`name: null`), tariff-free services send
 * `tariff_id: null` (price 0, «Стоимость уточняется»).
 */
import type { MyRecordCreate, MyVisitCreate } from "@memo/api-client";
import type { TariffView } from "../view/tariff";

/** Counter key for tariff-free services: a single unnamed seats counter (US-2). */
export const SEATS_KEY = "seats";

/** Stable row key of the k-th seat of a counter (tariff id or SEATS_KEY). */
export function visitorRowKey(counterId: string, seatIndex: number): string {
  return `${counterId}#${seatIndex}`;
}

/** One row of the optional visitors-names table: raw form strings. */
export interface VisitorFormValue {
  name: string;
  age: string;
}

export interface BuildMyRecordCreateInput {
  activityId: string;
  phone: string;
  comment: string;
  /** Seat count per counter, keyed by tariff id (or SEATS_KEY for tariff-free). */
  counts: Record<string, number>;
  /** Visitors-table values keyed by `visitorRowKey(counterId, seatIndex)`. */
  visitors: Record<string, VisitorFormValue>;
  /** Service tariffs; empty array → tariff-free service. */
  tariffs: TariffView[];
}

/** Strict numeric age: "9abc" or "" → null; " 7 " → 7 (no parseInt truncation). */
function parseAge(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? '';
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}

function toVisit(row: VisitorFormValue | undefined, tariffId: string | null): MyVisitCreate {
  const name = row?.name?.trim();
  return {
    name: name ? name : null,
    age: parseAge(row?.age),
    tariff_id: tariffId,
  };
}

/** Snapshot the overlay state into the strict booking wire (spec §5). */
export function buildMyRecordCreate(input: BuildMyRecordCreateInput): MyRecordCreate {
  const { activityId, phone, comment, counts, visitors, tariffs } = input;

  const visits: MyVisitCreate[] =
    tariffs.length > 0
      ? tariffs.flatMap((t) =>
          Array.from({ length: counts[t.id] ?? 0 }, (_, k) =>
            toVisit(visitors[visitorRowKey(t.id, k)], t.id),
          ),
        )
      : Array.from({ length: counts[SEATS_KEY] ?? 0 }, (_, k) =>
          toVisit(visitors[visitorRowKey(SEATS_KEY, k)], null),
        );

  const trimmedComment = comment.trim();

  return {
    activity_id: activityId,
    phone,
    comment: trimmedComment === "" ? null : trimmedComment,
    visits,
  };
}
