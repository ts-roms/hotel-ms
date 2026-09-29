import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type EmailJob, NOTIFICATIONS_QUEUE } from '@hotel/contracts';
import {
  DEMO_PASSWORD,
  type DemoWorld,
  prepareTestDatabase,
  testDatabaseUrls,
} from '@hotel/database/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createApp } from '../src/app.factory.js';
import { type Env, loadEnv } from '../src/config/env.js';
import { base32Decode, hotp } from '../src/modules/auth/totp.js';

export const WEB_ORIGIN = 'http://localhost:43100';

/** A minimal JPEG (magic bytes and filler): the selfie every punch needs (ADR-0022). */
export const SELFIE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 7)]);

/** Web punch: type in the query, the selfie as the body. */
export const webPunch = (client: TestClient, propertyUrl: string, type: string) =>
  client.request('POST', `${propertyUrl}/attendance/punches?type=${type}`, SELFIE, {
    'content-type': 'image/jpeg',
  });

export interface TestContext {
  app: NestFastifyApplication;
  world: DemoWorld;
  env: Env;
  /** Emails queued for the worker (the test Redis logical DB). */
  mailbox: Mailbox;
}

let ipCounter = 0;

/**
 * Fresh test database (migrations + demo world), a dedicated Redis logical DB, and an
 * in-process app driven through Fastify inject (no network).
 */
export async function startTestApp(): Promise<TestContext> {
  const world = await prepareTestDatabase();
  const urls = testDatabaseUrls();

  const redisUrl = new URL(process.env.REDIS_CACHE_URL ?? 'redis://localhost:56379');
  redisUrl.pathname = '/15';
  const queueUrl = new URL(process.env.REDIS_QUEUE_URL ?? 'redis://localhost:56380');
  queueUrl.pathname = '/15';
  for (const url of [redisUrl, queueUrl]) {
    const redis = new Redis(url.toString());
    await redis.flushdb();
    redis.disconnect();
  }
  mfaState.clear();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: urls.app,
    DATABASE_POOL_SIZE: '4',
    REDIS_CACHE_URL: redisUrl.toString(),
    REDIS_QUEUE_URL: queueUrl.toString(),
    DATA_ENCRYPTION_KEYS: `test:${randomBytes(32).toString('base64')}`,
    APP_PUBLIC_URL: WEB_ORIGIN,
    WEB_ORIGIN,
    COOKIE_SECURE: 'false',
    OPENAPI_ENABLED: 'false',
    TENANT_JOBS_ENABLED: 'false',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: join(tmpdir(), 'hotel-test-storage', randomUUID()),
  });
  const app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, world, env, mailbox: new Mailbox(queueUrl.toString()) };
}

/** Reads emails the API queued for delivery. */
export class Mailbox {
  private readonly connection: Redis;
  private readonly queue: Queue<EmailJob>;

  constructor(url: string) {
    this.connection = new Redis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue<EmailJob>(NOTIFICATIONS_QUEUE, { connection: this.connection });
  }

  async all(): Promise<EmailJob[]> {
    const jobs = await this.queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    return jobs.sort((a, b) => a.timestamp - b.timestamp).map((j) => j.data);
  }

  async latestFor(to: string, template: EmailJob['template']): Promise<EmailJob | undefined> {
    return (await this.all()).filter((j) => j.to === to && j.template === template).at(-1);
  }

  /** Token from a link's #token= fragment. */
  static tokenFrom(url: string): string {
    return new URL(url).hash.replace(/^#token=/, '');
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}

/**
 * TOTP secrets of identities enrolled during a test file, and the last step used. The
 * server rejects replayed steps and accepts ±1 step, so an identity can complete at most
 * a few MFA operations per 30 seconds; tests spread MFA work across identities.
 */
const mfaState = new Map<string, { secret: string; lastStep: bigint }>();

export function nextTotp(email: string): string {
  const state = mfaState.get(email);
  if (!state) throw new Error(`${email} has no MFA enrolled in this test file`);
  const current = BigInt(Math.floor(Date.now() / 30_000));
  const step = state.lastStep >= current - 1n ? state.lastStep + 1n : current - 1n;
  if (step > current + 1n) throw new Error(`MFA budget for ${email} exhausted in this 30s window`);
  state.lastStep = step;
  return hotp(base32Decode(state.secret), step);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are asserted field by field
export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | number | undefined>;
}

/** A browser-like client: keeps the session cookie and CSRF token, sends Origin. */
export class TestClient {
  private cookie: string | undefined;
  csrfToken: string | undefined;
  /** Distinct client IP per TestClient so login rate limits do not couple tests. */
  readonly ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  constructor(private readonly app: NestFastifyApplication) {}

  async login(email: string, password = DEMO_PASSWORD): Promise<ApiResponse> {
    const res = await this.request('POST', '/api/v1/auth/login', { email, password });
    if (res.status === 200) this.csrfToken = res.body.csrfToken;
    return res;
  }

  static async as(app: NestFastifyApplication, email: string): Promise<TestClient> {
    const client = new TestClient(app);
    const res = await client.login(email);
    if (res.status !== 200)
      throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    if (res.body.mfaPending) {
      const challenge = await client.request('POST', '/api/v1/auth/mfa/challenge', {
        code: nextTotp(email),
      });
      if (challenge.status !== 200)
        throw new Error(`MFA failed for ${email}: ${JSON.stringify(challenge.body)}`);
    }
    return client;
  }

  /** Signs in and enrolls TOTP (once per identity per test file). Returns recovery codes. */
  static async withMfa(
    app: NestFastifyApplication,
    email: string,
  ): Promise<TestClient & { recoveryCodes: string[] }> {
    const client = await TestClient.as(app, email);
    if (mfaState.has(email)) return Object.assign(client, { recoveryCodes: [] });
    const start = await client.request('POST', '/api/v1/auth/mfa/totp/enrollment');
    if (start.status !== 200)
      throw new Error(`MFA enrollment failed: ${JSON.stringify(start.body)}`);
    mfaState.set(email, { secret: start.body.secret, lastStep: 0n });
    const confirm = await client.request('POST', '/api/v1/auth/mfa/totp/enrollment/confirm', {
      code: nextTotp(email),
    });
    if (confirm.status !== 200)
      throw new Error(`MFA confirm failed: ${JSON.stringify(confirm.body)}`);
    return Object.assign(client, { recoveryCodes: confirm.body.recoveryCodes as string[] });
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse> {
    const res = await this.app.inject({
      method,
      url,
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
      headers: {
        origin: WEB_ORIGIN,
        'x-forwarded-for': this.ip,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrfToken && method !== 'GET' ? { 'x-csrf-token': this.csrfToken } : {}),
        ...headers,
      },
    });
    const sessionCookie = res.cookies.find((c) => c.name === 'hotel_sid');
    if (sessionCookie)
      this.cookie = sessionCookie.value ? `hotel_sid=${sessionCookie.value}` : undefined;
    const contentType = String(res.headers['content-type'] ?? '');
    const parsed = contentType.includes('json') && res.body ? JSON.parse(res.body) : res.body;
    if (parsed && typeof parsed === 'object' && 'csrfToken' in parsed)
      this.csrfToken = parsed.csrfToken;
    if (parsed && typeof parsed === 'object' && parsed.session?.csrfToken)
      this.csrfToken = parsed.session.csrfToken;
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  /** Session cookie, for raw requests (e.g. streaming over a real socket). */
  get cookieHeader(): string | undefined {
    return this.cookie;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.request('GET', url, undefined, headers);
  }
}

export const GUEST_ORIGIN = 'http://localhost:43200';
let guestIp = 0;
/** A network per test file, so rate limits keyed by IP never couple files. */
const guestNet = 10 + Math.floor(Math.random() * 240);

/** A guest's browser: the guest cookie, the guest CSRF token, the portal's Origin. */
export class GuestClient {
  private cookie: string | undefined;
  csrfToken: string | undefined;
  /** Distinct client IP per guest so the link-exchange rate limit does not couple tests. */
  private readonly ip = `10.${guestNet}.${Math.floor(++guestIp / 250)}.${guestIp % 250}`;

  constructor(private readonly app: NestFastifyApplication) {}

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse> {
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> | Buffer }),
      headers: {
        origin: GUEST_ORIGIN,
        'x-forwarded-for': this.ip,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrfToken && method !== 'GET' ? { 'x-csrf-token': this.csrfToken } : {}),
        ...headers,
      },
    });
    const cookie = res.cookies.find((c) => c.name === 'hotel_guest');
    if (cookie) this.cookie = cookie.value ? `hotel_guest=${cookie.value}` : undefined;
    const parsed =
      String(res.headers['content-type'] ?? '').includes('json') && res.body
        ? JSON.parse(res.body)
        : res.body;
    if (parsed && typeof parsed === 'object' && typeof parsed.csrfToken === 'string')
      this.csrfToken = parsed.csrfToken;
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  get rawCookie() {
    return this.cookie;
  }
}
