import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface OverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: "half" | "three-quarters" | "full";
  title?: string;
}

export function Overlay({ isOpen, onClose, children, size = "half", title }: OverlayProps) {
  const heightMap = {
    half: "50dvh",
    "three-quarters": "80dvh",
    full: "100dvh",
  } as const;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          data-testid="overlay-backdrop"
          className="fixed inset-0 z-40 bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            data-testid="overlay-panel"
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-lg"
            style={{ height: heightMap[size] }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            onClick={(e) => e.stopPropagation()}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_e: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                onClose();
              }
            }}
          >
            {/* Drag handle — always visible, only tappable area for swipe */}
            <div
              className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-[#D4D4D4]" />
            </div>

            <div className="flex items-center justify-between px-4 pb-4">
              {title && (
                <span className="text-base font-playfair font-bold text-[#1a1a1a] truncate mr-4">
                  {title}
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                className="text-[#555555] hover:text-[#1a1a1a] text-2xl leading-none transition flex-shrink-0"
                aria-label="Close overlay"
              >
                &times;
              </button>
            </div>
            <div
              className="px-4 pb-4 overflow-y-auto"
              style={{ height: `calc(${heightMap[size]} - 4.5rem)` }}
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Overlay;
