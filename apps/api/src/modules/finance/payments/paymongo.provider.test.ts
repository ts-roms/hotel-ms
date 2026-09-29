import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_PAYMONGO_KEY,
  FAKE_PAYMONGO_WEBHOOK_SECRET,
  FakePaymongo,
} from '../../../../test/fake-paymongo.js';
import { ProblemException } from '../../../common/problem.js';
import { PaymongoProvider } from './paymongo.provider.js';

let fake: FakePaymongo;
let provider: PaymongoProvider;

const checkout = (overrides: Partial<Parameters<PaymongoProvider['createCheckout']>[0]> = {}) =>
  provider.createCheckout({
    intentId: '01a0ebe0-0000-7000-8000-000000000001',
    capture: 'AUTOMATIC',
    amountMinor: 350_000,
    currency: 'PHP',
    description: 'Folio F-000001',
    returnUrl: 'http://localhost:43100/p/x/folios/y',
    ...overrides,
  });

const verify = (e: { rawBody: string; headers: Record<string, string> }, p = provider) =>
  p.verifyWebhook(Buffer.from(e.rawBody), e.headers);

const code = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProblemException);
  return (error as ProblemException).code;
};

beforeAll(async () => {
  fake = await new FakePaymongo().start();
  provider = new PaymongoProvider({
    secretKey: FAKE_PAYMONGO_KEY,
    webhookSecret: FAKE_PAYMONGO_WEBHOOK_SECRET,
    methods: ['card', 'gcash', 'paymaya'],
    apiBase: fake.apiBase,
  });
});
afterAll(() => fake.stop());

describe('PayMongo checkout', () => {
  it('creates a hosted checkout session for the intent', async () => {
    const result = await checkout();
    expect(result.reference).toMatch(/^cs_\w+$/);
    expect(result.checkoutUrl).toBe(`https://checkout.paymongo.test/${result.reference}`);
    const sent = fake.requests.at(-1)!;
    expect(sent.method).toBe('POST');
    expect(sent.body?.data?.attributes).toMatchObject({
      line_items: [{ name: 'Folio F-000001', amount: 350_000, currency: 'PHP', quantity: 1 }],
      payment_method_types: ['card', 'gcash', 'paymaya'],
      reference_number: '01a0ebe0-0000-7000-8000-000000000001',
      success_url: 'http://localhost:43100/p/x/folios/y',
    });
  });

  it('passes PayMongo errors on, and refuses holds and other currencies', async () => {
    const error = await checkout({ amountMinor: 100 }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 422,
      code: 'PAYMENT_PROVIDER_REJECTED',
      detail: 'PayMongo: Amount must be at least 20.',
    });
    expect(await code(checkout({ capture: 'MANUAL' }))).toBe('FEATURE_DISABLED');
    expect(await code(checkout({ currency: 'USD' }))).toBe('FEATURE_DISABLED');
    const wrongKey = new PaymongoProvider({
      secretKey: 'sk_test_wrong',
      webhookSecret: FAKE_PAYMONGO_WEBHOOK_SECRET,
      methods: ['card'],
      apiBase: fake.apiBase,
    });
    const refused = await wrongKey
      .createCheckout({
        intentId: 'x',
        capture: 'AUTOMATIC',
        amountMinor: 5000,
        currency: 'PHP',
        description: 'x',
        returnUrl: 'http://localhost',
      })
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 502, detail: 'PayMongo: Bad key.' });
  });
});

describe('PayMongo webhooks', () => {
  it('maps a paid checkout to payment.succeeded with the payer’s method', async () => {
    const { reference } = await checkout();
    const event = verify(fake.pay(reference, 'gcash'));
    expect(event).toMatchObject({
      type: 'payment.succeeded',
      reference,
      amountMinor: 350_000,
      currency: 'PHP',
      method: 'EWALLET',
    });
    expect(event!.eventId).toMatch(/^evt_/);
    const card = await checkout();
    expect(verify(fake.pay(card.reference, 'card'))!.method).toBe('CARD');
    const bank = await checkout();
    expect(verify(fake.pay(bank.reference, 'dob'))!.method).toBe('BANK_TRANSFER');
  });

  it('rejects forged, stale, unsigned and live-mode signatures under a test key', async () => {
    const { reference } = await checkout();
    const event = fake.pay(reference);
    const tampered = { ...event, rawBody: event.rawBody.replace('350000', '1') };
    expect(() => verify(tampered)).toThrow(ProblemException);
    const stale = fake.sign(event.rawBody, 'test', Math.floor(Date.now() / 1000) - 3600);
    expect(() => verify({ ...event, headers: { 'paymongo-signature': stale } })).toThrow();
    expect(() => verify({ ...event, headers: {} })).toThrow();
    // A test key trusts only `te`; a live key only `li`.
    const liveSigned = {
      ...event,
      headers: { 'paymongo-signature': fake.sign(event.rawBody, 'live') },
    };
    expect(() => verify(liveSigned)).toThrow();
    const live = new PaymongoProvider({
      secretKey: 'sk_live_x',
      webhookSecret: FAKE_PAYMONGO_WEBHOOK_SECRET,
      methods: ['card'],
      apiBase: fake.apiBase,
    });
    expect(verify(liveSigned, live)?.type).toBe('payment.succeeded');
    expect(() => verify(event, live)).toThrow();
  });

  it('maps finished refunds and ignores events we do not act on', () => {
    expect(verify(fake.refundEvent('ref_abc', 'succeeded', 1000))).toMatchObject({
      type: 'refund.succeeded',
      reference: 'ref_abc',
      amountMinor: 1000,
    });
    expect(verify(fake.refundEvent('ref_abc', 'failed', 1000))?.type).toBe('refund.failed');
    expect(verify(fake.event('payment.paid', { id: 'pay_x', attributes: {} }))).toBeNull();
    expect(verify(fake.event('payment.failed', { id: 'pay_x', attributes: {} }))).toBeNull();
    expect(
      verify(
        fake.event('payment.refund.updated', { id: 'ref_x', attributes: { status: 'pending' } }),
      ),
    ).toBeNull();
  });
});

describe('PayMongo refunds', () => {
  it('refunds the checkout’s paid payment and reports it pending', async () => {
    const { reference } = await checkout();
    verify(fake.pay(reference, 'card'));
    const result = await provider.refund({
      paymentReference: reference,
      amountMinor: 50_000,
      currency: 'PHP',
    });
    expect(result).toMatchObject({ status: 'PENDING', reference: expect.stringMatching(/^ref_/) });
    const [lookup, refund] = fake.requests.slice(-2);
    expect(lookup).toMatchObject({ method: 'GET', path: `/v1/checkout_sessions/${reference}` });
    expect(refund!.body?.data?.attributes).toMatchObject({
      amount: 50_000,
      payment_id: expect.stringMatching(/^pay_/),
      reason: 'requested_by_customer',
    });
  });

  it('fails when the checkout was never paid or the reference is not PayMongo’s', async () => {
    const { reference } = await checkout();
    const args = { amountMinor: 1000, currency: 'PHP' };
    expect(await code(provider.refund({ paymentReference: reference, ...args }))).toBe(
      'INTERNAL_ERROR',
    );
    expect(await code(provider.refund({ paymentReference: '../evil', ...args }))).toBe(
      'INTERNAL_ERROR',
    );
  });
});
