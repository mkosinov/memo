import { ApiError } from '@memo/api-client';

import { structuredServerMessage } from '../errors';

describe('structuredServerMessage', () => {
  const FALLBACK = 'Не удалось выполнить действие';

  it('returns the server message when the error carries the unified {code, message} detail', () => {
    const err = new ApiError(409, 'Недостаточно мест', 'ACTIVITY_AT_CAPACITY');
    expect(structuredServerMessage(err, FALLBACK)).toBe('Недостаточно мест');
  });

  it('falls back when there is no code — e.g. the synthesized "API error: N ..." default', () => {
    const err = new ApiError(409, 'API error: 409 Conflict');
    expect(structuredServerMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back when the structured message is empty', () => {
    const err = new ApiError(409, '', 'ACTIVITY_AT_CAPACITY');
    expect(structuredServerMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for non-error values (network TypeErrors etc.)', () => {
    expect(structuredServerMessage(new TypeError('fetch failed'), FALLBACK)).toBe(FALLBACK);
    expect(structuredServerMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
