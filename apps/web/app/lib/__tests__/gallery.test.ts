import { getGallery } from '../api/gallery';

describe('getGallery', () => {
  it('returns array of photos', async () => {
    const photos = await getGallery();
    expect(Array.isArray(photos)).toBe(true);
    expect(photos.length).toBeGreaterThanOrEqual(6);
  });

  it('each photo has required fields', async () => {
    const photos = await getGallery();
    const first = photos[0];
    expect(first.id).toBeDefined();
    expect(first.url).toBeDefined();
    expect(first.technique).toBeDefined();
  });

  it('respects limit parameter', async () => {
    const photos = await getGallery(3);
    expect(photos.length).toBeLessThanOrEqual(3);
  });
});
