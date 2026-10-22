"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyClient, ApiError } from "@memo/api-client";
import type { MyClient } from "@memo/api-client";

/**
 * Client-session detection (#499): `getMyClient` decides whether a client
 * session exists — 401 means anonymous (the normal pre-login state), any
 * other failure is a transport error the caller may treat as anonymous.
 */
export type ClientSessionStatus = "checking" | "anonymous" | "authenticated" | "error";

export interface ClientSession {
  status: ClientSessionStatus;
  client: MyClient | null;
  /** Re-run the check (e.g. after an OTP login established the session). */
  refresh: () => Promise<MyClient | null>;
}

export function useClientSession(active: boolean): ClientSession {
  const [client, setClient] = useState<MyClient | null>(null);
  const [status, setStatus] = useState<ClientSessionStatus>("checking");

  const refresh = useCallback(async (): Promise<MyClient | null> => {
    setStatus("checking");
    try {
      const me = await getMyClient();
      setClient(me);
      setStatus("authenticated");
      return me;
    } catch (err) {
      setClient(null);
      if (err instanceof ApiError && err.status === 401) {
        setStatus("anonymous");
      } else {
        setStatus("error");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  return { status, client, refresh };
}
