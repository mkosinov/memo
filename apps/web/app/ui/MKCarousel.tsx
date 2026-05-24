"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MKCard, type MKCardProps } from "./MKCard";

type MKCardData = MKCardProps & { id: string };

export interface MKCarouselProps {
  cards: MKCardData[];
  lastCard?: MKCardData;
  onSelectCard: (card: MKCardData) => void;
  onTapLastCard?: () => void;
  onSwipe?: (card: MKCardData, direction: "left" | "right") => void;
  onShowAgain?: () => void;
  onNextDay?: () => void;
}

/** Stack config: scale, X offset, z-index per stack position */
const STACK_COUNT = 7;

const STACK = Array.from({ length: STACK_COUNT }, (_, i) => ({
  scale: +(1.0 - i * 0.1).toFixed(1),
  x: i * 30,
  top: `${1 + i * 5}%`,
  width: i === 0 ? "80%" : i === 1 ? "88%" : "94%",
  zIndex: 30 - i * 5,
}));

// ── Shared swipe constants used both in drag and exit ──
const SWIPE_THRESHOLD = 80;
const SWIPE_VELOCITY = 500;
const FLY_DISTANCE = 500;
const FLY_DURATION_MS = 250;

export function MKCarousel({
  cards,
  lastCard,
  onSelectCard,
  onTapLastCard,
  onSwipe,
  onShowAgain,
  onNextDay,
}: MKCarouselProps) {
  const [index, setIndex] = useState(0);
  const [isEmpty, setIsEmpty] = useState(false);
  const [flyingDir, setFlyingDir] = useState<"left" | "right" | null>(null);
  const flyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasDragged = useRef(false);
  const lastSwipeDir = useRef<"left" | "right" | null>(null);

  // Reset when cards reference changes (e.g. new date filter)
  const cardsRef = useRef(cards);
  useEffect(() => {
    if (cards !== cardsRef.current) {
      setIndex(0);
      setIsEmpty(false);
      cardsRef.current = cards;
    }
  }, [cards]);

  // Clean up fly timer on unmount
  useEffect(() => {
    return () => {
      if (flyTimer.current) clearTimeout(flyTimer.current);
    };
  }, []);

  // ── Build visible stack (up to 3 cards) ──
  const visibleCards: MKCardData[] = [];
  const regularSlots = lastCard ? 2 : 3;
  for (let i = 0; i < regularSlots && index + i < cards.length; i++) {
    visibleCards.push(cards[index + i]);
  }
  // Show lastCard at the bottom of the stack if there's room
  if (!isEmpty && lastCard && visibleCards.length < 3 && index <= cards.length) {
    visibleCards.push(lastCard);
  }

  const topCard = visibleCards[0];
  const showEmpty = isEmpty || (visibleCards.length === 0 && !lastCard);

  // ── Actually remove the top card after fly animation ──
  const commitSwipe = useCallback(
    (direction: "left" | "right") => {
      if (!topCard) return;
      onSwipe?.(topCard, direction);
      if (topCard.id === lastCard?.id && direction === "left") {
        setIsEmpty(true);
      } else if (direction === "left") {
        setIndex((i) => i + 1);
      } else {
        setIndex((i) => Math.max(0, i - 1));
      }
      // Clear direction hint after the render commit, so entering
      // cards can read it in their initial animation
      queueMicrotask(() => { lastSwipeDir.current = null; });
    },
    [topCard, lastCard, onSwipe],
  );

  // ── Drag handler (replaces all manual pointer events) ──
  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      const absOffset = Math.abs(info.offset.x);
      const absVelocity = Math.abs(info.velocity.x);

      if (absOffset < SWIPE_THRESHOLD && absVelocity < SWIPE_VELOCITY) return;

      const dir = info.offset.x > 0 ? "right" : "left";

      // Ignore swipe right at the first card — nowhere to go back
      if (dir === "right" && index === 0) return;
      lastSwipeDir.current = dir;

      if (dir === "right") {
        // Go back immediately — card returns to stack without flying off-screen
        commitSwipe("right");
        return;
      }

      // Forward: fly card left, then commit
      setFlyingDir("left");
      flyTimer.current = setTimeout(() => {
        commitSwipe("left");
        setFlyingDir(null);
      }, FLY_DURATION_MS);
    },
    [commitSwipe, index],
  );

  // ── Tap handler ──
  const handleTap = useCallback(() => {
    if (!topCard) return;
    if (topCard.id === lastCard?.id) {
      onTapLastCard?.();
    } else {
      onSelectCard(topCard);
    }
  }, [topCard, lastCard, onSelectCard, onTapLastCard]);

  // ── Reset stack ──
  const handleReset = useCallback(() => {
    setIndex(0);
    setIsEmpty(false);
    onShowAgain?.();
  }, [onShowAgain]);

  // ── Render ──
  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className="relative w-full h-full px-4 py-3">
        <AnimatePresence>
          {showEmpty ? (
            <motion.div
              key="empty"
              className="relative flex flex-col items-center justify-center gap-4 px-4 w-full h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              <p className="text-text-secondary text-center text-lg max-w-xs">
                Все активности на этот день просмотрены
              </p>
              <div className="flex flex-col gap-3 w-64">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-5 py-3 rounded-lg bg-brand/20 text-text-primary font-medium text-sm hover:bg-brand/30 transition-colors"
                >
                  Показать ещё раз
                </button>
                {onNextDay && (
                  <button
                    type="button"
                    onClick={onNextDay}
                    className="px-5 py-3 rounded-lg bg-brand text-white font-medium text-sm hover:bg-brand/80 transition-colors"
                  >
                    Следующий день →
                  </button>
                )}
              </div>
            </motion.div>
          ) : (
            visibleCards.map((card, i) => {
              const isTop = i === 0;
              const isLastCard = card.id === lastCard?.id;
              const cfg = STACK[i] ?? STACK[STACK.length - 1];
              const canInteract = isTop && !flyingDir;
              const isFlying = isTop && !!flyingDir;

              return (
                <motion.div
                  key={card.id}
                  className={`absolute left-[3%] h-[98%] ${!isTop ? "ring-1 ring-black/10 shadow-lg" : ""}`}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  initial={
                    i === 0 && lastSwipeDir.current === "right"
                      ? { x: -FLY_DISTANCE, scale: 0.9, opacity: 0.8 }
                      : { x: cfg.x, scale: cfg.scale, opacity: 1 }
                  }
                  animate={
                    isFlying
                      ? {
                          x: flyingDir === "right" ? FLY_DISTANCE : -FLY_DISTANCE,
                          scale: cfg.scale,
                          opacity: 0,
                        }
                      : { x: cfg.x, scale: cfg.scale, top: cfg.top, width: cfg.width }
                  }
                  style={{
                    zIndex: isFlying ? 40 : cfg.zIndex,
                    touchAction: isFlying ? "none" : "pan-y",
                    transformOrigin: "center top",
                  }}
                  transition={
                    isFlying
                      ? { duration: FLY_DURATION_MS / 1000, ease: "easeIn" }
                      : {
                          x: { type: "spring", stiffness: 180, damping: 20, mass: 2.4 },
                          scale: { type: "spring", stiffness: 180, damping: 20, mass: 2.4 },
                          top: { duration: 0.15, ease: "easeOut" },
                          width: { duration: 0.15, ease: "easeOut" },
                        }
                  }
                  drag={canInteract ? "x" : false}
                  dragSnapToOrigin
                  onDragStart={canInteract ? () => { wasDragged.current = true; } : undefined}
                  onDragEnd={canInteract ? handleDragEnd : undefined}
                  onClick={canInteract ? () => {
                    if (wasDragged.current) {
                      wasDragged.current = false;
                      return;
                    }
                    handleTap();
                  } : undefined}
                  onTap={canInteract ? () => {
                    if (wasDragged.current) {
                      wasDragged.current = false;
                      return;
                    }
                    handleTap();
                  } : undefined}
                >
                  <MKCard
                    {...card}
                    className="h-full"
                    onSignUp={isLastCard ? onTapLastCard : card.onSignUp}
                  />
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default MKCarousel;
