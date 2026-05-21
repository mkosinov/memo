import { Header } from "../components/Header";

export interface HeroProps {
  onMenuToggle?: () => void;
}

const PILLS = [
  "Новичкам подходит",
  "Всё включено",
  "Рядом с вами",
] as const;

export function Hero({ onMenuToggle }: HeroProps) {
  return (
    <section
      className="relative w-full"
      style={{ height: "36svh", minHeight: "240px", maxHeight: "300px" }}
    >
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80)",
        }}
      />

      {/* Gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.6))",
        }}
      />

      {/* Header (transparent on hero) */}
      <Header onMenuToggle={onMenuToggle} isScrolled={false} />

      {/* Centered content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
        {/* Title */}
        <h1
          className="text-[26px] font-bold text-white text-center leading-tight"
          style={{ fontFamily: "var(--font-playfair)" }}
        >
          Цветные Горы
        </h1>

        {/* Subtitle */}
        <p
          className="text-sm mt-1"
          style={{ color: "#C49A2E" }}
        >
          Студия рисования
        </p>

        {/* Pills row */}
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mt-3">
          {PILLS.map((pill, index) => (
            <span
              key={pill}
              className="rounded-full px-3 py-1 text-xs text-ink"
              style={{ backgroundColor: "rgba(255,255,255,0.85)" }}
            >
              {pill}
              {index < PILLS.length - 1 && (
                <span className="ml-2 text-ink-light">·</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export default Hero;
