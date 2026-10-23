"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listMyPayments } from "@memo/api-client";
import { toMyPaymentRowView } from "@/app/lib/mappers/to-my-payment-vm";
import type { MyPaymentRowView } from "@/app/lib/model/view/my-payments";

/** Explicit page size for the cabinet lists (#513): equals the backend's
 * PaginationParams default (20) — pinned so pageCount math is stable. */
export const MY_PAYMENTS_PER_PAGE = 20;

export interface UseMyPaymentsResult {
  rows: MyPaymentRowView[];
  total: number;
  page: number;
  pageCount: number;
  isPending: boolean;
  error: Error | null;
}

/** «Мои платежи» data flow (#513): listMyPayments (page slice) → mapper →
 * react-query cache. `enabled` gates the fetch — an anonymous visitor
 * (the login form is up) never triggers a /my request. */
export function useMyPayments(page: number, enabled: boolean): UseMyPaymentsResult {
  const { data, isPending, error } = useQuery({
    queryKey: ["my", "payments", page],
    queryFn: () => listMyPayments({ page, per_page: MY_PAYMENTS_PER_PAGE }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(
    () => (data?.items ?? []).map(toMyPaymentRowView),
    [data],
  );
  const total = data?.total ?? 0;
  const perPage = data?.per_page ?? MY_PAYMENTS_PER_PAGE;

  return {
    rows,
    total,
    page: data?.page ?? page,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
    isPending,
    error: error ?? null,
  };
}
