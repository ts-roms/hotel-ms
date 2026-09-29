/**
 * Transport shared by every client: a thin typed caller over the REST API, sharing
 * request/response types with the server through @hotel/contracts (ADR-0009).
 *
 * Calls go to same-origin `/api/v1/...`; the web app proxies them to the API, so the
 * session cookie is first-party and CORS is not involved in the browser.
 *
 * The per-operation request functions are generated from the OpenAPI document into
 * src/generated (ADR-0034); the facades map them onto the client's methods.
 */
import type { Problem } from '@hotel/contracts';
import type { Routes } from './generated/operations.js';

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

/** The API's own wording for a failure: the field messages of a validation error, else the detail or title. */
export function problemText(error: ApiError): string {
  if (error.code === 'VALIDATION_FAILED') {
    return error.problem.errors?.map((e) => e.message).join(' ') ?? error.message;
  }
  return error.problem.detail ?? error.problem.title;
}

/** Reads `token` from the URL fragment (#token=...), which is never sent to servers. */
export function tokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.hash.slice(1)).get('token');
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

/** A successful call: the parsed body (undefined for 204) and the ETag, if any. */
export interface Result<T> {
  data: T;
  etag: string | null;
}

/** "?a=1&b=2" from the defined entries, in their order; "" when there are none. */
export function qs(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}

export function createCaller(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? fetch;

  async function call<T>(
    method: Method,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Result<T>> {
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

  return { call, baseUrl };
}

/** Sends one request; the generated operations (src/generated) are written against it. */
export type Call = ReturnType<typeof createCaller>['call'];

/** The body of a result. */
export const data = <T>(r: Result<T>): T => r.data;
/** The items of a `{ items }` result. */
export const items = <T>(r: Result<{ items: T[] }>): T[] => r.data.items;

/** What each group of staff endpoints is built from. */
export interface Transport {
  call: Call;
  /** Prefix of same-origin URLs (downloads, images); defaults to "/api/v1". */
  baseUrl: string;
}

/** A property's endpoints live under /properties/{propertyId}. */
export interface PropertyTransport extends Transport {
  propertyId: string;
}

/**
 * The values of one path segment for which the API has a route `<prefix><segment><suffix>`,
 * read from the generated route table. For routes the client addresses by segment (one
 * route per kind): a kind the API lacks fails to type-check.
 */
export type RouteSegment<Prefix extends string, Suffix extends string> = {
  [Id in keyof Routes]: Routes[Id] extends `${Prefix}${infer Segment}${Suffix}` ? Segment : never;
}[keyof Routes];
