import { createPrismaClient } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextTotp, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('sensitive permissions require MFA', () => {
  it('an org admin without MFA cannot read the audit log or manage roles', async () => {
    const admin = await TestClient.as(ctx.app, 'admin@xyz.test');
    const audit = await admin.get('/api/v1/audit-logs');
    expect(audit.status).toBe(403);
    expect(audit.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    // Non-sensitive permissions keep working.
    expect((await admin.get('/api/v1/properties')).status).toBe(200);
  });

  it('a user lacking the permission still gets a plain 403 (no MFA hint)', async () => {
    const frontDesk = await TestClient.as(ctx.app, 'frontdesk@abc.test');
    const res = await frontDesk.get('/api/v1/audit-logs');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('TOTP enrollment', () => {
  it('rejects a wrong code, then activates with a right one and signs out other sessions', async () => {
    const other = await TestClient.as(ctx.app, 'robert.finance@abc.test');
    const client = await TestClient.as(ctx.app, 'robert.finance@abc.test');

    const start = await client.request('POST', '/api/v1/auth/mfa/totp/enrollment');
    expect(start.status).toBe(200);
    expect(start.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(start.body.otpauthUri).toMatch(
      /^otpauth:\/\/totp\/Hotel%20Platform%3Arobert\.finance%40abc\.test\?/,
    );

    const wrong = await client.request('POST', '/api/v1/auth/mfa/totp/enrollment/confirm', {
      code: '000000',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_MFA_CODE');

    const { hotp, base32Decode } = await import('../src/modules/auth/totp.js');
    const code = hotp(base32Decode(start.body.secret), BigInt(Math.floor(Date.now() / 30_000)));
    const confirm = await client.request('POST', '/api/v1/auth/mfa/totp/enrollment/confirm', {
      code,
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    expect(confirm.body.session.identity.mfaEnabled).toBe(true);
    expect(confirm.body.session.mfaPending).toBe(false);

    // Other sessions are revoked; this one continues and now passes the MFA gate.
    expect((await other.get('/api/v1/auth/session')).status).toBe(401);
    expect((await client.get('/api/v1/audit-logs')).status).toBe(200);

    // A second enrollment is refused while MFA is active.
    expect((await client.request('POST', '/api/v1/auth/mfa/totp/enrollment')).status).toBe(409);
  });

  it('stores the secret encrypted', async () => {
    const owner = createPrismaClient({
      connectionString: testDatabaseUrls().owner,
      maxConnections: 1,
    });
    try {
      const rows = await owner.$queryRaw<{ secret: Buffer }[]>`
        SELECT f.secret_encrypted AS secret FROM mfa_factors f
        JOIN identities i ON i.id = f.identity_id WHERE i.email = 'robert.finance@abc.test'`;
      expect(rows).toHaveLength(1);
      // Base32 secrets are uppercase A-Z2-7; ciphertext is not a readable 32-char run.
      expect(Buffer.from(rows[0]!.secret).toString('latin1')).not.toMatch(/[A-Z2-7]{32}/);
    } finally {
      await owner.$disconnect();
    }
  });
});

describe('sign-in with MFA', () => {
  let recoveryCodes: string[];

  beforeAll(async () => {
    ({ recoveryCodes } = await TestClient.withMfa(ctx.app, 'maria.hr@abc.test'));
  });

  it('password alone yields a limited session that reveals nothing', async () => {
    const client = new TestClient(ctx.app);
    const login = await client.login('maria.hr@abc.test');
    expect(login.status).toBe(200);
    expect(login.body.mfaPending).toBe(true);
    expect(login.body.memberships).toEqual([]);
    expect(login.body.grants).toEqual([]);
    expect(login.body.activeOrganizationId).toBeNull();

    const blocked = await client.get('/api/v1/properties');
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('MFA_REQUIRED');
    expect(
      (
        await client.request('POST', '/api/v1/auth/switch-organization', {
          organizationId: ctx.world.abc.organizationId,
        })
      ).status,
    ).toBe(401);
  });

  it('completes with a TOTP code, which cannot be replayed', async () => {
    const client = new TestClient(ctx.app);
    await client.login('maria.hr@abc.test');
    const code = nextTotp('maria.hr@abc.test');
    const ok = await client.request('POST', '/api/v1/auth/mfa/challenge', { code });
    expect(ok.status).toBe(200);
    expect(ok.body.mfaPending).toBe(false);
    expect(ok.body.memberships).toHaveLength(1);
    expect((await client.get('/api/v1/properties')).status).toBe(200);

    const attacker = new TestClient(ctx.app);
    await attacker.login('maria.hr@abc.test');
    const replay = await attacker.request('POST', '/api/v1/auth/mfa/challenge', { code });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_MFA_CODE');
  });

  it('accepts each recovery code exactly once', async () => {
    const first = new TestClient(ctx.app);
    await first.login('maria.hr@abc.test');
    expect(
      (
        await first.request('POST', '/api/v1/auth/mfa/challenge', {
          recoveryCode: recoveryCodes[0],
        })
      ).status,
    ).toBe(200);

    const second = new TestClient(ctx.app);
    await second.login('maria.hr@abc.test');
    const reused = await second.request('POST', '/api/v1/auth/mfa/challenge', {
      recoveryCode: recoveryCodes[0],
    });
    expect(reused.status).toBe(401);
  });
});

describe('brute-force protection', () => {
  it('limits MFA attempts per identity', async () => {
    await TestClient.withMfa(ctx.app, 'consultant@shared.test');
    const client = new TestClient(ctx.app);
    await client.login('consultant@shared.test');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await client.request('POST', '/api/v1/auth/mfa/challenge', { code: '000000' })).status,
      );
    }
    // One attempt was spent confirming enrollment, so the 5th and later are refused.
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses.slice(4)).toEqual([429, 429]);
  });
});

describe('disabling MFA', () => {
  it('requires a valid second factor', async () => {
    const client = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
    expect(
      (await client.request('POST', '/api/v1/auth/mfa/disable', { code: '000000' })).status,
    ).toBe(401);
    const ok = await client.request('POST', '/api/v1/auth/mfa/disable', {
      code: nextTotp('john.gm@abc.test'),
    });
    expect(ok.status).toBe(204);
    expect((await client.get('/api/v1/auth/session')).body.identity.mfaEnabled).toBe(false);
    expect(await ctx.mailbox.latestFor('john.gm@abc.test', 'mfa-disabled')).toBeDefined();
  });
});
