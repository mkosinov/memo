import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCardStack } from "../hooks/useCardStack";

interface TestCard {
  id: string;
  title: string;
}

const mockCards: TestCard[] = [
  { id: "1", title: "Card 1" },
  { id: "2", title: "Card 2" },
  { id: "3", title: "Card 3" },
  { id: "4", title: "Card 4" },
  { id: "5", title: "Card 5" },
];

describe("useCardStack", () => {
  it("starts at index 0 with no direction", () => {
    const { result } = renderHook(() => useCardStack({ cards: mockCards }));

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.direction).toBeNull();
  });

  it("returns visible cards (current + next 2)", () => {
    const { result } = renderHook(() => useCardStack({ cards: mockCards }));

    expect(result.current.visibleCards).toHaveLength(3);
    expect(result.current.visibleCards[0]).toEqual({ id: "1", title: "Card 1" });
    expect(result.current.visibleCards[1]).toEqual({ id: "2", title: "Card 2" });
    expect(result.current.visibleCards[2]).toEqual({ id: "3", title: "Card 3" });
  });

  it("swipe right advances to next card", () => {
    const { result } = renderHook(() => useCardStack({ cards: mockCards }));

    act(() => {
      result.current.handleSwipe("right");
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.direction).toBe("right");
    expect(result.current.visibleCards[0]).toEqual({ id: "2", title: "Card 2" });
  });

  it("swipe left advances to next card", () => {
    const { result } = renderHook(() => useCardStack({ cards: mockCards }));

    act(() => {
      result.current.handleSwipe("left");
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.direction).toBe("left");
  });

  it("calls onSwipe callback with card and direction", () => {
    const onSwipe = vi.fn();
    const { result } = renderHook(() =>
      useCardStack({ cards: mockCards, onSwipe })
    );

    act(() => {
      result.current.handleSwipe("right");
    });

    expect(onSwipe).toHaveBeenCalledWith({ id: "1", title: "Card 1" }, "right");
  });

  it("calls onTap callback with current card", () => {
    const onTap = vi.fn();
    const { result } = renderHook(() =>
      useCardStack({ cards: mockCards, onTap })
    );

    act(() => {
      result.current.handleTap();
    });

    expect(onTap).toHaveBeenCalledWith({ id: "1", title: "Card 1" });
  });

  it("handles fewer than 3 cards gracefully", () => {
    const fewCards = [{ id: "1", title: "Only Card" }];
    const { result } = renderHook(() => useCardStack({ cards: fewCards }));

    expect(result.current.visibleCards).toHaveLength(1);
    expect(result.current.visibleCards[0]).toEqual({ id: "1", title: "Only Card" });
  });

  it("handles 2 cards gracefully", () => {
    const twoCards = [
      { id: "1", title: "Card 1" },
      { id: "2", title: "Card 2" },
    ];
    const { result } = renderHook(() => useCardStack({ cards: twoCards }));

    expect(result.current.visibleCards).toHaveLength(2);
  });

  it("wraps around when reaching the end", () => {
    const { result } = renderHook(() => useCardStack({ cards: mockCards }));

    // Swipe through all cards
    act(() => result.current.handleSwipe("right"));
    act(() => result.current.handleSwipe("right"));
    act(() => result.current.handleSwipe("right"));
    act(() => result.current.handleSwipe("right"));
    act(() => result.current.handleSwipe("right"));

    // Should wrap back to start
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.visibleCards[0]).toEqual({ id: "1", title: "Card 1" });
  });

  it("handles empty cards array", () => {
    const { result } = renderHook(() => useCardStack({ cards: [] }));

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.visibleCards).toHaveLength(0);
  });

  describe("with lastCard (non-cycling terminal card)", () => {
    it("includes lastCard as the final visible card", () => {
      const lastCard = { id: "last", title: "Custom MK" };
      const { result } = renderHook(() =>
        useCardStack({ cards: mockCards, lastCard })
      );

      const visibleIds = result.current.visibleCards.map((c) => c.id);
      expect(visibleIds).toContain("last");
    });

    it("does not cycle past the last card", () => {
      const lastCard = { id: "last", title: "Custom MK" };
      const { result } = renderHook(() =>
        useCardStack({ cards: mockCards.slice(0, 2), lastCard })
      );

      // Swipe through all regular cards
      act(() => result.current.handleSwipe("right")); // index 1
      act(() => result.current.handleSwipe("right")); // index 2 (lastCard)

      // Should stay at last card, not wrap
      const visibleIds = result.current.visibleCards.map((c) => c.id);
      expect(visibleIds[0]).toBe("last");
    });

    it("returns isLastCard flag when current card is the last card", () => {
      const lastCard = { id: "last", title: "Custom MK" };
      const { result } = renderHook(() =>
        useCardStack({ cards: [{ id: "1", title: "Card 1" }], lastCard })
      );

      expect(result.current.isLastCard).toBe(false);

      act(() => result.current.handleSwipe("right"));

      expect(result.current.isLastCard).toBe(true);
    });

    it("handlesTap on last card calls onTap with lastCard", () => {
      const onTap = vi.fn();
      const lastCard = { id: "last", title: "Custom MK" };
      const { result } = renderHook(() =>
        useCardStack({ cards: [{ id: "1", title: "Card 1" }], lastCard, onTap })
      );

      act(() => result.current.handleSwipe("right"));
      act(() => result.current.handleTap());

      expect(onTap).toHaveBeenCalledWith(lastCard);
    });
  });
});
