export interface ChatBarProps {
  onSend?: () => void;
}

export function ChatBar({ onSend }: ChatBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md bg-white/80 border-t border-[#E0E0E1]/30">
      <div className="flex justify-center px-4 py-3">
        <button
          type="button"
          onClick={() => onSend?.()}
          className="rounded-lg bg-[#004D56] px-6 py-2.5 text-sm font-medium text-white flex items-center gap-2 hover:bg-[#006670] transition-colors shadow-sm"
        >
          {/* Chat icon */}
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Задать вопрос в чате</span>
        </button>
      </div>
    </div>
  );
}

export default ChatBar;
