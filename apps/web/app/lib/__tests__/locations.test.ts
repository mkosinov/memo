import { getLocations } from '../api/locations';

describe('getLocations', () => {
  it('returns array of locations', async () => {
    const locations = await getLocations();
    expect(Array.isArray(locations)).toBe(true);
    expect(locations.length).toBeGreaterThanOrEqual(3);
  });

  it('each location has required fields', async () => {
    const locations = await getLocations();
    const first = locations[0];
    expect(first.id).toBeDefined();
    expect(first.name).toBeDefined();
    expect(first.address).toBeDefined();
  });

  it('includes known Moscow studios', async () => {
    const locations = await getLocations();
    const names = locations.map((l) => l.name);
    expect(names.some((n) => n.includes('Альпика'))).toBe(true);
    expect(names.some((n) => n.includes('Гранд'))).toBe(true);
    expect(names.some((n) => n.includes('Поляна'))).toBe(true);
  });
});
