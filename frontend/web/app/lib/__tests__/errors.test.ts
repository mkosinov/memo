import { ApiError } from '@memo/api-client';

import { structuredServerMessage } from '../errors';

describe('structuredServerMessage', () => {
  const FALLBACK = 'Не удалось выполнить действие';

  it('returns the server message when the error carries the unified {code, message} detail', () => {
    const err = new ApiError(409, 'Недостаточно мест', 'ACTIVITY_AT_CAPACITY');
    expect(structuredServerMessage(err, FALLBACK)).toBe('Недостаточно мест');
  });

  it('localizes ACTIVITY_NOT_FOUND from the dictionary over the English server message (#538)', () => {
    const err = new ApiError(404, 'Activity not found', 'ACTIVITY_NOT_FOUND');
    expect(structuredServerMessage(err, FALLBACK)).toBe('Занятие не найдено');
  });

  it('localizes TARIFF_REQUIRED from the dictionary over the server message (#538)', () => {
    const err = new ApiError(422, 'Tariff is required', 'TARIFF_REQUIRED');
    expect(structuredServerMessage(err, FALLBACK)).toBe('Выберите тариф для каждого места');
  });

  it('localizes TARIFF_NOT_FOUND from the dictionary over the server message (#538)', () => {
    const err = new ApiError(404, 'Tariff not found', 'TARIFF_NOT_FOUND');
    expect(structuredServerMessage(err, FALLBACK)).toBe('Тариф не найден');
  });

  it('passes the server message through for a code outside the dictionary (#538)', () => {
    const err = new ApiError(409, 'Недостаточно мест', 'SOME_FUTURE_CODE');
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
