import { z } from 'zod';
import type { DependencyNode } from './schemas';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');

/** SSE endpoint (GH #239 spec §4.2) — consumed via EventSource by the admin app. */
export const eventsUrl = `${API_BASE}/api/v1/events`;

// Per-tab identity (GH #239 spec §2.4/§4.2): one uuid per browser tab
// (regenerated on reload) — the admin compares it against event.origin to
// keep its own changes silent. Mutating requests carry it as X-Memo-Tab-Id.
const tabId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
export const getTabId = (): string => tabId;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /** 409 dry-run dependency tree (GH #207 §5) — present only on DELETE conflicts. */
    public dependencies?: DependencyNode[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Unauthorized handler (GH #247 spec §4.1): module-level registration so the
// shared client stays framework-neutral — the admin registers a login
// redirect; frontend/web registers nothing. Invoked once per 401 response,
// except for /auth/* calls (guest checks / wrong password are normal flow).
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/api/v1/auth/');
}

async function api<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, options?: RequestInit): Promise<T> {
  const method = options?.method;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  // Mutating requests only (spec §3.3): GETs never announce tab identity.
  if (method !== undefined && method !== 'GET') headers['X-Memo-Tab-Id'] = tabId;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    // Cookie sessions (GH #247 spec §4.1): the memo_session cookie rides along
    // on every request so the backend can resolve the session user.
    credentials: 'include',
  });

  if (!res.ok) {
    let code: string | undefined;
    let dependencies: DependencyNode[] | undefined;
    let message = `API error: ${res.status} ${res.statusText}`;

    // Try to read structured error from body
    try {
      const body = await res.json() as { detail?: unknown; dependencies?: unknown };
      const detail = body?.detail;

      if (typeof detail === 'object' && detail !== null) {
        // New style: {detail: {code, message}}
        if ('code' in detail && 'message' in detail) {
          code = String((detail as { code: unknown }).code);
          message = String((detail as { message: unknown }).message);
        }
        // Validation: {detail: [{loc, msg, type}]}
        else if (Array.isArray(detail) && detail.length > 0) {
          const first = detail[0] as { msg?: string };
          if (first?.msg) {
            message = first.msg.replace(/^Value error, /, '');
            // No code for validation (frontend maps 422 → VALIDATION_ERROR)
          }
        }
      } else if (typeof detail === 'string') {
        // Legacy: {detail: "string"} — pre-refactor, still possible
        message = detail;
      }

      // 409 dry-run dependency tree (GH #207 §5) — {detail, dependencies: [...]}.
      // Carried up so the delete dialog can render the tree without re-parsing.
      if (Array.isArray(body?.dependencies)) {
        dependencies = body.dependencies as DependencyNode[];
      }
    } catch {
      // Body not JSON or empty; use default message
    }

    // Session expiry mid-work (GH #247 spec §4.1): hand the registered handler
    // a chance to react (the admin redirects to /login) — /auth/* 401s are
    // part of normal flow and never trigger it. Handler failures are ignored:
    // the original 401 ApiError must always be the one the caller sees.
    if (res.status === 401 && unauthorizedHandler !== null && !isAuthPath(path)) {
      try {
        unauthorizedHandler();
      } catch {
        // Handler (e.g. login redirect) failed — fall through to the ApiError
      }
    }

    throw new ApiError(res.status, message, code, dependencies);
  }

  // Handle 204 No Content (e.g. DELETE responses)
  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json();
  return schema.parse(data);
}

export { api };
