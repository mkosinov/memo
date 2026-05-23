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
    title: string;
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
    teacherDetails?: string;
  };
  onBook?: () => void;
  onNavigateToActivity?: (activityId: string) => void;
}

function formatPrice(value: number): string {
  return value.toLocaleString("ru-RU");
}

/** Hint with underlined trigger text */
function HintText({
  details,
  align = "left",
  children,
}: {
  details?: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!details) return <>{children}</>;

  return (
    <span
      className="inline-flex items-center gap-1 cursor-pointer group relative"
      role="button"
      tabIndex={0}
      aria-label={`Подробнее о ${children}`}
      onClick={() => setIsOpen(!isOpen)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsOpen(!isOpen); } }}
    >
      <span className="border-b border-dashed border-[#888888]/60 group-hover:border-[#004D56] transition-colors">
        {children}
      </span>
      <span className="w-4 h-4 rounded-full border border-[#888888] text-[10px] text-[#888888] flex items-center justify-center flex-shrink-0 group-hover:border-[#004D56] group-hover:text-[#004D56] transition-colors">
        i
      </span>
      {isOpen && (
        <span className={`absolute top-full mt-1 z-10 w-64 p-3 bg-white rounded-lg shadow-lg border border-gray-200 text-sm text-[#1a1a1a] ${align === "right" ? "right-0" : "left-0"}`}>
          {details}
        </span>
      )}
    </span>
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
    <Overlay isOpen={isOpen} onClose={onClose} size="three-quarters" title={activity.title}>
      <div className="flex flex-col gap-4 px-4 pb-4 h-full overflow-hidden">

        {/* 1. Photo */}
        <div className="rounded-xl overflow-hidden flex-shrink-0 -mx-4 -mt-4">
          <img src={activity.imageUrl} alt="" className="w-full aspect-video object-cover" />
        </div>

        {/* 2. Date + time */}
        <div className="flex items-center gap-2 text-sm text-[#1a1a1a]">
          <svg className="w-4 h-4 text-[#888888] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>{activity.date}</span>
          <svg className="w-4 h-4 text-[#888888] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{activity.time}</span>
        </div>

        {/* 3. Location + Teacher — в одну строку */}
        <div className="flex items-start justify-between text-sm">
          <div>
            <div className="text-[#888888] text-xs">Локация</div>
            <div className="relative inline-block mt-0.5">
              <HintText details={activity.locationAddress ?? activity.locationDetails}>
                {activity.location}
              </HintText>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[#888888] text-xs">Мастер</div>
            <div className="flex items-center justify-end gap-2 mt-0.5">
              {activity.teacherAvatar && (
                <img src={activity.teacherAvatar} alt="" className="w-5 h-5 rounded-full object-cover" />
              )}
              <div className="relative inline-block">
                <HintText details={activity.teacherDetails} align="right">
                  {activity.teacherName}
                </HintText>
              </div>
            </div>
          </div>
        </div>

        {/* 4. Material + Cost — в одну строку */}
        <div className="flex items-start justify-between text-sm">
          <div>
            <div className="text-[#888888] text-xs">Материал</div>
            <div className="relative inline-block mt-0.5">
              <HintText details={activity.materialDetails}>{activity.material}</HintText>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[#888888] text-xs">Стоимость</div>
            <div className="relative inline-block mt-0.5">
              <HintText details={activity.priceDetails} align="right">
                {formatPrice(activity.priceMin)} – {formatPrice(activity.priceMax)} ₽
              </HintText>
            </div>
          </div>
        </div>

        {/* 5. Next times pills */}
        {activity.nextTimes && activity.nextTimes.length > 0 && (
          <div>
            <div className="text-xs text-[#888888] mb-1.5">В следующий раз</div>
            <div className="flex flex-wrap gap-1.5">
              {activity.nextTimes.slice(0, 3).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onNavigateToActivity?.(opt.id)}
                  className="px-3 py-1.5 rounded-full border border-[#004D56]/30 text-xs text-[#004D56] hover:bg-[#004D56] hover:text-white transition"
                >
                  {opt.date} {opt.time}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Spacer + 7. Book button */}
        <div className="mt-auto pt-1">
          {onBook && (
            <Button variant="primary" size="lg" onClick={onBook} className="w-full">
              Участвовать
            </Button>
          )}
        </div>
      </div>
    </Overlay>
  );
}

export default ActivityDetail;
