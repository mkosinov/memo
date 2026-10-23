"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listMyPhotos } from "@memo/api-client";
import { toMyPhotoCardView } from "@/app/lib/mappers/to-my-photo-vm";
import type { MyPhotoCardView } from "@/app/lib/model/view/my-photos";

/** Explicit page size for the cabinet lists (#513): equals the backend's
 * PaginationParams default (20) — pinned so pageCount math is stable. */
export const MY_PHOTOS_PER_PAGE = 20;

export interface UseMyPhotosResult {
  cards: MyPhotoCardView[];
  total: number;
  page: number;
  pageCount: number;
  isPending: boolean;
  error: Error | null;
}

/** «Мои фото» data flow (#513): listMyPhotos (page slice, ALL own photos —
 * is_public is a badge, never a filter) → mapper → react-query cache.
 * `enabled` gates the fetch — an anonymous visitor (the login form is up)
 * never triggers a /my request. */
export function useMyPhotos(page: number, enabled: boolean): UseMyPhotosResult {
  const { data, isPending, error } = useQuery({
    queryKey: ["my", "photos", page],
    queryFn: () => listMyPhotos({ page, per_page: MY_PHOTOS_PER_PAGE }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const cards = useMemo(
    () =>
      (data?.items ?? [])
        .map(toMyPhotoCardView)
        .filter((card): card is MyPhotoCardView => card !== null),
    [data],
  );
  const total = data?.total ?? 0;
  const perPage = data?.per_page ?? MY_PHOTOS_PER_PAGE;

  return {
    cards,
    total,
    page: data?.page ?? page,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
    isPending,
    error: error ?? null,
  };
}
