import { ApiError } from '@memo/api-client';

export interface ParsedApiError {
  message: string;
  status?: number;
  code?: string;
}

/**
 * Default Russian messages per error code.
 * Backend code is the source of truth; these are user-facing fallbacks.
 */
const CODE_DEFAULTS: Record<string, string> = {
  ACTIVITY_AT_CAPACITY: 'Недостаточно мест',
  ACTIVITY_NOT_FOUND: 'Не найдено',
  RECORD_NOT_FOUND: 'Не найдено',
  CLIENT_NOT_FOUND: 'Не найдено',
  CLIENT_DUPLICATE_PHONE: 'Клиент с таким телефоном уже существует',
  LOCATION_NOT_FOUND: 'Не найдено',
  MASTER_NOT_FOUND: 'Не найдено',
  SERVICE_NOT_FOUND: 'Не найдено',
  TAG_NOT_FOUND: 'Не найдено',
  PHOTO_NOT_FOUND: 'Не найдено',
  MATERIAL_NOT_FOUND: 'Не найдено',
  VISITOR_NOT_FOUND: 'Не найдено',
  VISIT_NOT_FOUND: 'Не найдено',
  PAYMENT_NOT_FOUND: 'Не найдено',
  SETTINGS_NOT_FOUND: 'Не найдено',
  // GH #266 T9 — positions dictionary (D4).
  POSITION_NOT_FOUND: 'Не найдено',
  // The explanation of the block: a built-in («мастер»/«админ») never deletes;
  // its title stays editable. Surfaced as an error toast.
  POSITION_IS_SYSTEM: 'Встроенная должность не удаляется',
  VALIDATION_ERROR: 'Проверьте правильность заполнения полей',
  INTEGRITY_VIOLATION: 'Нарушение целостности данных',
  INTERNAL_ERROR: 'Ошибка сервера',
  // GH #247: auth errors (§3.6). LOGIN tests assert the credentials message.
  AUTH_INVALID_CREDENTIALS: 'Неверный телефон или пароль',
  AUTH_LOCKED_OUT: 'Слишком много попыток входа — аккаунт временно заблокирован',
  AUTH_UNAUTHORIZED: 'Требуется вход',
  AUTH_FORBIDDEN: 'Недостаточно прав для этого действия',
};

/**
 * Read `err.name` safely for arbitrary thrown values.
 *
 * GH #330 §5.6: classification of timeout/abort is strictly by name —
 * NOT `instanceof DOMException` (jsdom/polyfilled environments produce
 * plain Errors with these names instead of real DOMException instances).
 */
function getErrorName(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return undefined;
}

/**
 * Transport-class check: TypeError (fetch network failure) or an
 * interruption error named TimeoutError/AbortError.
 *
 * Used by the transport-toast dedup gate (§5.4). ApiError never matches —
 * an HTTP 401/403 response is not a connection loss and must not trip it.
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || isAbortClass(err);
}

/**
 * Interruption-class check: err.name is TimeoutError or AbortError.
 *
 * Used by the retry predicate (§5.7) to disable retries for aborted
 * requests (each retry would get a fresh timeout window).
 */
export function isAbortClass(err: unknown): boolean {
  const name = getErrorName(err);
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Convert any thrown error into a structured, user-friendly message.
 *
 * @param err - The error caught (any type; typically unknown in catch blocks)
 * @returns ParsedApiError with Russian message, optional status and code
 *
 * Behavior:
 * - ApiError with known code → uses CODE_DEFAULTS (overrides backend message
 *   for generic cases; preserves informative bits where useful)
 * - ApiError with unknown code → uses err.message
 * - ApiError without code → uses err.message
 * - err.name === 'TimeoutError' → "Превышено время ожидания запроса"
 * - err.name === 'AbortError' → "Запрос отменён" (explicit caller-signal cancel)
 * - TypeError (fetch network failure) → "Ошибка сети"
 * - Anything else → "Неизвестная ошибка"
 *
 * Special handling:
 * - ACTIVITY_AT_CAPACITY: appends "N/M мест занято" from err.message
 *   (backend message: "Activity at capacity: 2/2 seats occupied")
 */
export function parseApiError(err: unknown): ParsedApiError {
  if (err instanceof ApiError) {
    if (err.code && CODE_DEFAULTS[err.code]) {
      // ACTIVITY_AT_CAPACITY: extract N/M and append for clarity
      if (err.code === 'ACTIVITY_AT_CAPACITY') {
        const match = err.message.match(/(\d+)\/(\d+)/);
        if (match) {
          return {
            message: `${CODE_DEFAULTS[err.code]}: ${match[1]}/${match[2]} мест занято`,
            status: err.status,
            code: err.code,
          };
        }
      }
      return {
        message: CODE_DEFAULTS[err.code],
        status: err.status,
        code: err.code,
      };
    }
    // ApiError without code or unknown code: use err.message
    return { message: err.message, status: err.status, code: err.code };
  }

  if (isAbortClass(err)) {
    // GH #330 §5.6: interruption branches, classified strictly by err.name.
    // TimeoutError — request exceeded its deadline; AbortError — explicit
    // cancellation via the caller's AbortSignal (currently unreachable,
    // kept as contract insurance for future signal-passing callers).
    return getErrorName(err) === 'TimeoutError'
      ? { message: 'Превышено время ожидания запроса' }
      : { message: 'Запрос отменён' };
  }

  if (err instanceof TypeError) {
    // fetch() throws TypeError on network failure
    return { message: 'Ошибка сети' };
  }

  return { message: 'Неизвестная ошибка' };
}
