"use client";

import { useQuery } from "@tanstack/react-query";
import { getAuthMethods } from "@memo/api-client";
import type { AuthMethod } from "@memo/api-client";

/**
 * The client-auth method registry (#593 §Реестр): `GET /auth/methods` is the
 * single source the picker builds from — honest availability, no client-side
 * guessing. A failed fetch degrades to an empty registry: the picker shows
 * «Вход временно недоступен» (fail-closed posture, same as every method
 * answering 503).
 */
export function useAuthMethods() {
  const query = useQuery({
    queryKey: ["auth-methods"],
    queryFn: getAuthMethods,
    // The registry is environment-derived; a short staleness keeps the
    // picker honest across long-lived screens without a refetch storm.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const methods: AuthMethod[] = query.data ?? [];
  const availableMethods = methods.filter((m) => m.available);

  return {
    ...query,
    methods,
    availableMethods,
    /** True once loaded (or failed) with nothing available — the dead end. */
    unavailable: !query.isPending && availableMethods.length === 0,
  };
}
