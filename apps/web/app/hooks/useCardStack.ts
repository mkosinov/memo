import { useState, useMemo, useCallback } from "react";

export interface CardStackItem {
  id: string;
}

export interface UseCardStackOptions<T extends CardStackItem> {
  cards: T[];
  onSwipe?: (card: T, direction: "left" | "right") => void;
  onTap?: (card: T) => void;
}

export interface UseCardStackReturn<T extends CardStackItem> {
  currentIndex: number;
  direction: "left" | "right" | null;
  visibleCards: T[];
  handleSwipe: (direction: "left" | "right") => void;
  handleTap: () => void;
}

const VISIBLE_COUNT = 3;

export function useCardStack<T extends CardStackItem>(
  options: UseCardStackOptions<T>
): UseCardStackReturn<T> {
  const { cards, onSwipe, onTap } = options;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);

  const visibleCards = useMemo(() => {
    if (cards.length === 0) return [];
    const count = Math.min(VISIBLE_COUNT, cards.length);
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      const index = (currentIndex + i) % cards.length;
      result.push(cards[index]);
    }
    return result;
  }, [cards, currentIndex]);

  const handleSwipe = useCallback(
    (swipeDirection: "left" | "right") => {
      if (cards.length === 0) return;
      const currentCard = cards[currentIndex];
      setDirection(swipeDirection);
      setCurrentIndex((prev) => (prev + 1) % cards.length);
      onSwipe?.(currentCard, swipeDirection);
    },
    [cards, currentIndex, onSwipe]
  );

  const handleTap = useCallback(() => {
    if (cards.length === 0) return;
    onTap?.(cards[currentIndex]);
  }, [cards, currentIndex, onTap]);

  return {
    currentIndex,
    direction,
    visibleCards,
    handleSwipe,
    handleTap,
  };
}
