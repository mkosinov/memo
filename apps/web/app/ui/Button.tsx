import type { ReactNode } from "react";

export interface ButtonProps {
  variant: "primary" | "outline" | "gold";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const variantClasses: Record<ButtonProps["variant"], string> = {
  primary: "bg-[#004D56] text-white hover:bg-[#006670]",
  outline:
    "bg-transparent border border-[#004D56] text-[#004D56] hover:bg-[#004D56] hover:text-white",
  gold: "bg-[#C49A2E] text-white hover:bg-[#b08a28]",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3 text-lg",
};

export function Button({
  variant,
  size = "md",
  children,
  onClick,
  disabled = false,
  className = "",
}: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-lg font-medium transition",
        variantClasses[variant],
        sizeClasses[size],
        disabled && "opacity-50 cursor-not-allowed",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

export default Button;
