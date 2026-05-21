import { useState, useMemo, useCallback } from "react";

export interface CardStackItem {
  id: string;
}

export interface UseCardStackOptions<T extends CardStackItem> {
  cards: T[];
  lastCard?: T;
  onSwipe?: (card: T, direction: "left" | "right") => void;
  onTap?: (card: T) => void;
}

export interface UseCardStackReturn<T extends CardStackItem> {
  currentIndex: number;
  direction: "left" | "right" | null;
  visibleCards: T[];
  isLastCard: boolean;
  handleSwipe: (direction: "left" | "right") => void;
  handleTap: () => void;
}

const VISIBLE_COUNT = 3;

export function useCardStack<T extends CardStackItem>(
  options: UseCardStackOptions<T>
): UseCardStackReturn<T> {
  const { cards, lastCard, onSwipe, onTap } = options;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);

  const totalLength = cards.length + (lastCard ? 1 : 0);
  const isLastCard = lastCard ? currentIndex >= cards.length : false;

  const visibleCards = useMemo(() => {
    if (totalLength === 0) return [];
    const result: T[] = [];

    // Reserve 1 slot for lastCard if it exists
    const regularSlots = lastCard ? VISIBLE_COUNT - 1 : VISIBLE_COUNT;

    // Add regular cards
    for (let i = 0; i < Math.min(regularSlots, cards.length); i++) {
      const index = currentIndex + i;
      if (index < cards.length) {
        result.push(cards[index]);
      }
    }

    // Add lastCard at the end
    if (lastCard) {
      result.push(lastCard);
    }

    return result;
  }, [cards, lastCard, currentIndex, totalLength]);

  const handleSwipe = useCallback(
    (swipeDirection: "left" | "right") => {
      if (totalLength === 0) return;

      const currentCard = isLastCard
        ? lastCard!
        : cards[currentIndex];

      setDirection(swipeDirection);

      // Don't cycle past the last card
      if (isLastCard) return;

      const nextIndex = currentIndex + 1;
      if (lastCard && nextIndex >= cards.length) {
        // Move to lastCard position
        setCurrentIndex(cards.length);
      } else if (nextIndex < cards.length) {
        setCurrentIndex(nextIndex);
      } else {
        // Wrap around (only if no lastCard)
        setCurrentIndex(0);
      }

      onSwipe?.(currentCard, swipeDirection);
    },
    [cards, lastCard, currentIndex, isLastCard, totalLength, onSwipe]
  );

  const handleTap = useCallback(() => {
    if (totalLength === 0) return;

    const currentCard = isLastCard
      ? lastCard!
      : cards[currentIndex];

    onTap?.(currentCard);
  }, [cards, lastCard, currentIndex, isLastCard, totalLength, onTap]);

  return {
    currentIndex,
    direction,
    visibleCards,
    isLastCard,
    handleSwipe,
    handleTap,
  };
}
