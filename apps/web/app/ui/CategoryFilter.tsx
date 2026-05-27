"use client";

import { useState } from "react";
import { Overlay } from "./Overlay";

export interface CategoryFilterProps {
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
}

const CATEGORY_ITEMS = [
  { id: "детям", label: "детям", icon: "👧", desc: "Увлекательный досуг для юных мастеров" },
  { id: "взрослым", label: "взрослым", icon: "🎨", desc: "Глубокое творчество без суеты" },
  { id: "вместе", label: "вместе", icon: "👪", desc: "Семейный формат и отдых с друзьями" },
  { id: "вдвоём", label: "вдвоём", icon: "❤️", desc: "Свидания и парное творчество" },
  { id: "есть только 1 час", label: "есть только 1 час", icon: "⏱️", desc: "Быстрые мастер-классы" },
  { id: "в дождливую погоду", label: "в дождливую погоду", icon: "🌧️", desc: "Уютное творчество под крышей" },
  { id: "на свежем воздухе", label: "на свежем воздухе", icon: "🌿", desc: "Пленэры и творчество на природе" },
  { id: "для компаний", label: "для компаний", icon: "🥳", desc: "Для праздников и тимбилдингов" },
] as const;

export function CategoryFilter({
  selectedCategory,
  onSelectCategory,
}: CategoryFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentLabel = selectedCategory
    ? CATEGORY_ITEMS.find((c) => c.id === selectedCategory)?.label ?? "Кому"
    : "Кому угодно";

  return (
    <>
      {/* Pill trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={[
          "rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition flex items-center gap-1.5",
          selectedCategory
            ? "bg-[#004D56] text-white"
            : "border border-[#E0E0E1] text-[#555555] hover:border-[#004D56] hover:text-[#004D56]",
        ].join(" ")}
      >
        {/* User icon */}
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

      {/* Overlay with category options */}
      <Overlay isOpen={isOpen} onClose={() => setIsOpen(false)} size="half" title="Кому подбираем мастер-класс?">
        <div className="px-2 max-h-[80dvh] overflow-y-auto no-scrollbar">
          {/* All option */}
          <button
            type="button"
            onClick={() => {
              onSelectCategory(null);
              setIsOpen(false);
            }}
            className={[
              "w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-3",
              !selectedCategory
                ? "bg-[#004D56]/10 text-[#004D56] font-medium"
                : "text-[#555555] hover:bg-gray-50",
            ].join(" ")}
          >
            <span className="text-xl">🌟</span>
            <div className="flex flex-col">
              <span className="font-medium text-sm">Кому угодно</span>
              <span className="text-xs opacity-60">Показать все мастер-классы</span>
            </div>
            {!selectedCategory && (
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

          <div className="h-px bg-[#E0E0E1] my-2" />

          {/* Category items */}
          {CATEGORY_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectCategory(item.id);
                setIsOpen(false);
              }}
              className={[
                "w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-3 my-1",
                selectedCategory === item.id
                  ? "bg-[#004D56]/10 text-[#004D56] font-medium"
                  : "text-[#555555] hover:bg-gray-50",
              ].join(" ")}
            >
              <span className="text-xl">{item.icon}</span>
              <div className="flex flex-col">
                <span className="font-medium text-sm">{item.label}</span>
                <span className="text-xs opacity-60">{item.desc}</span>
              </div>
              {selectedCategory === item.id && (
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

export default CategoryFilter;
