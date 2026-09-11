import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, getTabId, eventsUrl, setUnauthorizedHandler } from './client';
import { z } from 'zod';

const schema = z.object({ id: z.string() });

function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Error',
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('api() error extraction', () => {
  it('extracts code and message from new-style {detail: {code, message}}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(404, {
        detail: { code: 'ACTIVITY_NOT_FOUND', message: 'Activity not found' },
      })
    ));

    await expect(api('/test', schema)).rejects.toThrow(ApiError);
    try {
      await api('/test', schema);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).code).toBe('ACTIVITY_NOT_FOUND');
      expect((e as ApiError).message).toBe('Activity not found');
    }
  });

  it('preserves capacity message from 409 ACTIVITY_AT_CAPACITY', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(409, {
        detail: {
          code: 'ACTIVITY_AT_CAPACITY',
          message: 'Activity at capacity: 2/2 seats occupied',
        },
      })
    ));

    try {
      await api('/test', schema);
    } catch (e) {
      expect((e as ApiError).code).toBe('ACTIVITY_AT_CAPACITY');
      expect((e as ApiError).message).toBe('Activity at capacity: 2/2 seats occupied');
    }
  });

  it('extracts first error msg from validation array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(422, {
        detail: [
          { loc: ['body', 'name'], msg: 'String should have at most 50 characters', type: 'string_too_long' },
          { loc: ['body', 'phone'], msg: 'Invalid phone format', type: 'value_error' },
        ],
      })
    ));

    try {
      await api('/test', schema);
    } catch (e) {
      expect((e as ApiError).status).toBe(422);
      expect((e as ApiError).code).toBeUndefined();
      expect((e as ApiError).message).toBe('String should have at most 50 characters');
    }
  });

  it('strips "Value error, " prefix from validation messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(422, {
        detail: [
          { loc: ['body', 'x'], msg: 'Value error, X must be positive', type: 'value_error' },
        ],
      })
    ));

    try {
      await api('/test', schema);
    } catch (e) {
      expect((e as ApiError).message).toBe('X must be positive');
    }
  });

  it('uses string detail from legacy {detail: "string"} responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(500, { detail: 'Internal Server Error' })
    ));

    try {
      await api('/test', schema);
    } catch (e) {
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).code).toBeUndefined();
      expect((e as ApiError).message).toBe('Internal Server Error');
    }
  });

  it('falls back to default message when body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => { throw new Error('Not JSON'); },
    } as unknown as Response));

    try {
      await api('/test', schema);
    } catch (e) {
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).code).toBeUndefined();
      expect((e as ApiError).message).toContain('500');
    }
  });

  it('handles empty body gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({}),
    } as Response));

    try {
      await api('/test', schema);
    } catch (e) {
      expect((e as ApiError).status).toBe(502);
      expect((e as ApiError).code).toBeUndefined();
    }
  });
});

// ─── Tab identity + eventsUrl (GH #239, spec §2.4/§4.2) ──────────────────────
// The admin compares event.origin against its own tab id to keep its own
// changes silent. client.ts is the single fetch choke point: every mutating
// request carries X-Memo-Tab-Id; GETs never do.

describe('tab identity + eventsUrl', () => {
  it('exports eventsUrl ending with /api/v1/events', () => {
    expect(eventsUrl.endsWith('/api/v1/events')).toBe(true);
  });

  it('getTabId() returns the same value across calls', () => {
    expect(getTabId()).toBe(getTabId());
    expect(getTabId()).not.toBe('');
  });

  it('attaches X-Memo-Tab-Id to POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/test', schema, { method: 'POST', body: '{}' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Memo-Tab-Id']).toBe(getTabId());
  });

  it('attaches X-Memo-Tab-Id to PUT, PATCH and DELETE requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      await api('/test', schema, { method, body: '{}' });
    }

    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method);
    expect(methods).toEqual(['PUT', 'PATCH', 'DELETE']);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init.headers as Record<string, string>)['X-Memo-Tab-Id']).toBe(getTabId());
    }
  });

  it('does not attach X-Memo-Tab-Id to GET requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/test', schema);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBeUndefined(); // GET by default
    expect((init.headers as Record<string, string>)['X-Memo-Tab-Id']).toBeUndefined();
  });
});

// ─── Auth layer (GH #247 spec §4.1) ──────────────────────────────────────────
// Cookie sessions: every request sends credentials: "include". A 401 response
// invokes the module-level registered handler exactly once — except for
// /auth/* calls, whose 401s are part of normal flow (guest checks, wrong
// password). No handler registered → behaves as before (plain ApiError).

describe('api() credentials', () => {
  it('sends credentials: "include" on GET requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/test', schema);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
  });

  it('sends credentials: "include" on POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/test', schema, { method: 'POST', body: '{}' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
  });
});

describe('401 unauthorized handler', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
  });

  it('invokes the registered handler exactly once on a 401 outside /auth/', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(401, { detail: { code: 'AUTH_UNAUTHORIZED', message: 'No session' } })
    ));

    await expect(api('/api/v1/records', schema)).rejects.toThrow(ApiError);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the handler for /auth/ URL 401s', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(401, { detail: { code: 'AUTH_UNAUTHORIZED', message: 'No session' } })
    ));

    await expect(api('/api/v1/auth/me', schema)).rejects.toThrow(ApiError);

    expect(handler).not.toHaveBeenCalled();
  });

  it('throws ApiError as before when no handler is registered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(401, { detail: { code: 'AUTH_UNAUTHORIZED', message: 'No session' } })
    ));

    let caught: unknown;
    try {
      await api('/api/v1/records', schema);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(401);
    expect((caught as ApiError).code).toBe('AUTH_UNAUTHORIZED');
  });

  it('does not invoke the handler on non-401 errors', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(404, { detail: { code: 'NOT_FOUND', message: 'Not found' } })
    ));

    await expect(api('/test', schema)).rejects.toThrow(ApiError);

    expect(handler).not.toHaveBeenCalled();
  });

  it('still throws the 401 ApiError when the handler itself throws', async () => {
    setUnauthorizedHandler(() => {
      throw new Error('handler blew up');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(401, { detail: { code: 'AUTH_UNAUTHORIZED', message: 'No session' } })
    ));

    let caught: unknown;
    try {
      await api('/api/v1/records', schema);
    } catch (e) {
      caught = e;
    }

    // The original ApiError must win — the caller's instanceof branching
    // (parseApiError etc.) must never see the handler's failure instead.
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(401);
    expect((caught as ApiError).code).toBe('AUTH_UNAUTHORIZED');
    expect((caught as Error).message).toBe('No session');
  });
});

// ─── 409 dependency-tree exposure (GH #207 §5) ────────────────────────────────
// The unified DELETE dry-run answers {detail: "has_dependencies", dependencies: [...]}.
// The hook layer needs the tree to render the delete dialog (§7), so ApiError
// must carry the parsed dependencies array — the parsed body must not be dropped.

describe('api() 409 dependency-tree exposure', () => {
  const dependencyTree = [
    { entity: 'records', relation: 'Запись', count: 47, allowed_actions: ['nullify'] },
    {
      entity: 'visitors', relation: 'Посетитель', count: 12,
      allowed_actions: ['cascade'], cascade_preview: { visits: 45 },
    },
    {
      entity: 'client_tags', relation: 'Тег', count: 5,
      allowed_actions: ['cascade'], message: null,
    },
  ];

  it('exposes dependencies from a 409 {detail: "has_dependencies"} body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(409, {
        detail: 'has_dependencies',
        dependencies: dependencyTree,
      })
    ));

    let caught: unknown;
    try {
      await api('/test', schema);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(409);
    expect(err.message).toBe('has_dependencies');
    expect(err.dependencies).toEqual(dependencyTree);
  });

  it('leaves dependencies undefined when the error body has no dependency tree', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockFetchResponse(404, {
        detail: { code: 'MASTER_NOT_FOUND', message: 'Master not found' },
      })
    ));

    let caught: unknown;
    try {
      await api('/test', schema);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).dependencies).toBeUndefined();
  });
});
