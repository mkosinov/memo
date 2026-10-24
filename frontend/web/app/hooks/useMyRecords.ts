"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listMyRecords } from "@memo/api-client";
import { toMyRecordCardView } from "@/app/lib/mappers/to-my-record-vm";
import type { MyRecordCardView } from "@/app/lib/model/view/my-records";

/** Explicit page size for the cabinet lists (#513): equals the backend's
 * PaginationParams default (20) — pinned so pageCount math is stable. */
export const MY_RECORDS_PER_PAGE = 20;

export interface UseMyRecordsResult {
  cards: MyRecordCardView[];
  total: number;
  page: number;
  pageCount: number;
  isPending: boolean;
  error: Error | null;
}

/** «Мои записи» data flow (#513): listMyRecords (page slice) → mapper →
 * react-query cache. `enabled` gates the fetch — an anonymous visitor
 * (the login form is up) never triggers a /my request. */
export function useMyRecords(page: number, enabled: boolean): UseMyRecordsResult {
  const { data, isPending, error } = useQuery({
    queryKey: ["my", "records", page],
    queryFn: () => listMyRecords({ page, per_page: MY_RECORDS_PER_PAGE }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const cards = useMemo(
    () => (data?.items ?? []).map(toMyRecordCardView),
    [data],
  );
  const total = data?.total ?? 0;
  const perPage = data?.per_page ?? MY_RECORDS_PER_PAGE;

  return {
    cards,
    total,
    page: data?.page ?? page,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
    isPending,
    error: error ?? null,
  };
}
