import { apiClient, buildQueryString } from './client';
import type { WebPhotoResponse } from '@/app/lib/model/dto/photo';

export async function fetchWebPhotos(params?: {
  activity_id?: string;
}): Promise<WebPhotoResponse[]> {
  const qs = buildQueryString({ activity_id: params?.activity_id });
  return apiClient<WebPhotoResponse[]>(`/api/v1/photos/web${qs}`);
}
