import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx?.app.close();
});

describe('login', () => {
  it('signs in, sets an HttpOnly cookie, auto-selects the only organization', async () => {
    const client = new TestClient(ctx.app);
    const res = await client.login('john.gm@abc.test');

    expect(res.status).toBe(200);
    expect(res.body.activeOrganizationId).toBe(ctx.world.abc.organizationId);
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.csrfToken).toEqual(expect.any(String));
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/hotel_sid=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('returns the same generic error for unknown email and wrong password', async () => {
    const client = new TestClient(ctx.app);
    const unknown = await client.login('nobody@abc.test', 'whatever-password');
    const wrong = await client.login('john.gm@abc.test', 'wrong-password');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.title).toBe(wrong.body.title);
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    const client = new TestClient(ctx.app);
    for (let i = 0; i < 5; i++) await client.login('frontdesk@abc.test', 'wrong-password');
    const res = await client.login('frontdesk@abc.test');
    expect(res.status).toBe(401);
  });

  it('rejects unknown fields and malformed input', async () => {
    const client = new TestClient(ctx.app);
    const res = await client.request('POST', '/api/v1/auth/login', {
      email: 'john.gm@abc.test',
      password: 'x',
      organizationId: ctx.world.xyz.organizationId,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects state-changing requests from a foreign Origin', async () => {
    const client = new TestClient(ctx.app);
    const res = await client.request(
      'POST',
      '/api/v1/auth/login',
      { email: 'john.gm@abc.test', password: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_FAILED');
  });
});

describe('session', () => {
  it('requires the CSRF token on unsafe methods', async () => {
    const client = await TestClient.as(ctx.app, 'admin@abc.test');
    client.csrfToken = undefined;
    const res = await client.request('POST', '/api/v1/auth/logout');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_FAILED');
  });

  it('logout revokes the session server-side', async () => {
    const client = await TestClient.as(ctx.app, 'admin@abc.test');
    const cookieBefore = (client as unknown as { cookie: string }).cookie;
    expect((await client.request('POST', '/api/v1/auth/logout')).status).toBe(204);

    // Replaying the old cookie must fail even though the browser would have dropped it.
    const replay = await client.get('/api/v1/auth/session', { cookie: cookieBefore });
    expect(replay.status).toBe(401);
  });

  it('every response carries a request id, and a sane incoming one is propagated', async () => {
    const client = new TestClient(ctx.app);
    const res = await client.get('/api/v1/properties', { 'x-request-id': 'trace-abc-12345' });
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
    expect(res.body.requestId).toBe('trace-abc-12345');
    const bad = await client.get('/api/v1/properties', { 'x-request-id': 'bad id!' });
    expect(bad.headers['x-request-id']).not.toBe('bad id!');
  });
});

describe('multi-organization identity', () => {
  it('has no active organization until one is chosen', async () => {
    const client = new TestClient(ctx.app);
    const login = await client.login('consultant@shared.test');
    expect(login.body.memberships).toHaveLength(2);
    expect(login.body.activeOrganizationId).toBeNull();
    expect(login.body.grants).toEqual([]);

    const res = await client.get('/api/v1/properties');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_ACTIVE_ORGANIZATION');
  });

  it('switches organization and sees only that tenant', async () => {
    const client = new TestClient(ctx.app);
    await client.login('consultant@shared.test');

    const toXyz = await client.request('POST', '/api/v1/auth/switch-organization', {
      organizationId: ctx.world.xyz.organizationId,
    });
    expect(toXyz.status).toBe(200);
    expect(
      (await client.get('/api/v1/properties')).body.items.map((p: { code: string }) => p.code),
    ).toEqual(['BOR']);

    const toAbc = await client.request('POST', '/api/v1/auth/switch-organization', {
      organizationId: ctx.world.abc.organizationId,
    });
    expect(toAbc.status).toBe(200);
    expect(
      (await client.get('/api/v1/properties')).body.items.map((p: { code: string }) => p.code),
    ).toEqual(['CEB', 'DVO', 'MNL']);
  });

  it('rotates the session token on organization switch', async () => {
    const client = new TestClient(ctx.app);
    await client.login('consultant@shared.test');
    const before = (client as unknown as { cookie: string }).cookie;
    await client.request('POST', '/api/v1/auth/switch-organization', {
      organizationId: ctx.world.xyz.organizationId,
    });
    const after = (client as unknown as { cookie: string }).cookie;
    expect(after).not.toBe(before);
    expect((await client.get('/api/v1/auth/session', { cookie: before })).status).toBe(401);
  });

  it('cannot switch into an organization it is not a member of', async () => {
    const client = await TestClient.as(ctx.app, 'john.gm@abc.test');
    const res = await client.request('POST', '/api/v1/auth/switch-organization', {
      organizationId: ctx.world.xyz.organizationId,
    });
    expect(res.status).toBe(404);
    expect((await client.get('/api/v1/auth/session')).body.activeOrganizationId).toBe(
      ctx.world.abc.organizationId,
    );
  });
});
