import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Mailbox, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

const NEW_PASSWORD = 'correct horse battery staple';

describe('forgot / reset password', () => {
  it('answers the same for known and unknown emails, and only mails known accounts', async () => {
    const client = new TestClient(ctx.app);
    const unknown = await client.request('POST', '/api/v1/auth/password/forgot', {
      email: 'ghost@abc.test',
    });
    const known = await client.request('POST', '/api/v1/auth/password/forgot', {
      email: 'john.gm@abc.test',
    });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);

    const mails = await ctx.mailbox.all();
    expect(mails.filter((m) => m.to === 'ghost@abc.test')).toHaveLength(0);
    const reset = await ctx.mailbox.latestFor('john.gm@abc.test', 'password-reset');
    expect(reset?.template === 'password-reset' && reset.data.resetUrl).toMatch(
      /^http:\/\/localhost:43100\/reset-password#token=[A-Za-z0-9_-]{43}$/,
    );
  });

  it('resets once, signs out every session, and the old password stops working', async () => {
    const existingSession = await TestClient.as(ctx.app, 'john.gm@abc.test');
    const client = new TestClient(ctx.app);
    await client.request('POST', '/api/v1/auth/password/forgot', { email: 'john.gm@abc.test' });
    const mail = await ctx.mailbox.latestFor('john.gm@abc.test', 'password-reset');
    const token = Mailbox.tokenFrom(mail!.template === 'password-reset' ? mail!.data.resetUrl : '');

    const weak = await client.request('POST', '/api/v1/auth/password/reset', {
      token,
      newPassword: 'short',
    });
    expect(weak.status).toBe(400);
    const containsEmail = await client.request('POST', '/api/v1/auth/password/reset', {
      token,
      newPassword: 'my john.gm password is long',
    });
    expect(containsEmail.status).toBe(400);

    const ok = await client.request('POST', '/api/v1/auth/password/reset', {
      token,
      newPassword: NEW_PASSWORD,
    });
    expect(ok.status).toBe(204);

    expect((await existingSession.get('/api/v1/auth/session')).status).toBe(401);
    expect((await new TestClient(ctx.app).login('john.gm@abc.test')).status).toBe(401);
    expect((await new TestClient(ctx.app).login('john.gm@abc.test', NEW_PASSWORD)).status).toBe(
      200,
    );

    const reuse = await client.request('POST', '/api/v1/auth/password/reset', {
      token,
      newPassword: 'another long password!',
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe('INVALID_TOKEN');
    expect(await ctx.mailbox.latestFor('john.gm@abc.test', 'password-changed')).toBeDefined();
  });

  it('a newer reset link invalidates older ones', async () => {
    const client = new TestClient(ctx.app);
    await client.request('POST', '/api/v1/auth/password/forgot', {
      email: 'robert.finance@abc.test',
    });
    const first = await ctx.mailbox.latestFor('robert.finance@abc.test', 'password-reset');
    await client.request('POST', '/api/v1/auth/password/forgot', {
      email: 'robert.finance@abc.test',
    });
    const oldToken = Mailbox.tokenFrom(
      first!.template === 'password-reset' ? first!.data.resetUrl : '',
    );
    const res = await client.request('POST', '/api/v1/auth/password/reset', {
      token: oldToken,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('rejects made-up tokens', async () => {
    const res = await new TestClient(ctx.app).request('POST', '/api/v1/auth/password/reset', {
      token: 'A'.repeat(43),
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});

describe('change password', () => {
  it('needs the current password; keeps this session and signs out the others', async () => {
    const other = await TestClient.as(ctx.app, 'maria.hr@abc.test');
    const client = await TestClient.as(ctx.app, 'maria.hr@abc.test');

    const wrong = await client.request('POST', '/api/v1/auth/password/change', {
      currentPassword: 'not-my-password',
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.status).toBe(400);

    const { DEMO_PASSWORD } = await import('@hotel/database');
    const ok = await client.request('POST', '/api/v1/auth/password/change', {
      currentPassword: DEMO_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(ok.status).toBe(204);
    expect((await client.get('/api/v1/auth/session')).status).toBe(200);
    expect((await other.get('/api/v1/auth/session')).status).toBe(401);
  });
});
