import { createApp } from './app.factory.js';
import { loadEnv } from './config/env.js';
import { initErrorReporting } from './infrastructure/error-reporting.js';

const env = loadEnv();
initErrorReporting({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  release: env.RELEASE,
  service: 'api',
});
const app = await createApp(env);
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
