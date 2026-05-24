"use client";

import { useState } from "react";
import { Header } from "../ui/Header";
import { Overlay } from "../ui/Overlay";

export interface HeroProps {
  onMenuToggle?: () => void;
  locations?: { id: string; name: string }[];
  selectedLocation?: string | null;
  onSelectLocation?: (locationId: string | null) => void;
}

const PILLS = [
  {
    key: "newbie",
    label: "Новичкам подходит",
    title: "Новичкам подходит",
    content:
      "Наши мастер-классы подходят для любого уровня подготовки. Профессиональный преподаватель шаг за шагом проведёт вас через весь процесс создания картины. Все материалы включены — просто приходите и творите!",
  },
  {
    key: "included",
    label: "Всё включено",
    title: "Всё включено",
    content:
      "В стоимость мастер-класса входит всё необходимое: холст или бумага, краски, кисти, фартук и другие материалы. Готовую работу вы забираете с собой. Чай и уютная атмосфера — в подарок ☕",
  },
  {
    key: "nearby",
    label: "Рядом с вами",
    title: "Выберите локацию",
  },
] as const;

export function Hero({ onMenuToggle, locations, selectedLocation, onSelectLocation }: HeroProps) {
  const [activePill, setActivePill] = useState<string | null>(null);

  const currentLocationName = selectedLocation && locations
    ? locations.find((l) => l.id === selectedLocation)?.name
    : null;

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{ height: "36svh", minHeight: "240px", maxHeight: "300px" }}
    >
      {/* Background image */}
      <img
        src="/images/hero-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.6))",
        }}
      />

      {/* Header (transparent on hero) */}
      <Header onMenuToggle={onMenuToggle} isScrolled={false} position="absolute" />

      {/* Centered content */}
      <div className="absolute inset-0 flex flex-col px-4 pb-4 pt-14">
        {/* Spacer to push content down below Header */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Title */}
          <h1
            className="text-xl text-white text-center leading-snug"
            style={{ fontFamily: "var(--font-playfair)", fontWeight: 400 }}
          >
            Рисуйте в горах
            <br />
            и увозите{" "}
            <em
              className="not-italic"
              style={{ fontFamily: "var(--font-great-vibes)", color: "#C49A2E", fontSize: "1.5em", fontWeight: 400 }}
            >
              эмоции
            </em>{" "}
            с собой ♡
          </h1>
        </div>

        {/* Pills row — кликабельные, открывают overlay */}
        <div className="flex items-center justify-center gap-2">
          {PILLS.map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={() => setActivePill(pill.key)}
              className="rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap transition hover:opacity-90 active:scale-95"
              style={{ backgroundColor: "rgba(255,255,255,0.85)", color: "#1a1a1a" }}
            >
              {pill.key === "nearby" && currentLocationName
                ? `📍 ${currentLocationName}`
                : pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overlay: Новичкам подходит */}
      <Overlay
        isOpen={activePill === "newbie"}
        onClose={() => setActivePill(null)}
        size="half"
      >
        <div className="px-2">
          <h3
            className="text-lg font-bold text-[#1a1a1a] mb-3"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Новичкам подходит
          </h3>
          <p className="text-sm text-[#555555] leading-relaxed">
            Наши мастер-классы подходят для любого уровня подготовки. Профессиональный преподаватель
            шаг за шагом проведёт вас через весь процесс создания картины. Все материалы включены —
            просто приходите и творите!
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">🎨</span>
              <span className="text-sm text-[#555555]">Все материалы предоставляются</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">👩‍🏫</span>
              <span className="text-sm text-[#555555]">Опытный преподаватель рядом</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">🖼️</span>
              <span className="text-sm text-[#555555]">Готовую работу забираете домой</span>
            </div>
          </div>
        </div>
      </Overlay>

      {/* Overlay: Всё включено */}
      <Overlay
        isOpen={activePill === "included"}
        onClose={() => setActivePill(null)}
        size="half"
      >
        <div className="px-2">
          <h3
            className="text-lg font-bold text-[#1a1a1a] mb-3"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Всё включено
          </h3>
          <p className="text-sm text-[#555555] leading-relaxed">
            В стоимость мастер-класса входит всё необходимое. Вам не нужно ничего приносить с собой —
            только хорошее настроение!
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">🖌️</span>
              <span className="text-sm text-[#555555]">Холст / бумага, краски, кисти</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">👕</span>
              <span className="text-sm text-[#555555]">Фартук, чтобы не испачкаться</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">☕</span>
              <span className="text-sm text-[#555555]">Чай, кофе и уютная атмосфера</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">🎁</span>
              <span className="text-sm text-[#555555]">Готовую работу забираете с собой</span>
            </div>
          </div>
        </div>
      </Overlay>

      {/* Overlay: Рядом с вами (выбор локации) */}
      <Overlay
        isOpen={activePill === "nearby"}
        onClose={() => setActivePill(null)}
        size="half"
      >
        <div className="px-2">
          <h3
            className="text-lg font-bold text-[#1a1a1a] mb-4"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Выберите локацию
          </h3>

          {/* Сначала попробовать гео: "Рядом с вами" */}
          <button
            type="button"
            onClick={() => {
              // Геолокация — попробуем определить
              if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                  () => {
                    // Если получилось — выбираем первую локацию
                    if (locations && locations.length > 0) {
                      onSelectLocation?.(locations[0].id);
                    }
                    setActivePill(null);
                  },
                  () => {
                    // Если нет доступа — просто открываем список
                    onSelectLocation?.(null);
                    setActivePill(null);
                  },
                );
              } else {
                onSelectLocation?.(null);
                setActivePill(null);
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

          {/* Все локации */}
          <button
            type="button"
            onClick={() => {
              onSelectLocation?.(null);
              setActivePill(null);
            }}
            className={[
              "w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-3",
              !selectedLocation
                ? "bg-[#004D56]/10 text-[#004D56] font-medium"
                : "text-[#555555] hover:bg-gray-50",
            ].join(" ")}
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span>Все локации</span>
            {!selectedLocation && (
              <svg className="w-5 h-5 ml-auto text-[#004D56]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          <div className="h-px bg-[#E0E0E1] my-1" />

          {/* Список локаций */}
          {locations?.map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => {
                onSelectLocation?.(loc.id);
                setActivePill(null);
              }}
              className={[
                "w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-3",
                selectedLocation === loc.id
                  ? "bg-[#004D56]/10 text-[#004D56] font-medium"
                  : "text-[#555555] hover:bg-gray-50",
              ].join(" ")}
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>{loc.name}</span>
              {selectedLocation === loc.id && (
                <svg className="w-5 h-5 ml-auto text-[#004D56]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </Overlay>
    </section>
  );
}

export default Hero;
