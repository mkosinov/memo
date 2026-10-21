export { api, ApiError, eventsUrl, getTabId, setUnauthorizedHandler } from './client';
// The parse-error type callers must discriminate (#480 §3.3 «Контракт отказа»):
// a failed response validation escapes `api()` as a ZodError, NOT an ApiError.
// Re-exported so consumers (admin has no direct zod dependency) can check
// `error instanceof ZodError`.
export { ZodError } from 'zod';
export * from './endpoints';
export * from './schemas';
