"use client";

import type { ActivityView } from "@/app/lib/model/view/activity";
import { useState } from "react";
import { useServicePhotos } from "../hooks/useServicePhotos";
import { Overlay } from "./Overlay";
import { Button } from "./Button";

export interface ActivityDetailProps {
  isOpen: boolean;
  onClose: () => void;
  activityId: string;
  activities: ActivityView[];
  onBook?: () => void;
  onSelectActivity?: (activity: ActivityView) => void;
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
  activityId,
  activities,
  onBook,
  onSelectActivity,
}: ActivityDetailProps) {
  const activity = activities.find((a) => a.id === activityId);
  // GH #576 (spec §6.4–6.5): one service-scoped photo query feeds the strip.
  // Hooks run before the not-found early return (rules of hooks); real usage
  // always mounts with a resolvable activityId (page.tsx gates the mount).
  const { photos } = useServicePhotos(activity?.serviceId ?? "");
  const [selectedSrc, setSelectedSrc] = useState<string | null>(null);
  if (!activity) return null;

  // Strip composition (spec §6.5): cover first (when present), then service
  // photos in API order; the strip renders only when the photo set is
  // non-empty — an empty response leaves the photo block as it is today.
  const hasCover = Boolean(activity.imageUrl);
  const hasStrip = photos.length > 0;
  const defaultMainSrc = hasCover ? activity.imageUrl : photos[0]?.url ?? activity.imageUrl;
  const mainSrc = selectedSrc ?? defaultMainSrc;

  const stripItems = [
    ...(hasCover ? [{ key: "cover", src: activity.imageUrl, label: "Обложка занятия" }] : []),
    ...photos.map((photo, index) => ({
      key: photo.id,
      src: photo.url,
      label: photo.caption ? `Фото: ${photo.caption}` : `Фото ${index + 1}`,
    })),
  ];

  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="dynamic" title={activity.title}
      footer={onBook ? (
        <Button variant="primary" size="lg" onClick={onBook} className="w-full">
          Участвовать
        </Button>
      ) : undefined}
    >
      <div className="flex flex-col gap-4">

        {/* 1. Photo */}
        <div className="rounded-xl overflow-hidden flex-shrink-0 -mx-4 -mt-4">
          <img
            data-testid="activity-photo-main"
            src={mainSrc}
            alt=""
            className="w-full aspect-video object-cover"
          />
        </div>

        {/* 1b. Thumbnail strip (GH #576, spec §6.5): cover + service photos.
            Keyboard-scrollable group; thumbnails are native buttons swapping
            the main image via local state — no extra requests. */}
        {hasStrip && (
          <div
            data-testid="activity-photo-strip"
            className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar"
            role="group"
            aria-label="Фотографии занятия"
            tabIndex={0}
          >
            {stripItems.map((item) => (
              <button
                key={item.key}
                type="button"
                data-testid="activity-photo-thumb"
                aria-label={item.label}
                aria-current={mainSrc === item.src ? "true" : undefined}
                onClick={() => setSelectedSrc(item.src)}
                className={`flex-shrink-0 rounded-lg overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#004D56] ${
                  mainSrc === item.src ? "ring-2 ring-[#004D56]" : "ring-1 ring-black/10"
                }`}
              >
                <img
                  src={item.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={80}
                  height={56}
                  className="w-20 h-14 object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {/* 2. Date + time */}
        <div className="flex items-center gap-2 text-sm text-[#1a1a1a]">
          <svg className="w-4 h-4 text-[#888888] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>{activity.dateFormatted}</span>
          <svg className="w-4 h-4 text-[#888888] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{activity.time}</span>
        </div>

        {/* 3. Location + Teacher */}
        <div className="flex items-start justify-between text-sm">
          <div>
            <div className="text-[#888888] text-xs">Локация</div>
            <div className="relative inline-block mt-0.5">
              <HintText details={activity.location.address ?? activity.locationDetails}>
                {activity.location.title}
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

        {/* 4. Material + Cost — the materials block renders ONLY when details exist (GH #223 §9:
            a service with zero linked materials renders no materials block at all) */}
        <div className="flex items-start justify-between text-sm">
          {activity.materialDetails && (
            <div data-testid="material-block">
              <div className="text-[#888888] text-xs">Материал</div>
              <div className="relative inline-block mt-0.5">
                <HintText details={activity.materialDetails}>{activity.material}</HintText>
              </div>
            </div>
          )}
          <div className="text-right ml-auto">
            <div className="text-[#888888] text-xs">Стоимость</div>
            <div className="relative inline-block mt-0.5">
              <HintText details={activity.priceDetails} align="right">
                {formatPrice(activity.priceMin)} – {formatPrice(activity.priceMax)} ₽
              </HintText>
            </div>
          </div>
        </div>

        {/* 5. Other activities pills */}
        {activities.length > 1 && (
          <div>
            <div className="text-xs text-[#888888] mb-1.5">В другой раз</div>
            <div className="flex flex-wrap gap-1.5">
              {activities
                .filter((a) =>
                  a.id !== activity.id &&
                  a.location.id === activity.location.id &&
                  a.material === activity.material &&
                  a.category === activity.category
                )
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(0, 6)
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onSelectActivity?.(a)}
                    className="px-3 py-1.5 rounded-full border border-[#004D56]/30 text-xs text-[#004D56] hover:bg-[#004D56] hover:text-white transition"
                  >
                    {a.dateFormatted} {a.time}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Spacer so content doesn't get hidden behind the fixed footer */}
        <div className="h-2" />
      </div>
    </Overlay>
  );
}

export default ActivityDetail;
