/**
 * Administrator contact channels for the «Связаться» panel (#593 §Фронт web).
 *
 * Two PUBLIC env vars (not secrets), default empty — empty means the button
 * is hidden; both empty means no messenger buttons at all (the request text
 * and «Скопировать текст» remain). Read at call time so tests can stub the
 * env per case (Next inlines NEXT_PUBLIC_* at build time in the app bundle).
 */

/** The Telegram contact — a username (with or without the leading `@`). */
export function telegramContact(): string {
  return process.env.NEXT_PUBLIC_CONTACT_TELEGRAM ?? "";
}

/** The WhatsApp contact — a phone in any spacing form, digits are kept. */
export function whatsappContact(): string {
  return process.env.NEXT_PUBLIC_CONTACT_WHATSAPP ?? "";
}

/** `https://t.me/<user>?text=…` or null when the contact is empty (hidden). */
export function telegramLink(text: string): string | null {
  const user = telegramContact().replace(/^@/, "").trim();
  if (!user) return null;
  return `https://t.me/${user}?text=${encodeURIComponent(text)}`;
}

/** `https://wa.me/<7XXXXXXXXXX>?text=…` or null when the contact is empty. */
export function whatsappLink(text: string): string | null {
  const digits = whatsappContact().replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
