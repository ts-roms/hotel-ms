import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(48100),
  /** Runtime tenant role. RLS enforced. */
  DATABASE_URL: z.url(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_CACHE_URL: z.url(),
  /** BullMQ (non-evicting instance, ADR-0007). The API only produces jobs. */
  REDIS_QUEUE_URL: z.url(),
  /** Base URL of the staff web app, used to build links in emails. */
  APP_PUBLIC_URL: z.url().default('http://localhost:43100'),
  /** AES-256-GCM keys for sensitive columns: "kid:base64key[,kid:base64key]" (newest first). */
  DATA_ENCRYPTION_KEYS: z.string().min(1),
  /** Issuer label shown in authenticator apps. */
  MFA_ISSUER: z.string().default('Hotel Platform'),
  /** Browser origins allowed to call the API (CORS + CSRF Origin check). Comma-separated. */
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:43100')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  /** Origin of the guest portal app (its own origin and cookie; blueprint §11). */
  GUEST_ORIGIN: z.string().default('http://localhost:43200'),
  /** Base URL of the guest portal, used in emailed links. */
  GUEST_PUBLIC_URL: z.url().default('http://localhost:43200'),
  /** HMAC key for CSRF tokens. At least 32 bytes of entropy in real environments. */
  SESSION_SECRET: z.string().min(32),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .default(12 * 60),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  /** Secure cookies with the __Host- prefix. Defaults on outside development/test. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Number of proxy hops to trust for X-Forwarded-For. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OPENAPI_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Public base URL of this API (hosted checkout pages, provider callbacks). */
  API_PUBLIC_ORIGIN: z.url().default('http://localhost:48100'),
  /** Online payment gateway (ADR-0016). Unset: online payments are unavailable. */
  PAYMENT_PROVIDER: z.enum(['sandbox']).optional(),
  /**
   * The built-in sandbox gateway (hosted test checkout, signed webhooks). On by default
   * outside production; production needs an explicit 'true' (e.g. staging).
   */
  PAYMENT_SANDBOX_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  PAYMENT_SANDBOX_SECRET: z.string().min(16).default('sandbox-webhook-secret-dev-only'),
});

export type Env = Omit<
  z.infer<typeof envSchema>,
  'COOKIE_SECURE' | 'OPENAPI_ENABLED' | 'PAYMENT_SANDBOX_ENABLED' | 'PAYMENT_PROVIDER'
> & {
  COOKIE_SECURE: boolean;
  OPENAPI_ENABLED: boolean;
  PAYMENT_SANDBOX_ENABLED: boolean;
  PAYMENT_PROVIDER: 'sandbox' | null;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const isLocal = env.NODE_ENV !== 'production';
  if (!isLocal && env.SESSION_SECRET.startsWith('change-me')) {
    throw new Error('SESSION_SECRET must be set to a real secret in production');
  }
  const sandbox = env.PAYMENT_SANDBOX_ENABLED ?? isLocal;
  if (env.PAYMENT_PROVIDER === 'sandbox' && !sandbox) {
    throw new Error('PAYMENT_PROVIDER=sandbox needs PAYMENT_SANDBOX_ENABLED=true');
  }
  if (sandbox && !isLocal && env.PAYMENT_SANDBOX_SECRET.endsWith('dev-only')) {
    throw new Error('PAYMENT_SANDBOX_SECRET must be set to a real secret outside development');
  }
  return {
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? !isLocal,
    OPENAPI_ENABLED: env.OPENAPI_ENABLED ?? isLocal,
    PAYMENT_SANDBOX_ENABLED: sandbox,
    PAYMENT_PROVIDER: env.PAYMENT_PROVIDER ?? (sandbox ? 'sandbox' : null),
  };
}

export const ENV = Symbol('ENV');
