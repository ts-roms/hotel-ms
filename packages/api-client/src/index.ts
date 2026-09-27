import type {
  AuditLogEntry,
  CreatePropertyRequest,
  LoginRequest,
  Problem,
  Property,
  SessionInfo,
  UpdatePropertyRequest,
} from '@hotel/contracts';

/**
 * Thin typed client over the REST API, sharing request/response types with the server
 * through @hotel/contracts. (Generation from docs/api/openapi.json replaces this when the
 * surface grows; see ADR-0009.)
 *
 * Calls go to same-origin `/api/v1/...`; the web app proxies them to the API, so the
 * session cookie is first-party and CORS is not involved in the browser.
 */
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? fetch;

  async function call<T>(
    method: Method,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ data: T; etag: string | null }> {
    const csrf = method === 'GET' ? undefined : options.getCsrfToken?.();
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

  return {
    auth: {
      login: (body: LoginRequest) =>
        call<SessionInfo>('POST', '/auth/login', body).then((r) => r.data),
      logout: () => call<void>('POST', '/auth/logout').then((r) => r.data),
      session: () => call<SessionInfo>('GET', '/auth/session').then((r) => r.data),
      switchOrganization: (organizationId: string) =>
        call<SessionInfo>('POST', '/auth/switch-organization', { organizationId }).then(
          (r) => r.data,
        ),
    },
    properties: {
      list: (params: { cursor?: string; limit?: number } = {}) =>
        call<Page<Property>>('GET', `/properties${qs(params)}`).then((r) => r.data),
      get: (id: string) => call<Property>('GET', `/properties/${encodeURIComponent(id)}`),
      create: (body: CreatePropertyRequest) =>
        call<Property>('POST', '/properties', body).then((r) => r.data),
      update: (id: string, etag: string, body: UpdatePropertyRequest) =>
        call<Property>('PATCH', `/properties/${encodeURIComponent(id)}`, body, {
          'if-match': etag,
        }),
    },
    auditLogs: {
      list: (
        params: {
          propertyId?: string;
          entityType?: string;
          entityId?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ) => call<Page<AuditLogEntry>>('GET', `/audit-logs${qs(params)}`).then((r) => r.data),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
