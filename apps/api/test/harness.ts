import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DEMO_PASSWORD, type DemoWorld } from '@hotel/database';
import { prepareTestDatabase, testDatabaseUrls } from '@hotel/database/testing';
import { Redis } from 'ioredis';
import { createApp } from '../src/app.factory.js';
import { type Env, loadEnv } from '../src/config/env.js';

export const WEB_ORIGIN = 'http://localhost:43100';

export interface TestContext {
  app: NestFastifyApplication;
  world: DemoWorld;
  env: Env;
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
  const redis = new Redis(redisUrl.toString());
  await redis.flushdb();
  redis.disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: urls.app,
    DATABASE_POOL_SIZE: '4',
    REDIS_CACHE_URL: redisUrl.toString(),
    WEB_ORIGIN,
    COOKIE_SECURE: 'false',
    OPENAPI_ENABLED: 'false',
  });
  const app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, world, env };
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
    return client;
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
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  get(url: string, headers?: Record<string, string>) {
    return this.request('GET', url, undefined, headers);
  }
}
