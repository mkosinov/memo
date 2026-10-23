import { renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { useMyPhotos, MY_PHOTOS_PER_PAGE } from "../useMyPhotos";
import { myPhotoItem, createQueryWrapper } from "@/app/__tests__/fixtures/cabinet";

vi.mock("@memo/api-client", () => ({
  listMyPhotos: vi.fn(),
}));

import { listMyPhotos } from "@memo/api-client";

const mockedListMyPhotos = listMyPhotos as unknown as Mock;

describe("useMyPhotos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("fetches the page, maps items to card views (badge included) and echoes pagination meta", async () => {
    mockedListMyPhotos.mockResolvedValue({
      items: [
        myPhotoItem(),
        myPhotoItem({ id: "ph-priv", filename: "/images/cabinet-draft.jpg", is_public: false }),
      ],
      total: 2,
      page: 1,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyPhotos(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(mockedListMyPhotos).toHaveBeenCalledWith({
      page: 1,
      per_page: MY_PHOTOS_PER_PAGE,
    });
    expect(result.current.cards).toHaveLength(2);
    expect(result.current.cards[0].url).toBe("/images/client-work-1.jpg");
    expect(result.current.cards[0].isPublicLabel).toBe("Опубликовано");
    expect(result.current.cards[1].isPublicLabel).toBe("Не опубликовано");
    expect(result.current.total).toBe(2);
    expect(result.current.pageCount).toBe(1);
  });

  it("computes pageCount from total and per_page (45 photos → 3 pages)", async () => {
    mockedListMyPhotos.mockResolvedValue({
      items: [],
      total: 45,
      page: 2,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyPhotos(2, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.pageCount).toBe(3);
    expect(result.current.page).toBe(2);
  });

  it("drops items whose filename fails the shared allowlist", async () => {
    mockedListMyPhotos.mockResolvedValue({
      items: [myPhotoItem(), myPhotoItem({ id: "ph-bad", filename: "javascript:alert(1)" })],
      total: 2,
      page: 1,
      per_page: 20,
    });

    const { result } = renderHook(() => useMyPhotos(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].id).toBe("ph-1");
  });

  it("does not fetch while disabled (anonymous visitor — no data)", async () => {
    const { result } = renderHook(() => useMyPhotos(1, false), {
      wrapper: createQueryWrapper(),
    });

    // settle the microtask queue: the query must never fire
    await Promise.resolve();
    expect(mockedListMyPhotos).not.toHaveBeenCalled();
    expect(result.current.cards).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });

  it("surfaces transport errors through the error field", async () => {
    mockedListMyPhotos.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useMyPhotos(1, true), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.cards).toEqual([]);
  });
});
