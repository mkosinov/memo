import { z } from 'zod';
import type { DependencyNode } from './schemas';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000');

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

async function api<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
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
