import type { VisitStatus } from "@memo/api-client";

/** Russian labels for the visit status (#513 spec §«Экраны веб-кабинета»):
 * the exact wording the Visual Compliance Checks pin later — keep verbatim. */
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  waiting: "Ожидает",
  visited: "Состоялось",
  missed: "Пропущено",
  cancelled: "Отменено",
};
