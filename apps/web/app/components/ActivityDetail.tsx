import { Overlay } from "./Overlay";
import { Button } from "./Button";

export interface ActivityDetailProps {
  isOpen: boolean;
  onClose: () => void;
  activity: {
    id: string;
    imageUrl: string;
    guestPhotos?: string[];
    teacherName: string;
    teacherAvatar?: string;
    date: string;
    time: string;
    material: string;
    materialDetails?: string;
    priceMin: number;
    priceMax: number;
    priceDetails?: string;
    nextTime?: string;
    nextTimeLocation?: string;
    location: string;
    locationAddress?: string;
  };
  onOpenMaterialDetails?: () => void;
  onOpenPriceDetails?: () => void;
  onOpenNextTime?: () => void;
  onOpenLocationDetails?: () => void;
  onBook?: () => void;
}

function formatPrice(value: number): string {
  return value.toLocaleString("ru-RU");
}

function DetailLink({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-[#004D56] hover:underline transition"
    >
      {label}
    </button>
  );
}

export function ActivityDetail({
  isOpen,
  onClose,
  activity,
  onOpenMaterialDetails,
  onOpenPriceDetails,
  onOpenNextTime,
  onOpenLocationDetails,
  onBook,
}: ActivityDetailProps) {
  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="half">
      <div className="space-y-4 px-4 py-4">
        {/* Main photo */}
        <div className="rounded-t-2xl overflow-hidden -mx-4 -mt-4">
          <img
            src={activity.imageUrl}
            alt=""
            className="w-full aspect-video object-cover"
          />
        </div>

        {/* Guest photos strip */}
        {activity.guestPhotos && activity.guestPhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {activity.guestPhotos.map((photo, index) => (
              <img
                key={index}
                src={photo}
                alt={`Guest work ${index + 1}`}
                className="w-[60px] h-[60px] rounded-lg object-cover flex-shrink-0"
              />
            ))}
          </div>
        )}

        {/* Teacher */}
        <div className="flex items-center gap-3">
          {activity.teacherAvatar && (
            <img
              src={activity.teacherAvatar}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
          )}
          <span className="text-base text-[#1a1a1a] font-medium">
            {activity.teacherName}
          </span>
        </div>

        {/* Date and time */}
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-[#888888] flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-base text-[#1a1a1a]">{activity.date}</span>
          <svg
            className="w-4 h-4 text-[#888888] flex-shrink-0 ml-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-base text-[#1a1a1a]">{activity.time}</span>
        </div>

        {/* Material section */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-[#888888]">Материал</div>
            <div className="text-base text-[#1a1a1a]">{activity.material}</div>
          </div>
          <DetailLink
            label="Подробнее"
            onClick={onOpenMaterialDetails}
          />
        </div>

        {/* Price section */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-[#888888]">Стоимость</div>
            <div className="text-base text-[#1a1a1a]">
              {formatPrice(activity.priceMin)} – {formatPrice(activity.priceMax)} ₽
            </div>
          </div>
          <DetailLink label="Подробнее" onClick={onOpenPriceDetails} />
        </div>

        {/* Next time section */}
        {activity.nextTime && (
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-[#888888]">В следующий раз</div>
              <div className="text-base text-[#1a1a1a]">{activity.nextTime}</div>
              {activity.nextTimeLocation && (
                <div className="text-sm text-[#555555]">
                  {activity.nextTimeLocation}
                </div>
              )}
            </div>
            <DetailLink label="Подробнее" onClick={onOpenNextTime} />
          </div>
        )}

        {/* Location section */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-[#888888]">Локация</div>
            <div className="text-base text-[#1a1a1a]">{activity.location}</div>
          </div>
          <DetailLink label="Подробнее" onClick={onOpenLocationDetails} />
        </div>

        {/* Book button */}
        {onBook && (
          <Button variant="primary" size="lg" onClick={onBook} className="w-full">
            Участвовать
          </Button>
        )}
      </div>
    </Overlay>
  );
}

export default ActivityDetail;
