export interface HeaderProps {
  onMenuToggle?: () => void;
  isScrolled?: boolean;
  /** Positioning override — "absolute" for hero overlay, default flows naturally */
  position?: "absolute" | "relative";
}

export function Header({ onMenuToggle, isScrolled = false, position }: HeaderProps) {
  return (
    <header
      role="banner"
      className={[
        position ? `${position} top-0 left-0 right-0` : "",
        "z-30 h-14 px-4 flex items-center justify-between transition-colors duration-200",
        isScrolled ? "bg-white shadow-sm" : "bg-transparent",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img src="/logo_horizontal_color.png" alt="Colour Mountains" className="h-8 w-auto" />
      <button
        type="button"
        onClick={onMenuToggle}
        className="p-2 rounded-lg hover:bg-[#004D56]/10 transition"
        aria-label="Menu"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    </header>
  );
}

export default Header;
