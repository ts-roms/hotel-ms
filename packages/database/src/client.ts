import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Shows up in pg_stat_activity; use one per process role (api, worker, relay). */
  applicationName?: string;
  /** Pool size per process. Keep small; PgBouncer/RDS Proxy multiplexes in production. */
  maxConnections?: number;
  /** Report statements that take at least this many milliseconds (off when unset). */
  slowQueryMs?: number;
  /** Receives slow statements: the SQL text only, never the parameter values (PII). */
  onSlowQuery?: (query: { sql: string; durationMs: number }) => void;
}

interface QueryEventEmitter {
  $on(event: 'query', listener: (e: { query: string; duration: number }) => void): void;
}

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    application_name: options.applicationName ?? 'hotel-platform',
    max: options.maxConnections ?? 10,
  });
  const slowQueryMs = options.slowQueryMs;
  if (!slowQueryMs) return new PrismaClient({ adapter });
  const client = new PrismaClient({ adapter, log: [{ emit: 'event', level: 'query' }] });
  (client as unknown as QueryEventEmitter).$on('query', (e) => {
    if (e.duration >= slowQueryMs) options.onSlowQuery?.({ sql: e.query, durationMs: e.duration });
  });
  return client;
}
