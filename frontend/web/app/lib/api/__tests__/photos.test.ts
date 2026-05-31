import { fetchWebPhotos } from '../photos';

describe('fetchWebPhotos', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns array of web photos', async () => {
    const mockData = [
      { id: '1', filename: 'photo1.jpg', activity_id: null, is_public: true },
      { id: '2', filename: 'photo2.jpg', activity_id: 'act-1', is_public: true },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await fetchWebPhotos();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].activity_id).toBe('act-1');
  });

  it('each photo has required fields', async () => {
    const mockData = [
      { id: '1', filename: 'photo1.jpg', activity_id: null, is_public: true },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await fetchWebPhotos();
    const photo = result[0];
    expect(photo.id).toBeDefined();
    expect(photo.filename).toBeDefined();
    expect(photo.is_public).toBeDefined();
    expect(photo.is_public).toBe(true);
  });

  it('passes activity_id query param', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchWebPhotos({ activity_id: 'act-1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/photos/web?activity_id=act-1',
      expect.any(Object)
    );
  });

  it('calls default endpoint without params', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await fetchWebPhotos();
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/photos/web',
      expect.any(Object)
    );
  });

  it('throws ApiError on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchWebPhotos()).rejects.toThrow('API error: 500');
  });
});
