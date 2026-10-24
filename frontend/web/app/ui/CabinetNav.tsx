import Link from "next/link";

/** The three cabinet sections (#513 spec §«Экраны веб-кабинета»). Photos
 * and payments screens arrive with Tasks 8–9 — the links are stable. */
export type CabinetSection = "records" | "photos" | "payments";

const SECTION_LINKS: Array<{ key: CabinetSection; href: string; label: string }> = [
  { key: "records", href: "/cabinet/records", label: "Мои записи" },
  { key: "photos", href: "/cabinet/photos", label: "Мои фото" },
  { key: "payments", href: "/cabinet/payments", label: "Мои платежи" },
];

export interface CabinetNavProps {
  /** The section the user is on — highlighted with aria-current="page". */
  active: CabinetSection;
  className?: string;
}

/** Cabinet section navigation: three links, the active one highlighted
 * (data-testid="cabinet-nav" — pinned by the Visual Compliance Checks). */
export function CabinetNav({ active, className = "" }: CabinetNavProps) {
  return (
    <nav
      data-testid="cabinet-nav"
      aria-label="Разделы кабинета"
      className={["flex gap-2", className].filter(Boolean).join(" ")}
    >
      {SECTION_LINKS.map(({ key, href, label }) => {
        const isActive = key === active;
        const classes = [
          "rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition",
          isActive
            ? "bg-brand text-white"
            : "border border-line text-ink-mid hover:border-brand hover:text-brand",
        ].join(" ");
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={classes}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default CabinetNav;
