import { createRecord, type BookingData } from '../records';

describe('createRecord', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const validData: BookingData = {
    activityId: 'act-sea-d0',
    phone: '+79991234567',
    name: 'Test User',
    childCount: 1,
    adultCount: 2,
    comment: 'Хочу у окна',
    priceTotal: 9000,
  };

  it('returns success with record ID', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'rec-12345' }),
    });

    const result = await createRecord(validData);
    expect(result.success).toBe(true);
    expect(result.recordId).toBe('rec-12345');
  });

  it('sends POST to /api/v1/records with correct body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'rec-1' }),
    });

    await createRecord(validData);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/records',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('builds visits array from adultCount and childCount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'rec-1' }),
    });

    const callArgs = await new Promise<{ body: string }>((resolve) => {
      global.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        resolve({ body: opts.body as string });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'rec-1' }),
        });
      });
      createRecord(validData);
    });

    const body = JSON.parse(callArgs.body);
    expect(body.visits).toHaveLength(3); // 2 adults + 1 child
    expect(body.visits[0].name).toBe('Test User');
    expect(body.visits[0].age).toBeNull();
    expect(body.visits[1].name).toBe('Test User');
    expect(body.visits[2].name).toBe('Test User (ребёнок)');
    expect(body.activity_id).toBe('act-sea-d0');
    expect(body.phone).toBe('+79991234567');
    expect(body.comment).toBe('Хочу у окна');
  });

  it('calculates per-visit price based on priceTotal', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'rec-1' }),
    });

    const callArgs = await new Promise<{ body: string }>((resolve) => {
      global.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        resolve({ body: opts.body as string });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'rec-1' }),
        });
      });
      createRecord({ ...validData, adultCount: 1, childCount: 0, priceTotal: 3500 });
    });

    const body = JSON.parse(callArgs.body);
    expect(body.visits).toHaveLength(1);
    expect(body.visits[0].price).toBe(3500);
  });

  it('handles zero child count correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'rec-1' }),
    });

    const callArgs = await new Promise<{ body: string }>((resolve) => {
      global.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        resolve({ body: opts.body as string });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'rec-1' }),
        });
      });
      createRecord({ ...validData, adultCount: 2, childCount: 0, priceTotal: 6000 });
    });

    const body = JSON.parse(callArgs.body);
    expect(body.visits).toHaveLength(2);
    expect(body.visits.every((v: { name: string }) => !v.name.includes('ребёнок'))).toBe(true);
  });

  it('throws ApiError on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
    });

    await expect(createRecord(validData)).rejects.toThrow('API error: 422');
  });
});
