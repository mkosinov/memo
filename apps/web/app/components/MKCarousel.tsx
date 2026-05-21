"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { useCardStack, type CardStackItem } from "../hooks/useCardStack";
import { MKCard, type MKCardProps } from "./MKCard";

/** MKCardProps structurally satisfies CardStackItem (has id: string) */
type MKCardData = MKCardProps & CardStackItem;

export interface MKCarouselProps {
  cards: MKCardData[];
  onSelectCard: (card: MKCardData) => void;
  onSwipe?: (card: MKCardData, direction: "left" | "right") => void;
}

const SWIPE_THRESHOLD = 100;

export function MKCarousel({
  cards,
  onSelectCard,
  onSwipe,
}: MKCarouselProps) {
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);

  const {
    currentIndex,
    direction,
    visibleCards,
    handleSwipe,
    handleTap,
  } = useCardStack<MKCardData>({
    cards,
    onSwipe: (card, dir) => {
      setExitDirection(dir);
      onSwipe?.(card, dir);
    },
    onTap: (card) => {
      onSelectCard(card);
    },
  });

  const handlePanEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const offset = info.offset.x;
      if (Math.abs(offset) > SWIPE_THRESHOLD) {
        const dir = offset > 0 ? "right" : "left";
        handleSwipe(dir);
      }
    },
    [handleSwipe]
  );

  const cardScales = [1, 0.95, 0.90];
  const cardOffsets = [
    { y: 0, rotate: 0 },
    { y: 8, rotate: 2 },
    { y: 16, rotate: -2 },
  ];
  const cardZIndices = [30, 20, 10];

  return (
    <div className="relative flex flex-col items-center">
      {/* Card stack */}
      <div className="relative w-full" style={{ minHeight: "420px" }}>
        <AnimatePresence mode="popLayout">
          {visibleCards.map((card, index) => {
            const isTop = index === 0;
            const scale = cardScales[index] ?? 0.85;
            const offset = cardOffsets[index] ?? { y: 24, rotate: 0 };
            const zIndex = cardZIndices[index] ?? 0;

            return (
              <motion.div
                key={card.id}
                className="absolute inset-0 mx-4"
                style={{
                  zIndex,
                  transformOrigin: "center top",
                }}
                initial={
                  isTop
                    ? { scale: 0.9, opacity: 0, x: 100 }
                    : false
                }
                animate={{
                  scale,
                  y: offset.y,
                  rotate: offset.rotate,
                  opacity: 1,
                  x: 0,
                }}
                exit={{
                  x: exitDirection === "left" ? -300 : 300,
                  rotate: exitDirection === "left" ? -20 : 20,
                  opacity: 0,
                  transition: { duration: 0.3 },
                }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 25,
                }}
                drag={isTop ? "x" : false}
                dragElastic={0.7}
                onDragEnd={isTop ? handlePanEnd : undefined}
                onClick={isTop ? handleTap : undefined}
              >
                <MKCard {...card} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default MKCarousel;
