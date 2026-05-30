import { ApiError } from '../errors';

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
