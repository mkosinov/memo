import { Button } from "./Button";

export interface MKCardProps {
  id: string;
  imageUrl: string;
  category: "взрослым" | "вместе" | "детям";
  title: string;
  time: string;
  duration: string;
  guestsCount: number;
  priceMin: number;
  priceMax: number;
  onSignUp?: () => void;
  onTap?: () => void;
  className?: string;
}

const categoryColors: Record<MKCardProps["category"], string> = {
  "взрослым": "bg-[#C49A2E]",
  "вместе": "bg-[#5B8C7A]",
  "детям": "bg-[#D4789A]",
};

function guestsLabel(count: number): string {
  if (count <= 4) return "гостя";
  return "гостей";
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block mr-1"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function MKCard({
  id,
  imageUrl,
  category,
  title,
  time,
  duration,
  guestsCount,
  priceMin,
  priceMax,
  onSignUp,
  onTap,
  className = "",
}: MKCardProps) {
  return (
    <div
      className={[
        "bg-white rounded-2xl overflow-hidden w-full",
        "shadow-[0_2px_16px_rgba(0,0,0,.09)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-card-id={id}
    >
      {/* Photo */}
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <img
          src={imageUrl}
          alt={title}
          className="w-full h-full object-cover rounded-t-2xl"
        />
        {/* Category pill */}
        <span
          className={[
            "absolute top-3 left-3 px-2 py-0.5 rounded-full text-xs text-white font-medium",
            categoryColors[category],
          ].join(" ")}
        >
          {category}
        </span>
      </div>

      {/* Content */}
      <div className="px-4 pt-3">
        {/* Title */}
        <h3
          className="font-playfair text-lg font-bold text-[#1a1a1a] cursor-pointer"
          onClick={onTap}
        >
          {title}
        </h3>

        {/* Time + Duration */}
        <p className="text-sm text-[#555555] mt-1 flex items-center">
          <ClockIcon />
          {time}
          <span className="mx-1.5">•</span>
          {duration}
        </p>

        {/* Social proof */}
        <p className="text-[13px] text-[#888888] mt-2">
          Уже {guestsCount} {guestsLabel(guestsCount)}
        </p>

        {/* Price */}
        <p className="text-base font-bold text-[#1a1a1a] mt-2">
          {priceMin} – {priceMax} ₽
        </p>

        {/* Details button */}
        <div className="mt-3 mb-4">
          <Button
            variant="primary"
            size="md"
            onClick={onSignUp}
            className="w-full"
          >
            Подробнее
          </Button>
        </div>
      </div>
    </div>
  );
}

export default MKCard;
