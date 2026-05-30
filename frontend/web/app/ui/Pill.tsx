import type { ReactNode } from "react";

export interface PillProps {
  active: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function Pill({ active, children, onClick, className = "" }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-4 py-1.5 text-sm whitespace-nowrap transition",
        active
          ? "bg-[#004D56] text-white"
          : "border border-[#E0E0E1] text-[#555555] hover:border-[#004D56] hover:text-[#004D56]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

export default Pill;
