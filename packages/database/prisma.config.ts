import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

// Migrations always run as the schema owner, never as the runtime role (ADR-0003).
export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'node --env-file-if-exists=../../.env dist/seed/run.js',
  },
  datasource: {
    url: process.env.DATABASE_OWNER_URL ?? '',
  },
});
