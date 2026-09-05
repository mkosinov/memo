'use client';
import { useQuery } from '@tanstack/react-query';
import { getClientById, getRecords } from '@memo/api-client';
import type { ClientResponse, RecordResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/** Single client by id — key shared with ClientQuickCard/ActivityDetailsModal (dedupe). */
export function useClient(id: string | undefined) {
  return useQuery<ClientResponse>({
    queryKey: qk.client(id ?? ''),
    queryFn: () => getClientById(id!),
    enabled: !!id,
  });
}

/** All records of one client (per_page 100 — current semantics). */
export function useClientRecords(id: string | undefined, enabled = true) {
  return useQuery<RecordResponse[]>({
    queryKey: qk.clientRecords(id ?? ''),
    queryFn: () => getRecords({ client_id: id!, per_page: 100 }).then((r) => r.items),
    enabled: !!id && enabled,
  });
}
