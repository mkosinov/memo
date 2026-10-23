import { vi } from "vitest";
import type { Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { MyRecordItem, MyPhotoItem } from "@memo/api-client";
import type { MyRecordCardView } from "@/app/lib/model/view/my-records";
import type { MyPhotoCardView } from "@/app/lib/model/view/my-photos";

/**
 * Shared cabinet (#513) test fixtures — the single home of the contract and
 * view-model factories used across the cabinet suites (page composition
 * tests, hook tests, mapper tests, UI tests). Extracted from the per-file
 * duplicates of Tasks 7–8; new cabinet screens (payments, …) add their
 * factories here instead of growing another copy.
 */

// ── Contract factories (exact GET /my/* items[] shapes) ─────────────────────

/** GET /my/records items[] row (#513). Backend serializes date/time columns
 *  as ISO strings ("2026-06-16" / "15:00:00"). */
export function myRecordItem(overrides: Partial<MyRecordItem> = {}): MyRecordItem {
  return {
    id: "rec-1",
    activity_date: "2026-06-16",
    activity_start: "15:00:00",
    activity_end: "16:00:00",
    service_title: "Мини-картина акрилом",
    comment: null,
    visits: [
      { id: "vis-1", visitor_name: "Анна Иванова", status: "visited", price: 2000 },
    ],
    ...overrides,
  };
}

/** GET /my/photos items[] row (#513): no owner ids (the requester IS the
 *  client), tags resolved to plain names, is_public drives the badge. */
export function myPhotoItem(overrides: Partial<MyPhotoItem> = {}): MyPhotoItem {
  return {
    id: "ph-1",
    filename: "/images/client-work-1.jpg",
    is_public: true,
    tags: ["масло"],
    created_at: "2026-06-15T12:00:00",
    ...overrides,
  };
}

// ── View-model factories (as produced by the to-*-vm mappers) ──────────────

/** «Мои записи» card view as produced by toMyRecordCardView (#513). */
export function myRecordCardView(
  overrides: Partial<MyRecordCardView> = {},
): MyRecordCardView {
  return {
    id: "rec-1",
    dateFormatted: "16 июня",
    timeFormatted: "15:00–16:00",
    serviceTitle: "Мини-картина акрилом",
    comment: null,
    visits: [
      {
        id: "vis-1",
        visitorName: "Анна Иванова",
        status: "visited",
        statusLabel: "Состоялось",
        priceFormatted: "2 000 ₽",
      },
    ],
    ...overrides,
  };
}

/** «Мои фото» card view as produced by toMyPhotoCardView (#513). */
export function myPhotoCardView(
  overrides: Partial<MyPhotoCardView> = {},
): MyPhotoCardView {
  return {
    id: "ph-1",
    url: "/images/client-work-1.jpg",
    isPublic: true,
    isPublicLabel: "Опубликовано",
    ...overrides,
  };
}

// ── Page-test helpers (cabinet section pages) ───────────────────────────────

export type CabinetSessionStatus =
  | "checking"
  | "anonymous"
  | "authenticated"
  | "error";

/** The seed-like client the cabinet pages render for (c1 «Анна Иванова»). */
export const CABINET_CLIENT = { phone: "+79001234567", name: "Анна Иванова" } as const;

/** The `useCabinetAuth` return value for the given session status — wire it
 *  with `mockedUseCabinetAuth.mockReturnValue(cabinetAuthValue(status))`. */
export function cabinetAuthValue(status: CabinetSessionStatus) {
  return {
    session: {
      status,
      client: status === "authenticated" ? { ...CABINET_CLIENT } : null,
      refresh: vi.fn(),
    },
    handleLogout: vi.fn(),
  };
}

/** The common shape every useMy* cabinet list hook returns (cards + the
 *  pagination meta the ListPagination eats). */
export interface CabinetListHookResult {
  cards: unknown[];
  total: number;
  page: number;
  pageCount: number;
  isPending: boolean;
  error: Error | null;
}

/** Wires a mocked useMy* list hook (page composition tests): merges the
 *  given partial state over the empty-list defaults. Assert call args via
 *  the mock itself (`expect(hook).toHaveBeenLastCalledWith(2, true)`). */
export function mockCabinetListHook(
  hook: Mock,
  state: Partial<CabinetListHookResult> = {},
): void {
  hook.mockImplementation(() => ({
    cards: [],
    total: 0,
    page: 1,
    pageCount: 1,
    isPending: false,
    error: null,
    ...state,
  }));
}

// ── Hook-test helpers ────────────────────────────────────────────────────────

/** Fresh QueryClient with retry: false — error paths must not wait on
 *  retries (hook tests wrap renderHook in this). */
export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
