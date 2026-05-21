"use client";

import { useState } from "react";
import { Overlay } from "./Overlay";
import { Button } from "./Button";

export interface NextTimeOption {
  id: string;
  date: string;
  time: string;
}

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
    nextTimes?: NextTimeOption[];
    location: string;
    locationAddress?: string;
    locationDetails?: string;
  };
  onBook?: () => void;
  onNavigateToActivity?: (activityId: string) => void;
}

function formatPrice(value: number): string {
  return value.toLocaleString("ru-RU");
}

function HintIcon({
  label,
  details,
}: {
  label: string;
  details?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!details) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Подробнее о ${label}`}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-5 h-5 rounded-full border border-[#004D56] text-[#004D56] text-xs font-medium hover:bg-[#004D56] hover:text-white transition"
      >
        i
      </button>
      {isOpen && (
        <div
          data-testid="hint-tooltip"
          className="absolute right-0 top-7 z-10 w-64 p-3 bg-white rounded-lg shadow-lg border border-gray-200 text-sm text-[#1a1a1a]"
        >
          {details}
        </div>
      )}
    </div>
  );
}

export function ActivityDetail({
  isOpen,
  onClose,
  activity,
  onBook,
  onNavigateToActivity,
}: ActivityDetailProps) {
  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="three-quarters">
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
          <HintIcon label="материале" details={activity.materialDetails} />
        </div>

        {/* Price section */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-[#888888]">Стоимость</div>
            <div className="text-base text-[#1a1a1a]">
              {formatPrice(activity.priceMin)} – {formatPrice(activity.priceMax)} ₽
            </div>
          </div>
          <HintIcon label="стоимости" details={activity.priceDetails} />
        </div>

        {/* Next time section */}
        {activity.nextTimes && activity.nextTimes.length > 0 && (
          <div>
            <div className="text-sm text-[#888888] mb-2">В следующий раз</div>
            <div className="flex flex-wrap gap-2">
              {activity.nextTimes.slice(0, 3).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onNavigateToActivity?.(option.id)}
                  className="text-base text-[#004D56] hover:underline transition cursor-pointer"
                >
                  {option.date} {option.time}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Location section */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-[#888888]">Локация</div>
            <div className="text-base text-[#1a1a1a]">{activity.location}</div>
          </div>
          <HintIcon label="локации" details={activity.locationAddress || activity.locationDetails} />
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
