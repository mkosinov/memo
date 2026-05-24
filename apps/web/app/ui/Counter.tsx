export interface CounterProps {
  label: string;
  subLabel?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function Counter({
  label,
  subLabel,
  value,
  onChange,
  min = 0,
  max = 99,
}: CounterProps) {
  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-base text-[#1a1a1a]">{label}</div>
        {subLabel && (
          <div className="text-sm text-[#888888]">{subLabel}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease"
          disabled={atMin}
          onClick={() => onChange(value - 1)}
          className={[
            "w-8 h-8 rounded-full border border-[#E0E0E1] flex items-center justify-center",
            "text-[#1a1a1a] transition",
            atMin && "opacity-50 cursor-not-allowed",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          −
        </button>
        <span className="text-base font-medium w-8 text-center">{value}</span>
        <button
          type="button"
          aria-label="Increase"
          disabled={atMax}
          onClick={() => onChange(value + 1)}
          className={[
            "w-8 h-8 rounded-full border border-[#E0E0E1] flex items-center justify-center",
            "text-[#1a1a1a] transition",
            atMax && "opacity-50 cursor-not-allowed",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default Counter;
