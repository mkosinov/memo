const CHIPS = [
  "👶 Для ребёнка 8 лет",
  "❤️ Для двоих",
  "🌧 Чем заняться в дождь",
  "⏱ Есть только 1 час",
] as const;

export interface ChatBarProps {
  onChipClick?: (chip: string) => void;
  onSend?: () => void;
}

export function ChatBar({ onChipClick, onSend }: ChatBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md bg-white/80">
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-3">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onChipClick?.(chip)}
            className="rounded-full border border-[#E0E0E1] px-3 py-1.5 text-sm text-ink-mid whitespace-nowrap"
          >
            {chip}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onSend?.()}
          className="rounded-lg bg-[#004D56] px-4 py-2 text-sm text-white whitespace-nowrap"
        >
          Отправить
        </button>
      </div>
    </div>
  );
}

export default ChatBar;
