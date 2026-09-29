/**
 * Tax and fee rules per property (Pricing, blueprint §6.1, §15.1): listing, creating and
 * archiving rules, who may do it, and that folio postings use the rules in force when
 * they post. MNL is seeded with VAT 12% inclusive on every department.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let reception: TestClient;
let hk: TestClient;

const MNL = () => ctx.world.abc.properties.MNL;
const base = (propertyId = MNL()) => `/api/v1/properties/${propertyId}`;
const idem = () => ({ 'idempotency-key': `test-${randomUUID()}` });

interface Rule {
  id: string;
  code: string;
  rateBps: number;
  inclusive: boolean;
  departments: string[];
  archived: boolean;
}

const serviceCharge = {
  code: 'SVC',
  name: 'Service charge 10%',
  rateBps: 1000,
  inclusive: false,
  departments: ['SPA'],
};

let svcId: string;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  reception = await TestClient.as(ctx.app, 'reception@abc.test');
  hk = await TestClient.as(ctx.app, 'hk@abc.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('listing', () => {
  it('shows the seeded VAT to anyone who reads folios', async () => {
    const res = await reception.get(`${base()}/tax-rules`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        code: 'VAT',
        name: 'VAT 12%',
        rateBps: 1200,
        inclusive: true,
        departments: ['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'TRANSPORT', 'SPA', 'MISC'],
        archived: false,
      },
    ]);
  });

  it('is refused without folio.read, and hidden outside the caller’s properties', async () => {
    const denied = await hk.get(`${base()}/tax-rules`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    // Reception works at MNL only: other properties do not exist for them.
    expect((await reception.get(`${base(ctx.world.abc.properties.CEB)}/tax-rules`)).status).toBe(
      404,
    );
    const xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
    expect((await xyzAdmin.get(`${base()}/tax-rules`)).status).toBe(404);
  });
});

describe('creating', () => {
  it('needs tax.manage, with a verified second factor', async () => {
    const byReception = await reception.request('POST', `${base()}/tax-rules`, serviceCharge);
    expect(byReception.status).toBe(403);
    expect(byReception.body.code).toBe('FORBIDDEN');

    // The GM holds tax.manage at MNL, but it is sensitive: no MFA, no change.
    const byJohn = await john.request('POST', `${base()}/tax-rules`, serviceCharge);
    expect(byJohn.status).toBe(403);
    expect(byJohn.body.code).toBe('MFA_ENROLLMENT_REQUIRED');

    const list = await reception.get(`${base()}/tax-rules`);
    expect(list.body.map((r: Rule) => r.code)).toEqual(['VAT']);
  });

  it('validates the rule', async () => {
    for (const body of [
      { ...serviceCharge, code: 'svc' },
      { ...serviceCharge, code: 'TOO_LONG_TAX_CODE_X' },
      { ...serviceCharge, name: '   ' },
      { ...serviceCharge, rateBps: 10_001 },
      { ...serviceCharge, rateBps: -1 },
      { ...serviceCharge, rateBps: 2.5 },
      { ...serviceCharge, departments: [] },
      { ...serviceCharge, departments: ['CASINO'] },
      { ...serviceCharge, propertyId: ctx.world.abc.properties.CEB },
    ]) {
      const res = await admin.request('POST', `${base()}/tax-rules`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('creates a rule, audited, and refuses a second rule with the same code', async () => {
    const res = await admin.request('POST', `${base()}/tax-rules`, serviceCharge);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      code: 'SVC',
      name: 'Service charge 10%',
      rateBps: 1000,
      inclusive: false,
      departments: ['SPA'],
      archived: false,
    });
    svcId = res.body.id;

    const dup = await admin.request('POST', `${base()}/tax-rules`, {
      ...serviceCharge,
      name: 'Another',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONFLICT');

    // Codes are per property: the same code is fine at CEB.
    const atCeb = await admin.request(
      'POST',
      `${base(ctx.world.abc.properties.CEB)}/tax-rules`,
      serviceCharge,
    );
    expect(atCeb.status).toBe(201);

    const list = await reception.get(`${base()}/tax-rules`);
    expect(list.body.map((r: Rule) => r.code)).toEqual(['SVC', 'VAT']);

    const audit = await admin.get(`/api/v1/audit-logs?entityType=tax_rule&entityId=${svcId}`);
    expect(audit.body.items).toEqual([
      expect.objectContaining({
        action: 'tax_rule.created',
        propertyId: MNL(),
        actorType: 'MEMBER',
        actorId: ctx.world.identities['admin@abc.test'],
        after: expect.objectContaining({ code: 'SVC', rateBps: 1000 }),
      }),
    ]);
  });
});

describe('charges', () => {
  let folioUrl: string;

  const charge = async (department: string, amountMinor: number) => {
    const res = await reception.request(
      'POST',
      `${folioUrl}/charges`,
      { department, description: `${department} test`, amountMinor },
      idem(),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  /** Lines of the last posting: the charge and the tax lines posted with it. */
  const lastPosting = (folio: {
    lines: {
      id: string;
      type: string;
      amountMinor: number;
      taxCode: string | null;
      parentLineId: string | null;
    }[];
  }) => {
    const chargeLine = folio.lines.filter((l) => l.type === 'CHARGE').at(-1)!;
    return [chargeLine, ...folio.lines.filter((l) => l.parentLineId === chargeLine.id)].map((l) => [
      l.type,
      l.amountMinor,
      l.taxCode,
    ]);
  };

  beforeAll(async () => {
    const account = await admin.request('POST', `${base()}/accounts`, { label: 'Spa house' });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    folioUrl = `${base()}/folios/${account.body.id}`;
  });

  it('adds an exclusive rule on top of the net, next to the inclusive VAT', async () => {
    const folio = await charge('SPA', 112_000);
    expect(lastPosting(folio)).toEqual([
      ['CHARGE', 100_000, null],
      ['TAX', 12_000, 'VAT'],
      ['TAX', 10_000, 'SVC'],
    ]);
    expect(folio.balanceMinor).toBe(122_000);
  });

  it('applies a rule only to its departments', async () => {
    const folio = await charge('FNB', 56_000);
    expect(lastPosting(folio)).toEqual([
      ['CHARGE', 50_000, null],
      ['TAX', 6_000, 'VAT'],
    ]);
    expect(folio.balanceMinor).toBe(122_000 + 56_000);
  });
});

describe('archiving', () => {
  it('needs tax.manage', async () => {
    const res = await reception.request('POST', `${base()}/tax-rules/${svcId}/archive`);
    expect(res.status).toBe(403);
  });

  it('archives once (idempotently), audited, and stops applying the rule', async () => {
    const res = await admin.request('POST', `${base()}/tax-rules/${svcId}/archive`);
    expect(res.status).toBe(204);
    expect((await admin.request('POST', `${base()}/tax-rules/${svcId}/archive`)).status).toBe(204);

    const list = await reception.get(`${base()}/tax-rules`);
    expect(list.body.find((r: Rule) => r.id === svcId)).toMatchObject({ archived: true });

    const audit = await admin.get(`/api/v1/audit-logs?entityType=tax_rule&entityId=${svcId}`);
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual([
      'tax_rule.archived',
      'tax_rule.created',
    ]);

    const account = await admin.request('POST', `${base()}/accounts`, { label: 'Spa later' });
    const posted = await reception.request(
      'POST',
      `${base()}/folios/${account.body.id}/charges`,
      { department: 'SPA', description: 'Massage', amountMinor: 112_000 },
      idem(),
    );
    expect(posted.status).toBe(200);
    expect(
      posted.body.lines.map((l: { type: string; taxCode: string | null }) => [l.type, l.taxCode]),
    ).toEqual([
      ['CHARGE', null],
      ['TAX', 'VAT'],
    ]);
    expect(posted.body.balanceMinor).toBe(112_000);
  });

  it('keeps the code of an archived rule reserved (history references it)', async () => {
    const res = await admin.request('POST', `${base()}/tax-rules`, {
      ...serviceCharge,
      rateBps: 500,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('refuses unknown rules and rules of another property', async () => {
    expect(
      (await admin.request('POST', `${base()}/tax-rules/${randomUUID()}/archive`)).status,
    ).toBe(404);
    // A malformed id answers like a missing one.
    expect((await admin.request('POST', `${base()}/tax-rules/not-a-uuid/archive`)).status).toBe(
      404,
    );
    const ceb = await admin.get(`${base(ctx.world.abc.properties.CEB)}/tax-rules`);
    const cebVat = ceb.body.find((r: Rule) => r.code === 'VAT');
    expect(cebVat).toBeDefined();
    const crossed = await admin.request('POST', `${base()}/tax-rules/${cebVat.id}/archive`);
    expect(crossed.status).toBe(404);
    const after = await admin.get(`${base(ctx.world.abc.properties.CEB)}/tax-rules`);
    expect(after.body.find((r: Rule) => r.id === cebVat.id).archived).toBe(false);
  });
});
