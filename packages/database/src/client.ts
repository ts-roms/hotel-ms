import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Shows up in pg_stat_activity; use one per process role (api, worker, relay). */
  applicationName?: string;
  /** Pool size per process. Keep small; PgBouncer/RDS Proxy multiplexes in production. */
  maxConnections?: number;
}

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    application_name: options.applicationName ?? 'hotel-platform',
    max: options.maxConnections ?? 10,
  });
  return new PrismaClient({ adapter });
}
