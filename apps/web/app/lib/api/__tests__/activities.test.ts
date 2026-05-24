import { getActivities, createBooking } from '../activities';

describe('getActivities', () => {
  it('returns array of activities', async () => {
    const activities = await getActivities();
    expect(Array.isArray(activities)).toBe(true);
    expect(activities.length).toBeGreaterThanOrEqual(5);
  });

  it('each activity has required fields', async () => {
    const activities = await getActivities();
    const first = activities[0];
    expect(first.id).toBeDefined();
    expect(first.title).toBeDefined();
    expect(first.category).toBeDefined();
    expect(first.image_url).toBeDefined();
    expect(first.time).toBeDefined();
    expect(first.duration_minutes).toBeDefined();
    expect(first.location_id).toBeDefined();
    expect(first.location_name).toBeDefined();
    expect(first.guests_count).toBeDefined();
    expect(first.material).toBeDefined();
    expect(first.size).toBeDefined();
    expect(first.price_min).toBeDefined();
    expect(first.price_max).toBeDefined();
    expect(first.teacher_name).toBeDefined();
    expect(first.date).toBeDefined();
  });

  it('filters by location', async () => {
    const activities = await getActivities({ location: 'alpika' });
    expect(activities.every((a) => a.location_id === 'alpika')).toBe(true);
  });

  it('returns empty array for non-matching filters', async () => {
    const activities = await getActivities({ location: 'nonexistent' });
    expect(activities).toEqual([]);
  });
});

describe('createBooking', () => {
  it('returns success with booking ID', async () => {
    const result = await createBooking({
      activityId: 'act-1',
      adultCount: 1,
      childCount: 0,
      name: 'Test User',
      phone: '+79991234567',
      confirmationMethod: 'sms',
    });
    expect(result.success).toBe(true);
    expect(result.bookingId).toMatch(/^mock-/);
  });
});
