import { renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { useMyPayments, MY_PAYMENTS_PER_PAGE } from "../useMyPayments";
import { myPaymentItem, createQueryWrapper } from "@/app/__tests__/fixtures/cabinet";

vi.mock("@memo/api-client", () => ({
  listMyPayments: vi.fn(),
}));

import { listMyPayments } from "@memo/api-client";

const mockedListMyPayments = listMyPayments as unknown as Mock;

describe("useMyPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("fetches the page, maps items to row views and echoes pagination meta", async () => {
    mockedListMyPayments.mockResolvedValue({
      items: [
        myPaymentItem(),
        myPaymentItem({
          id: "pay-cash",
          amount: 2000,
          method: "cash",
          record: {
            id: "rec-r4",
            activity_date: "2026-06-15",
            service_title: "Морской пейзаж",
          },
        }),
      ],
      total: 2,
      page: 1,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyPayments(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(mockedListMyPayments).toHaveBeenCalledWith({
      page: 1,
      per_page: MY_PAYMENTS_PER_PAGE,
    });
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0].amountFormatted).toBe("6 000 ₽");
    expect(result.current.rows[0].methodLabel).toBe("Карта");
    expect(result.current.rows[1].methodLabel).toBe("Наличные");
    expect(result.current.rows[1].serviceTitle).toBe("Морской пейзаж");
    expect(result.current.total).toBe(2);
    expect(result.current.pageCount).toBe(1);
  });

  it("computes pageCount from total and per_page (45 payments → 3 pages)", async () => {
    mockedListMyPayments.mockResolvedValue({
      items: [],
      total: 45,
      page: 2,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyPayments(2, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.pageCount).toBe(3);
    expect(result.current.page).toBe(2);
  });

  it("does not fetch while disabled (anonymous visitor — no data)", async () => {
    const { result } = renderHook(() => useMyPayments(1, false), {
      wrapper: createQueryWrapper(),
    });

    // settle the microtask queue: the query must never fire
    await Promise.resolve();
    expect(mockedListMyPayments).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });

  it("surfaces transport errors through the error field", async () => {
    mockedListMyPayments.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useMyPayments(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.rows).toEqual([]);
  });
});
