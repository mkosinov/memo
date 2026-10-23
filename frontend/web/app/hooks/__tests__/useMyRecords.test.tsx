import { renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { useMyRecords, MY_RECORDS_PER_PAGE } from "../useMyRecords";
import { myRecordItem, createQueryWrapper } from "@/app/__tests__/fixtures/cabinet";

vi.mock("@memo/api-client", () => ({
  listMyRecords: vi.fn(),
}));

import { listMyRecords } from "@memo/api-client";

const mockedListMyRecords = listMyRecords as unknown as Mock;

describe("useMyRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("fetches the page, maps items to card views and echoes pagination meta", async () => {
    mockedListMyRecords.mockResolvedValue({
      items: [myRecordItem()],
      total: 2,
      page: 1,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyRecords(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(mockedListMyRecords).toHaveBeenCalledWith({
      page: 1,
      per_page: MY_RECORDS_PER_PAGE,
    });
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].serviceTitle).toBe("Мини-картина акрилом");
    expect(result.current.cards[0].visits[0].statusLabel).toBe("Состоялось");
    expect(result.current.total).toBe(2);
    expect(result.current.pageCount).toBe(1);
  });

  it("computes pageCount from total and per_page (25 records → 2 pages)", async () => {
    mockedListMyRecords.mockResolvedValue({
      items: [],
      total: 25,
      page: 2,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyRecords(2, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.pageCount).toBe(2);
    expect(result.current.page).toBe(2);
  });

  it("passes the requested page number to the endpoint", async () => {
    mockedListMyRecords.mockResolvedValue({
      items: [],
      total: 0,
      page: 3,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyRecords(3, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(mockedListMyRecords).toHaveBeenCalledWith({
      page: 3,
      per_page: MY_RECORDS_PER_PAGE,
    });
  });

  it("does not fetch while disabled (anonymous visitor — no data)", async () => {
    const { result } = renderHook(() => useMyRecords(1, false), {
      wrapper: createQueryWrapper(),
    });

    // settle the microtask queue: the query must never fire
    await Promise.resolve();
    expect(mockedListMyRecords).not.toHaveBeenCalled();
    expect(result.current.cards).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });

  it("surfaces an empty page as empty cards with pageCount floored at 1", async () => {
    mockedListMyRecords.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyRecords(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.cards).toEqual([]);
    expect(result.current.pageCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("surfaces transport errors through the error field", async () => {
    mockedListMyRecords.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useMyRecords(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.cards).toEqual([]);
  });
});
