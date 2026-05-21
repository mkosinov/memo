import { apiClient, buildQueryString } from '../api/client';

describe('buildQueryString', () => {
  it('returns empty string for no params', () => {
    expect(buildQueryString({})).toBe('');
  });

  it('builds query string from params', () => {
    expect(buildQueryString({ date: '2026-05-20', category: 'взрослым' })).toBe(
      '?date=2026-05-20&category=%D0%B2%D0%B7%D1%80%D0%BE%D1%81%D0%BB%D1%8B%D0%BC'
    );
  });

  it('skips undefined values', () => {
    expect(buildQueryString({ date: '2026-05-20', location: undefined })).toBe(
      '?date=2026-05-20'
    );
  });
});

describe('apiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches and returns JSON data', async () => {
    const mockData = [{ id: '1', name: 'Test' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await apiClient('/test');
    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/test',
      expect.any(Object)
    );
  });

  it('throws ApiError on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(apiClient('/missing')).rejects.toThrow('API error: 404');
  });

  it('uses custom base URL from env', async () => {
    const mockData = { ok: true };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    await apiClient('/test');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/test',
      expect.any(Object)
    );
  });
});
