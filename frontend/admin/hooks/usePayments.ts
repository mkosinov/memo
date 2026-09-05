'use client';
import { useQuery } from '@tanstack/react-query';
import { getPaymentTotals } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/** Payment totals for a set of record ids (ids array participates in the key). */
export function usePaymentTotals(ids: string[]) {
  return useQuery({
    queryKey: qk.paymentTotals(ids),
    queryFn: () => getPaymentTotals(ids),
    enabled: ids.length > 0,
  });
}
