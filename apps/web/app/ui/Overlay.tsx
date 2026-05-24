import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface OverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: "half" | "three-quarters" | "full" | "dynamic";
  title?: string;
  /** Rendered outside the scrollable content area (sticky bottom). Only used with size="dynamic". */
  footer?: ReactNode;
}

export function Overlay({ isOpen, onClose, children, size = "half", title, footer }: OverlayProps) {
  const heightMap = {
    half: "50dvh" as const,
    "three-quarters": "80dvh" as const,
    full: "100dvh" as const,
    // dynamic uses flex layout instead of fixed height
    dynamic: undefined,
  };

  const isDynamic = size === "dynamic";

  // Prevent background scroll when overlay is open
  useEffect(() => {
    if (isOpen) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = orig; };
    }
  }, [isOpen]);

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
          {isDynamic ? (
            <DynamicPanel onClose={onClose} title={title} footer={footer}>
              {children}
            </DynamicPanel>
          ) : (
            <FixedSizePanel
              size={size}
              heightMap={heightMap as Record<"half" | "three-quarters" | "full", string>}
              onClose={onClose}
              title={title}
            >
              {children}
            </FixedSizePanel>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Fixed-size panel (unchanged behaviour) ──
function FixedSizePanel({
  size,
  heightMap,
  onClose,
  title,
  children,
}: {
  size: "half" | "three-quarters" | "full";
  heightMap: Record<"half" | "three-quarters" | "full", string>;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const height = heightMap[size];
  return (
    <motion.div
      data-testid="overlay-panel"
      className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-lg"
      style={{ height }}
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
      {/* Drag handle */}
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
        style={{ height: `calc(${height} - 4.5rem)` }}
      >
        {children}
      </div>
    </motion.div>
  );
}

// ── Dynamic-size panel: height adapts to content, swipe‑down via framer-motion ──
function DynamicPanel({
  onClose,
  title,
  footer,
  children,
}: {
  onClose: () => void;
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [closing, setClosing] = useState(false);

  const handleDragEnd = (
    _e: unknown,
    info: { offset: { y: number }; velocity: { y: number } },
  ) => {
    if (closing) return;
    if (info.offset.y > 100 || info.velocity.y > 500) {
      setClosing(true);
      // After the slide-down animation completes, remove the panel
      setTimeout(() => {
        onClose();
        // Reset after unmount is a no-op, but keeps state consistent
        setClosing(false);
      }, 300);
    }
  };

  return (
    <motion.div
      data-testid="overlay-panel"
      className="absolute bottom-0 left-0 right-0 flex flex-col bg-white rounded-t-2xl shadow-lg overflow-hidden"
      style={{ maxHeight: "100dvh" }}
      initial={{ y: "100%" }}
      animate={closing ? { y: "100%" } : { y: 0 }}
      exit={{ y: "100%" }}
      transition={
        closing
          ? { type: "tween", duration: 0.25, ease: "easeIn" }
          : { type: "spring", damping: 25, stiffness: 200 }
      }
      onClick={(e) => e.stopPropagation()}
      drag={closing ? false : "y"}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.4 }}
      onDragEnd={handleDragEnd}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
        <div className="w-10 h-1 rounded-full bg-[#D4D4D4]" />
      </div>

      {/* Header */}
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

      {/* Scrollable content (no overflow auto — let parent clip so drag works everywhere) */}
      <div className="flex-1 min-h-0 px-4 pb-4">
        {children}
      </div>

      {/* Sticky footer (e.g. book button) */}
      {footer && (
        <div className="flex-shrink-0 px-4 pb-4 pt-3 border-t border-[#E8E8E8]">
          {footer}
        </div>
      )}
    </motion.div>
  );
}

export default Overlay;
