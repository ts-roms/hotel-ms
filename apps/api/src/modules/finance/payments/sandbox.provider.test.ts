import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProblemException } from '../../../common/problem.js';
import { SandboxProvider } from './providers.js';

const SECRET = 'sandbox-test-secret';
const env = { API_PUBLIC_ORIGIN: 'http://localhost:43000', PAYMENT_SANDBOX_SECRET: SECRET };
const provider = new SandboxProvider(env);

const now = () => Math.floor(Date.now() / 1000);

const succeeded = (overrides: Partial<Parameters<SandboxProvider['event']>[0]> = {}) =>
  provider.event({
    type: 'payment.succeeded',
    reference: 'sbx_abc',
    amountMinor: 350_000,
    currency: 'PHP',
    ...overrides,
  });

const verify = (
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  p: SandboxProvider = provider,
) => p.verifyWebhook(Buffer.from(rawBody), headers);

/** The error code a verification throws, or null when it verifies. */
const failure = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).status).toBe(400);
    return (error as ProblemException).code;
  }
};

/** A signature made the way a sender without our secret (or with a wrong one) would. */
const signWith = (secret: string, rawBody: string, timestamp = now()) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;

describe('sandbox webhook signature', () => {
  it('verifies a signed event and normalizes it', () => {
    const { rawBody, headers } = succeeded({ method: 'EWALLET' });
    const event = verify(rawBody, headers);
    expect(event).toEqual({
      eventId: JSON.parse(rawBody).id,
      type: 'payment.succeeded',
      reference: 'sbx_abc',
      amountMinor: 350_000,
      currency: 'PHP',
      method: 'EWALLET',
      failureReason: null,
    });
    expect(event.eventId).toMatch(/^evt_[0-9a-f]{24}$/);
  });

  it('carries the failure reason of a failed payment', () => {
    const { rawBody, headers } = succeeded({ type: 'payment.failed', failureReason: 'declined' });
    expect(verify(rawBody, headers)).toMatchObject({
      type: 'payment.failed',
      failureReason: 'declined',
    });
  });

  it('refuses a tampered body', () => {
    const { rawBody, headers } = succeeded();
    const tampered = rawBody.replace('350000', '1');
    expect(tampered).not.toBe(rawBody);
    expect(failure(() => verify(tampered, headers))).toBe('INVALID_SIGNATURE');
    // Even whitespace changes the MAC.
    expect(failure(() => verify(`${rawBody} `, headers))).toBe('INVALID_SIGNATURE');
  });

  it('refuses a signature made with another secret', () => {
    const { rawBody, headers } = succeeded();
    const forged = { 'sandbox-signature': signWith('not-the-secret', rawBody) };
    expect(failure(() => verify(rawBody, forged))).toBe('INVALID_SIGNATURE');
    // A receiver configured with another secret refuses our genuine events.
    const other = new SandboxProvider({ ...env, PAYMENT_SANDBOX_SECRET: 'other-secret' });
    expect(failure(() => verify(rawBody, headers, other))).toBe('INVALID_SIGNATURE');
    // Control: the same construction with the right secret verifies.
    const genuine = { 'sandbox-signature': signWith(SECRET, rawBody) };
    expect(failure(() => verify(rawBody, genuine))).toBe(null);
  });

  it('refuses a missing, repeated or malformed signature header', () => {
    const { rawBody, headers } = succeeded();
    const signature = headers['sandbox-signature']!;
    expect(failure(() => verify(rawBody, {}))).toBe('INVALID_SIGNATURE');
    expect(failure(() => verify(rawBody, { 'sandbox-signature': [signature, signature] }))).toBe(
      'INVALID_SIGNATURE',
    );
    expect(failure(() => verify(rawBody, { 'sandbox-signature': '' }))).toBe('INVALID_SIGNATURE');
    const [t, v1] = signature.split(',') as [string, string];
    expect(failure(() => verify(rawBody, { 'sandbox-signature': t }))).toBe('INVALID_SIGNATURE');
    expect(failure(() => verify(rawBody, { 'sandbox-signature': v1 }))).toBe('INVALID_SIGNATURE');
    expect(failure(() => verify(rawBody, { 'sandbox-signature': `${t},v1=zz` }))).toBe(
      'INVALID_SIGNATURE',
    );
    expect(
      failure(() => verify(rawBody, { 'sandbox-signature': `${t},v1=${'0'.repeat(64)}` })),
    ).toBe('INVALID_SIGNATURE');
  });

  it('refuses stale and far-future timestamps (replay window of five minutes)', () => {
    const { rawBody } = succeeded();
    const at = (timestamp: number) => ({
      'sandbox-signature': provider.sign(rawBody, timestamp),
    });
    expect(failure(() => verify(rawBody, at(now() - 240)))).toBe(null);
    expect(failure(() => verify(rawBody, at(now() - 400)))).toBe('INVALID_SIGNATURE');
    expect(failure(() => verify(rawBody, at(now() + 400)))).toBe('INVALID_SIGNATURE');
    const mac = provider.sign(rawBody, now()).split('v1=')[1];
    expect(failure(() => verify(rawBody, { 'sandbox-signature': `t=soon,v1=${mac}` }))).toBe(
      'INVALID_SIGNATURE',
    );
  });

  it('refuses authentic bodies that are not a usable event', () => {
    const signed = (rawBody: string) => ({ 'sandbox-signature': provider.sign(rawBody) });
    const body = (patch: Record<string, unknown>, data: Record<string, unknown> = {}) =>
      JSON.stringify({
        id: 'evt_1',
        type: 'payment.succeeded',
        ...patch,
        data: { reference: 'sbx_abc', amountMinor: 100, currency: 'PHP', ...data },
      });

    for (const rawBody of [
      'not json',
      body({ id: 42 }),
      body({ type: 'payment.disputed' }),
      body({}, { reference: null }),
      body({}, { amountMinor: 1.5 }),
      body({}, { amountMinor: '100' }),
      body({}, { currency: undefined }),
    ]) {
      expect(
        failure(() => verify(rawBody, signed(rawBody))),
        rawBody,
      ).toBe('INVALID_SIGNATURE');
    }
    // An unknown payment method falls back to CARD rather than failing.
    const unknownMethod = body({}, { method: 'CRYPTO' });
    expect(verify(unknownMethod, signed(unknownMethod)).method).toBe('CARD');
  });
});

describe('sandbox gateway', () => {
  it('hands out a checkout URL on this API', async () => {
    const checkout = await provider.createCheckout();
    expect(checkout.reference).toMatch(/^sbx_[0-9a-f]{24}$/);
    expect(checkout.checkoutUrl).toBe(
      `http://localhost:43000/api/v1/sandbox-gateway/checkout/${checkout.reference}`,
    );
  });

  it('refunds at once, except magic amounts ending in 13 which stay pending', async () => {
    expect(await provider.refund({ amountMinor: 10_000 })).toMatchObject({ status: 'SUCCEEDED' });
    const pending = await provider.refund({ amountMinor: 10_013 });
    expect(pending.status).toBe('PENDING');
    expect(pending.reference).toMatch(/^sbx_re_[0-9a-f]{20}$/);
  });
});
