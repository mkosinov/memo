import { ApiError } from '@/app/lib/errors';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function apiClient<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    throw new ApiError(`API error: ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}

export function buildQueryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  const search = new URLSearchParams(entries as [string, string][]).toString();
  return `?${search}`;
}
