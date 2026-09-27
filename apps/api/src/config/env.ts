import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(48100),
  /** Runtime tenant role. RLS enforced. */
  DATABASE_URL: z.url(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_CACHE_URL: z.url(),
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
});

export type Env = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE' | 'OPENAPI_ENABLED'> & {
  COOKIE_SECURE: boolean;
  OPENAPI_ENABLED: boolean;
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
  return {
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? !isLocal,
    OPENAPI_ENABLED: env.OPENAPI_ENABLED ?? isLocal,
  };
}

export const ENV = Symbol('ENV');
