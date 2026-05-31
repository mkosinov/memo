import { apiClient } from './client';

export interface BookingData {
  activityId: string;
  phone: string;
  name: string;
  childCount: number;
  adultCount: number;
  comment?: string;
  priceTotal: number;
}

export async function createRecord(data: BookingData): Promise<{ success: boolean; recordId: string }> {
  const visits: { name: string; age: number | null; price: number }[] = [];
  const adultPrice = Math.round(data.priceTotal / (data.adultCount + data.childCount));

  for (let i = 0; i < data.adultCount; i++) {
    visits.push({ name: data.name, age: null, price: adultPrice });
  }
  for (let i = 0; i < data.childCount; i++) {
    visits.push({ name: `${data.name} (ребёнок)`, age: null, price: adultPrice });
  }

  const body = {
    activity_id: data.activityId,
    phone: data.phone,
    comment: data.comment ?? null,
    visits,
  };

  const result = await apiClient<{ id: string }>('/api/v1/records', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return { success: true, recordId: result.id };
}
