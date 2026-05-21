import { Button } from "./Button";

export interface MKCardProps {
  id: string;
  imageUrl?: string;
  category?: "взрослым" | "вместе" | "детям";
  title: string;
  time?: string;
  duration?: string;
  guestsCount?: number;
  priceMin?: number;
  priceMax?: number;
  onSignUp?: () => void;
  onTap?: () => void;
  className?: string;
  /** Variant for the last/booking card — renders outlined style without photo */
  variant?: "default" | "custom";
  /** Description text for custom variant */
  description?: string;
  /** Single price for custom variant */
  price?: number;
}

const categoryColors: Record<NonNullable<MKCardProps["category"]>, string> = {
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
  variant = "default",
  description,
  price,
}: MKCardProps) {
  if (variant === "custom") {
    return (
      <div
        className={[
          "bg-white rounded-2xl overflow-hidden w-full",
          "border-2 border-dashed border-[#004D56]/30",
          "shadow-[0_2px_16px_rgba(0,0,0,.09)]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        data-card-id={id}
      >
        {/* Content */}
        <div className="px-5 pt-6 pb-5 flex flex-col items-center text-center">
          {/* Palette icon */}
          <div className="w-14 h-14 rounded-full bg-[#004D56]/10 flex items-center justify-center mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-7 h-7 text-[#004D56]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
              />
            </svg>
          </div>

          {/* Title */}
          <h3 className="font-playfair text-lg font-bold text-[#1a1a1a]">
            {title}
          </h3>

          {/* Description */}
          {description && (
            <p className="text-sm text-[#555555] mt-2">{description}</p>
          )}

          {/* Price */}
          {price !== undefined && (
            <p className="text-base font-bold text-[#1a1a1a] mt-3">
              {price.toLocaleString("ru-RU")} ₽
            </p>
          )}

          {/* Book button */}
          <div className="mt-4 w-full">
            <Button
              variant="primary"
              size="md"
              onClick={onSignUp}
              className="w-full"
            >
              Записаться
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <img
          src={imageUrl ?? ""}
          alt={title}
          className="w-full h-full object-cover rounded-t-2xl"
        />
        {/* Category pill */}
        {category && (
          <span
            className={[
              "absolute top-3 left-3 px-2 py-0.5 rounded-full text-xs text-white font-medium",
              categoryColors[category],
            ].join(" ")}
          >
            {category}
          </span>
        )}
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
        {time && (
          <p className="text-sm text-[#555555] mt-1 flex items-center">
            <ClockIcon />
            {time}
            {duration && <span className="mx-1.5">•</span>}
            {duration}
          </p>
        )}

        {/* Social proof */}
        {guestsCount !== undefined && (
          <p className="text-[13px] text-[#888888] mt-2">
            Уже {guestsCount} {guestsLabel(guestsCount)}
          </p>
        )}

        {/* Price */}
        {priceMin !== undefined && priceMax !== undefined && (
          <p className="text-base font-bold text-[#1a1a1a] mt-2">
            {priceMin} – {priceMax} ₽
          </p>
        )}

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
