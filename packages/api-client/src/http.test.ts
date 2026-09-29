import type { Problem } from '@hotel/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createCaller, type ApiClientOptions, problemText, qs } from './http.js';

/** A fetch that records its calls and answers with `response`. */
function recordingFetch(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => response());
  return fetch;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

function caller(response: () => Response, options: Omit<ApiClientOptions, 'fetch'> = {}) {
  const fetch = recordingFetch(response);
  const { call, baseUrl } = createCaller({
    ...options,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { call, baseUrl, fetch, init: () => fetch.mock.calls[0]![1] };
}

describe('createCaller', () => {
  it('calls same-origin /api/v1 by default and exposes the resolved baseUrl', async () => {
    const { call, baseUrl, fetch, init } = caller(() => json({ ok: true }));
    expect(baseUrl).toBe('/api/v1');
    const result = await call<{ ok: boolean }>('GET', '/auth/session');
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/auth/session');
    expect(init()).toEqual({
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    expect(result).toEqual({ data: { ok: true }, etag: null });
  });

  it('uses a given baseUrl', async () => {
    const { call, baseUrl, fetch } = caller(() => json({}), { baseUrl: 'http://api.test/v1' });
    await call('GET', '/x');
    expect(baseUrl).toBe('http://api.test/v1');
    expect(fetch.mock.calls[0]![0]).toBe('http://api.test/v1/x');
  });

  it('sends a JSON body with its content type and the CSRF token on writes', async () => {
    const { call, init } = caller(() => json({}), { getCsrfToken: () => 'csrf-1' });
    await call('POST', '/auth/login', { email: 'a@b.test' }, { 'idempotency-key': 'k1' });
    expect(init()).toEqual({
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-1',
        'idempotency-key': 'k1',
      },
      body: '{"email":"a@b.test"}',
    });
  });

  it('never sends the CSRF token on GET, and omits it when there is none', async () => {
    const getCsrfToken = vi.fn(() => 'csrf-1');
    const get = caller(() => json({}), { getCsrfToken });
    await get.call('GET', '/x');
    expect(getCsrfToken).not.toHaveBeenCalled();
    expect(get.init().headers).toEqual({ accept: 'application/json' });

    const none = caller(() => json({}), { getCsrfToken: () => undefined });
    await none.call('DELETE', '/x');
    expect(none.init().headers).toEqual({ accept: 'application/json' });
  });

  it('sends a Blob as-is with its own type, or octet-stream when it has none', async () => {
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    const typed = caller(() => json({}));
    await typed.call('POST', '/upload', photo);
    expect(typed.init().body).toBe(photo);
    expect(typed.init().headers).toMatchObject({ 'content-type': 'image/jpeg' });

    const untyped = caller(() => json({}));
    await untyped.call('POST', '/upload', new Blob(['raw']));
    expect(untyped.init().headers).toMatchObject({ 'content-type': 'application/octet-stream' });
  });

  it('returns undefined for 204 and the ETag when the response has one', async () => {
    const empty = caller(() => new Response(null, { status: 204 }));
    expect(await empty.call('POST', '/auth/logout')).toEqual({ data: undefined, etag: null });

    const tagged = caller(() => json({ id: 'p1' }, { headers: { etag: 'W/"3"' } }));
    expect(await tagged.call('GET', '/properties/p1')).toEqual({
      data: { id: 'p1' },
      etag: 'W/"3"',
    });
  });

  it('throws the RFC 9457 problem as an ApiError', async () => {
    const problem: Problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 412,
      code: 'VERSION_CONFLICT',
      detail: 'Someone else changed this.',
    };
    const { call } = caller(() =>
      json(problem, { status: 412, headers: { 'content-type': 'application/problem+json' } }),
    );
    const error = await call('PATCH', '/x', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      message: 'Someone else changed this.',
      status: 412,
      code: 'VERSION_CONFLICT',
      problem,
    });
  });

  it('falls back to a generic problem when the error body is not JSON', async () => {
    const { call } = caller(
      () => new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }),
    );
    const error = (await call('GET', '/x').catch((e: unknown) => e)) as ApiError;
    expect(error.problem).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      code: 'INTERNAL_ERROR',
    });
    expect(error.message).toBe('Bad Gateway');
  });
});

describe('qs', () => {
  it('keeps defined entries in order and URL-encodes them', () => {
    expect(qs({ from: '2026-01-01', skip: undefined, q: 'a b&c', limit: 20 })).toBe(
      '?from=2026-01-01&q=a+b%26c&limit=20',
    );
  });

  it('is empty when nothing is defined', () => {
    expect(qs({})).toBe('');
    expect(qs({ status: undefined })).toBe('');
  });
});

describe('problemText', () => {
  const error = (problem: Partial<Problem>) =>
    new ApiError({
      type: 'about:blank',
      title: 'Failed',
      status: 400,
      code: 'INTERNAL_ERROR',
      ...problem,
    });

  it('joins the field messages of a validation error', () => {
    const e = error({
      code: 'VALIDATION_FAILED',
      errors: [
        { path: 'email', message: 'Enter an email.' },
        { path: 'name', message: 'Enter a name.' },
      ],
    });
    expect(problemText(e)).toBe('Enter an email. Enter a name.');
  });

  it('uses the message of a validation error without field errors', () => {
    expect(problemText(error({ code: 'VALIDATION_FAILED', detail: 'Invalid.' }))).toBe('Invalid.');
  });

  it('prefers the detail, else the title', () => {
    expect(problemText(error({ detail: 'Not allowed here.' }))).toBe('Not allowed here.');
    expect(problemText(error({}))).toBe('Failed');
  });
});
