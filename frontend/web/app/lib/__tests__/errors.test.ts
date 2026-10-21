import { ApiError, structuredServerMessage } from '../errors';

describe('ApiError', () => {
  it('creates error with message and status code', () => {
    const error = new ApiError('Not found', 404);
    expect(error.message).toBe('Not found');
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('ApiError');
  });

  it('detects not found errors', () => {
    expect(new ApiError('x', 404).isNotFound).toBe(true);
    expect(new ApiError('x', 500).isNotFound).toBe(false);
  });

  it('detects validation errors', () => {
    expect(new ApiError('x', 422).isValidation).toBe(true);
    expect(new ApiError('x', 400).isValidation).toBe(false);
  });

  it('detects server errors', () => {
    expect(new ApiError('x', 500).isServerError).toBe(true);
    expect(new ApiError('x', 503).isServerError).toBe(true);
    expect(new ApiError('x', 400).isServerError).toBe(false);
  });

  it('supports optional error code', () => {
    const error = new ApiError('x', 400, 'INVALID_INPUT');
    expect(error.code).toBe('INVALID_INPUT');
  });
});

describe('structuredServerMessage', () => {
  const FALLBACK = 'Не удалось выполнить действие';

  it('returns the server message when the error carries the unified {code, message} detail', () => {
    const err = new ApiError('Недостаточно мест', 409, 'ACTIVITY_AT_CAPACITY');
    expect(structuredServerMessage(err, FALLBACK)).toBe('Недостаточно мест');
  });

  it('falls back when there is no code — e.g. the synthesized "API error: N ..." default', () => {
    const err = new ApiError('API error: 409 Conflict', 409);
    expect(structuredServerMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back when the structured message is empty', () => {
    const err = new ApiError('', 409, 'ACTIVITY_AT_CAPACITY');
    expect(structuredServerMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for non-error values (network TypeErrors etc.)', () => {
    expect(structuredServerMessage(new TypeError('fetch failed'), FALLBACK)).toBe(FALLBACK);
    expect(structuredServerMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
