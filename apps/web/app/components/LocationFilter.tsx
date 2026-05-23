"use client";

import { useState } from "react";
import { Overlay } from "./Overlay";

export interface LocationFilterProps {
  locations: { id: string; name: string }[];
  selectedLocation: string | null;
  onSelectLocation: (locationId: string | null) => void;
}

export function LocationFilter({
  locations,
  selectedLocation,
  onSelectLocation,
}: LocationFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentLabel = selectedLocation
    ? locations.find((l) => l.id === selectedLocation)?.name ?? "Локация"
    : "Все локации";

  return (
    <>
      {/* Pill trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={[
          "rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition flex items-center gap-1.5",
          selectedLocation
            ? "bg-[#004D56] text-white"
            : "border border-[#E0E0E1] text-[#555555] hover:border-[#004D56] hover:text-[#004D56]",
        ].join(" ")}
      >
        {/* Pin icon */}
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span>{currentLabel}</span>
        <svg
          className="w-3 h-3 flex-shrink-0 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Overlay with location list */}
      <Overlay isOpen={isOpen} onClose={() => setIsOpen(false)} size="half">
        <div className="px-2">
          <h3 className="text-lg font-bold text-[#1a1a1a] mb-4">
            Выберите локацию
          </h3>

          {/* Рядом с вами — геолокация */}
          <button
            type="button"
            onClick={() => {
              if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                  () => {
                    if (locations.length > 0) {
                      onSelectLocation(locations[0].id);
                    }
                    setIsOpen(false);
                  },
                  () => {
                    onSelectLocation(null);
                    setIsOpen(false);
                  },
                );
              } else {
                onSelectLocation(null);
                setIsOpen(false);
              }
            }}
            className="w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-3 hover:bg-gray-50 text-[#004D56] font-medium"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s-8-6-8-12a8 8 0 0 1 16 0c0 6-8 12-8 12z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>📍 Рядом с вами</span>
          </button>

          <div className="h-px bg-[#E0E0E1] my-2" />

          {/* All locations option */}
          <button
            type="button"
            onClick={() => {
              onSelectLocation(null);
              setIsOpen(false);
            }}
            className={[
              "w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-3",
              !selectedLocation
                ? "bg-[#004D56]/10 text-[#004D56] font-medium"
                : "text-[#555555] hover:bg-gray-50",
            ].join(" ")}
          >
            <svg
              className="w-5 h-5 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span>Все локации</span>
            {!selectedLocation && (
              <svg
                className="w-5 h-5 ml-auto text-[#004D56]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          <div className="h-px bg-[#E0E0E1] my-1" />

          {/* Location options */}
          {locations.map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => {
                onSelectLocation(loc.id);
                setIsOpen(false);
              }}
              className={[
                "w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-3",
                selectedLocation === loc.id
                  ? "bg-[#004D56]/10 text-[#004D56] font-medium"
                  : "text-[#555555] hover:bg-gray-50",
              ].join(" ")}
            >
              {/* Pin icon */}
              <svg
                className="w-5 h-5 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>{loc.name}</span>
              {selectedLocation === loc.id && (
                <svg
                  className="w-5 h-5 ml-auto text-[#004D56]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </Overlay>
    </>
  );
}

export default LocationFilter;
