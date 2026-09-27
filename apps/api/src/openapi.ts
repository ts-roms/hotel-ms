/**
 * Writes the OpenAPI document to docs/api/openapi.json (checked in, diffed in review).
 * Usage: pnpm --filter @hotel/api build && pnpm --filter @hotel/api openapi
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildOpenApiDocument, createApp } from './app.factory.js';
import { loadEnv } from './config/env.js';

const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  OPENAPI_ENABLED: 'false',
  TENANT_JOBS_ENABLED: 'false',
});
const app = await createApp(env);
await app.init();
const doc = buildOpenApiDocument(app);
const out = path.resolve(import.meta.dirname, '../../../docs/api/openapi.json');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
await app.close();
console.log(`OpenAPI written to ${out}`);
