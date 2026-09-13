import { describe, it, expect } from 'vitest';
import { ApiError } from '@memo/api-client';
import { parseApiError } from '../app/lib/api/parseApiError';

describe('parseApiError', () => {
  it('returns capacity-specific message for ACTIVITY_AT_CAPACITY with N/M in message', () => {
    const err = new ApiError(409, 'Activity at capacity: 2/2 seats occupied', 'ACTIVITY_AT_CAPACITY');
    const result = parseApiError(err);
    expect(result.message).toBe('Недостаточно мест: 2/2 мест занято');
    expect(result.status).toBe(409);
    expect(result.code).toBe('ACTIVITY_AT_CAPACITY');
  });

  it('falls back to default for ACTIVITY_AT_CAPACITY without N/M pattern', () => {
    const err = new ApiError(409, 'Activity at capacity', 'ACTIVITY_AT_CAPACITY');
    const result = parseApiError(err);
    expect(result.message).toBe('Недостаточно мест');
  });

  it('returns "Не найдено" for ACTIVITY_NOT_FOUND', () => {
    const err = new ApiError(404, 'Activity not found', 'ACTIVITY_NOT_FOUND');
    expect(parseApiError(err).message).toBe('Не найдено');
  });

  it('returns "Не найдено" for TAG_NOT_FOUND (generic 404)', () => {
    const err = new ApiError(404, 'Tag not found', 'TAG_NOT_FOUND');
    expect(parseApiError(err).message).toBe('Не найдено');
  });

  // GH #266 — positions dictionary codes.
  it('returns "Не найдено" for POSITION_NOT_FOUND (generic 404)', () => {
    const err = new ApiError(404, 'Position not found', 'POSITION_NOT_FOUND');
    expect(parseApiError(err).message).toBe('Не найдено');
  });

  it('explains POSITION_IS_SYSTEM (built-in delete refusal, D4)', () => {
    // The explanation is a UI contract: the mapped default wins even when the
    // backend message is raw/untranslated.
    const err = new ApiError(422, 'Position is system', 'POSITION_IS_SYSTEM');
    expect(parseApiError(err).message).toBe('Встроенная должность не удаляется');
  });

  it('returns specific message for CLIENT_DUPLICATE_PHONE', () => {
    const err = new ApiError(409, 'Phone exists', 'CLIENT_DUPLICATE_PHONE');
    expect(parseApiError(err).message).toBe('Клиент с таким телефоном уже существует');
  });

  it('returns validation message for VALIDATION_ERROR', () => {
    const err = new ApiError(422, 'Name too long', 'VALIDATION_ERROR');
    expect(parseApiError(err).message).toBe('Проверьте правильность заполнения полей');
  });

  it('returns INTEGRITY_VIOLATION message', () => {
    const err = new ApiError(422, 'FK violation', 'INTEGRITY_VIOLATION');
    expect(parseApiError(err).message).toBe('Нарушение целостности данных');
  });

  it('returns "Ошибка сервера" for INTERNAL_ERROR', () => {
    const err = new ApiError(500, 'Internal Server Error', 'INTERNAL_ERROR');
    expect(parseApiError(err).message).toBe('Ошибка сервера');
  });

  it('uses err.message for ApiError with no code (legacy)', () => {
    const err = new ApiError(404, 'Something not found');
    expect(parseApiError(err).message).toBe('Something not found');
  });

  it('uses err.message for ApiError with unknown code', () => {
    const err = new ApiError(500, 'Weird error', 'SOMETHING_NEW');
    expect(parseApiError(err).message).toBe('Weird error');
  });

  it('returns "Ошибка сети" for TypeError (network failure)', () => {
    const err = new TypeError('Failed to fetch');
    expect(parseApiError(err).message).toBe('Ошибка сети');
  });

  it('returns "Неизвестная ошибка" for unknown error types', () => {
    expect(parseApiError('string error')).toEqual({ message: 'Неизвестная ошибка' });
    expect(parseApiError(null)).toEqual({ message: 'Неизвестная ошибка' });
    expect(parseApiError(undefined)).toEqual({ message: 'Неизвестная ошибка' });
    expect(parseApiError(new Error('boom'))).toEqual({ message: 'Неизвестная ошибка' });
  });

  it('preserves status and code in result', () => {
    const err = new ApiError(404, 'X not found', 'TAG_NOT_FOUND');
    const result = parseApiError(err);
    expect(result.status).toBe(404);
    expect(result.code).toBe('TAG_NOT_FOUND');
  });
});
