'use client';

import { useQuery } from '@tanstack/react-query';
import { getAuditLogAuthors } from '@memo/api-client';
import type { AuditLogAuthorResponse } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';

/**
 * GH #344 §7 — the journal's authors dropdown lookup (GET
 * /api/v1/audit-logs/authors, admin-only). Own key under the audit-logs
 * family (`qk.auditLogAuthors`) — NOT the paged-list prefix. An empty
 * journal resolves `[]`; the dropdown then keeps only its «Все авторы»
 * placeholder option.
 */
export function useAuditLogAuthors() {
  return useQuery<AuditLogAuthorResponse[]>({
    queryKey: qk.auditLogAuthors,
    queryFn: () => getAuditLogAuthors(),
  });
}
