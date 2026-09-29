/**
 * Transport shared by every client: a thin typed caller over the REST API, sharing
 * request/response types with the server through @hotel/contracts (ADR-0009).
 *
 * Calls go to same-origin `/api/v1/...`; the web app proxies them to the API, so the
 * session cookie is first-party and CORS is not involved in the browser.
 */
import type { Problem } from '@hotel/contracts';

/** A failed call, carrying the RFC 9457 problem details the API returned. */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
  get status(): number {
    return this.problem.status;
  }
  get code(): Problem['code'] {
    return this.problem.code;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** Returns the CSRF token from the last session response. */
  getCsrfToken?: () => string | undefined;
  fetch?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export function createCaller(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? fetch;

  async function call<T>(
    method: Method,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ data: T; etag: string | null }> {
    const csrf = method === 'GET' ? undefined : options.getCsrfToken?.();
    // A file (Blob) is sent as-is with its own type; anything else as JSON.
    const file = typeof Blob !== 'undefined' && body instanceof Blob ? body : null;
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body === undefined
          ? {}
          : {
              'content-type': file ? file.type || 'application/octet-stream' : 'application/json',
            }),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: file ?? JSON.stringify(body) }),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => null)) as Problem | null;
      throw new ApiError(
        problem ?? {
          type: 'about:blank',
          title: res.statusText,
          status: res.status,
          code: 'INTERNAL_ERROR',
        },
      );
    }
    const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    return { data, etag: res.headers.get('etag') };
  }

  const qs = (params: Record<string, string | number | undefined>) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
    return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
  };
  return { call, qs };
}

export type Caller = ReturnType<typeof createCaller>;

/** What each group of staff endpoints is built from. */
export interface Transport {
  call: Caller['call'];
  qs: Caller['qs'];
  baseUrl: string;
}

/** A property's endpoints live under /properties/{propertyId}. */
export interface PropertyTransport extends Transport {
  /** "/properties/{propertyId}", URL-encoded. */
  p: string;
  id: (value: string) => string;
}
