/**
 * Client-side localization (#538) for booking-flow error codes whose server
 * `message` is still English. Codes NOT in the map fall through to the server
 * text — already Russian for ACTIVITY_AT_CAPACITY's «Недостаточно мест» (#551) —
 * the map is deliberately not a full mirror of admin's CODE_DEFAULTS.
 */
const CODE_MESSAGES: Record<string, string> = {
  ACTIVITY_NOT_FOUND: 'Занятие не найдено',
  TARIFF_REQUIRED: 'Выберите тариф для каждого места',
  TARIFF_NOT_FOUND: 'Тариф не найден',
};

/**
 * Gate for showing an api-client error message to a user (#499): the shared
 * client always fills `message` — with the server's localized text ONLY when
 * the body was the unified `{code, message}` detail; otherwise with pydantic
 * text, a legacy string, or its own synthesized "API error: N ..." default.
 * A structured detail is exactly the case where `code` is set, so anything
 * else must fall back to the localized string — raw internals never leak.
 */
export function structuredServerMessage(err: unknown, fallback: string): string {
  if (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code !== undefined
  ) {
    const code = (err as { code?: unknown }).code;
    const dictMessage =
      typeof code === 'string' ? CODE_MESSAGES[code] : undefined;
    if (dictMessage !== undefined) return dictMessage;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return fallback;
}
