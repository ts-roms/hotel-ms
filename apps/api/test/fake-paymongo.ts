import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_PAYMONGO_KEY = 'sk_test_fakepaymongo';
export const FAKE_PAYMONGO_WEBHOOK_SECRET = 'whsk_fakepaymongo';

interface Session {
  id: string;
  amount: number;
  referenceNumber: string;
  paymentIntentId: string;
  payments: { id: string; amount: number; sourceType: string }[];
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: { data?: { attributes?: Record<string, unknown> } } | null;
}

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;

/**
 * A local stand-in for api.paymongo.com: checkout sessions, their payments, refunds, and
 * webhook events signed the way PayMongo signs them (`t=…,te=…,li=…`).
 */
export class FakePaymongo {
  readonly requests: RecordedRequest[] = [];
  /** Refund ids handed out, oldest first. */
  readonly refunds: string[] = [];
  private readonly sessions = new Map<string, Session>();
  private server: Server | undefined;
  apiBase = '';

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void this.handle(req).then(({ status, body }) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.apiBase = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url ?? '';
    this.requests.push({
      method: req.method ?? '',
      path,
      authorization: req.headers.authorization,
      body,
    });
    const expected = `Basic ${Buffer.from(`${FAKE_PAYMONGO_KEY}:`).toString('base64')}`;
    if (req.headers.authorization !== expected) {
      return { status: 401, body: { errors: [{ code: 'unauthorized', detail: 'Bad key.' }] } };
    }
    const attributes = body?.data?.attributes ?? {};

    if (req.method === 'POST' && path === '/v1/checkout_sessions') {
      const item = (attributes.line_items as { amount: number }[])[0]!;
      if (item.amount < 2000) {
        return {
          status: 400,
          body: {
            errors: [{ code: 'parameter_below_minimum', detail: 'Amount must be at least 20.' }],
          },
        };
      }
      const session: Session = {
        id: id('cs'),
        amount: item.amount,
        referenceNumber: String(attributes.reference_number),
        paymentIntentId: id('pi'),
        payments: [],
      };
      this.sessions.set(session.id, session);
      return { status: 200, body: { data: this.sessionResource(session) } };
    }
    const sessionMatch = /^\/v1\/checkout_sessions\/(cs_\w+)$/.exec(path);
    if (req.method === 'GET' && sessionMatch) {
      const session = this.sessions.get(sessionMatch[1]!);
      if (!session) return { status: 404, body: { errors: [{ detail: 'Not found.' }] } };
      return { status: 200, body: { data: this.sessionResource(session) } };
    }
    if (req.method === 'POST' && path === '/v1/refunds') {
      const paid = [...this.sessions.values()].flatMap((s) => s.payments);
      if (!paid.some((p) => p.id === attributes.payment_id)) {
        return { status: 400, body: { errors: [{ detail: 'Unknown payment.' }] } };
      }
      const refundId = id('ref');
      this.refunds.push(refundId);
      return {
        status: 200,
        body: {
          data: {
            id: refundId,
            type: 'refund',
            attributes: {
              amount: attributes.amount,
              currency: 'PHP',
              payment_id: attributes.payment_id,
              status: 'pending',
            },
          },
        },
      };
    }
    return { status: 404, body: { errors: [{ detail: 'No such route.' }] } };
  }

  private sessionResource(s: Session) {
    return {
      id: s.id,
      type: 'checkout_session',
      attributes: {
        checkout_url: `https://checkout.paymongo.test/${s.id}`,
        reference_number: s.referenceNumber,
        status: 'active',
        payment_intent: { id: s.paymentIntentId, type: 'payment_intent', attributes: {} },
        payments: s.payments.map((p) => ({
          id: p.id,
          type: 'payment',
          attributes: {
            amount: p.amount,
            currency: 'PHP',
            status: 'paid',
            source: { id: id('src'), type: p.sourceType },
          },
        })),
      },
    };
  }

  /** Signs a body as PayMongo does; `mode` picks which of te/li carries the real MAC. */
  sign(rawBody: string, mode: 'test' | 'live' = 'test', timestamp = Math.floor(Date.now() / 1000)) {
    const mac = createHmac('sha256', FAKE_PAYMONGO_WEBHOOK_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    return mode === 'test' ? `t=${timestamp},te=${mac},li=` : `t=${timestamp},te=,li=${mac}`;
  }

  event(type: string, resource: unknown) {
    const rawBody = JSON.stringify({
      data: {
        id: id('evt'),
        type: 'event',
        attributes: { type, livemode: false, data: resource },
      },
    });
    return {
      rawBody,
      headers: { 'content-type': 'application/json', 'paymongo-signature': this.sign(rawBody) },
    };
  }

  /** The payer pays on the hosted page; returns the webhook PayMongo would send. */
  pay(sessionId: string, sourceType = 'gcash', amount?: number) {
    const session = this.sessions.get(sessionId)!;
    session.payments.push({ id: id('pay'), amount: amount ?? session.amount, sourceType });
    return this.event('checkout_session.payment.paid', this.sessionResource(session));
  }

  refundEvent(refundId: string, status: 'succeeded' | 'failed', amount: number) {
    return this.event('payment.refund.updated', {
      id: refundId,
      type: 'refund',
      attributes: { amount, currency: 'PHP', status },
    });
  }
}
