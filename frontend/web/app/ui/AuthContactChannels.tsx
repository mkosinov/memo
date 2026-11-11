"use client";

import { useEffect, useRef, useState } from "react";
import { telegramLink, whatsappLink } from "@/app/lib/contacts";

export interface AuthContactChannelsProps {
  /** The prefilled message: booking — the request details; cabinet — a greeting. */
  message: string;
}

/** Copied-feedback lifetime; the badge is cosmetic, not a spec surface. */
const COPIED_FEEDBACK_MS = 2500;

/**
 * The «Связаться» panel (#593 §Фронт web): the message text, «Скопировать
 * текст» (the universal fallback — messenger text-prefill reliability varies
 * between clients), and the administrator's messengers. An empty contact
 * hides its button; both empty → no messenger buttons at all (the text and
 * the copy button remain — the empty-registry client can still reach out).
 */
export function AuthContactChannels({ message }: AuthContactChannelsProps) {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const tg = telegramLink(message);
  const wa = whatsappLink(message);

  const flashFeedback = (kind: "copied" | "failed") => {
    setFeedback(kind);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback("idle"), COPIED_FEEDBACK_MS);
  };

  const handleCopy = async () => {
    // A MISSING clipboard API must read as failure: `clipboard?.writeText`
    // resolves (undefined) when absent (non-secure http) — the success badge
    // would lie. On any failure the message text stays selectable (the
    // manual fallback), so we only swap the feedback.
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (write === undefined) {
      flashFeedback("failed");
      return;
    }
    try {
      await write(message);
      flashFeedback("copied");
    } catch {
      flashFeedback("failed");
    }
  };

  return (
    <div
      data-testid="auth-contact-channels"
      className="rounded-lg border border-[#E0E0E1] bg-[#F5F5F4] p-4 space-y-3"
    >
      <p className="text-sm text-[#1a1a1a] whitespace-pre-line">{message}</p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleCopy()}
          data-testid="auth-contact-copy"
          className={
            feedback === "failed"
              ? "text-sm text-[#C8503C]"
              : "text-sm text-[#004D56] underline underline-offset-2 hover:opacity-80 transition"
          }
        >
          {feedback === "copied"
            ? "Скопировано"
            : feedback === "failed"
              ? "Не удалось скопировать — скопируйте текст вручную"
              : "Скопировать текст"}
        </button>

        {wa !== null && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[#25D366] px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            WhatsApp
          </a>
        )}
        {tg !== null && (
          <a
            href={tg}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[#229ED9] px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Telegram
          </a>
        )}
      </div>
    </div>
  );
}

export default AuthContactChannels;
