export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  get isValidation(): boolean {
    return this.statusCode === 422;
  }

  get isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

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
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return fallback;
}
