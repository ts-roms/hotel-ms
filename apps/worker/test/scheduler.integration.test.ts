import type { TenantJob } from '@hotel/contracts';
import { createPrismaClient, type PrismaClient } from '@hotel/database';
import type { DemoWorld } from '@hotel/database';
import { prepareTestDatabase, testDatabaseUrls } from '@hotel/database/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planTenantJobs } from '../src/scheduler.js';

let world: DemoWorld;
let system: PrismaClient;
let connection: Redis;
let queue: Queue<TenantJob>;
const log = pino({ level: 'silent' });

beforeAll(async () => {
  world = await prepareTestDatabase();
  system = createPrismaClient({ connectionString: testDatabaseUrls().system, maxConnections: 2 });
  const url = new URL(process.env.REDIS_QUEUE_URL ?? 'redis://localhost:56380');
  url.pathname = '/15';
  connection = new Redis(url.toString(), { maxRetriesPerRequest: null });
  queue = new Queue<TenantJob>('test-tenant-jobs', { connection });
  await queue.obliterate({ force: true });
}, 120_000);

afterAll(async () => {
  await queue?.obliterate({ force: true });
  await queue?.close();
  connection?.disconnect();
  await system?.$disconnect();
});

describe('tenant job planner', () => {
  it('plans nothing nightly before 03:00 local time, and the monthly accrual per organization', async () => {
    await planTenantJobs(system, queue, log, new Date('2026-10-01T18:30:00Z')); // 02:30 in Manila
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    expect(jobs.filter((j) => j.data.type === 'property.nightly')).toEqual([]);
    expect(jobs.map((j) => j.id).sort()).toEqual(
      [
        `accrual:${world.abc.organizationId}:2026-10`,
        `accrual:${world.xyz.organizationId}:2026-10`,
      ].sort(),
    );
  });

  it('plans each property once per local date, however often it runs', async () => {
    const now = new Date('2026-10-01T20:00:00Z'); // 04:00 on 2 October in Manila
    await planTenantJobs(system, queue, log, now);
    await planTenantJobs(system, queue, log, now);
    const nightly = (await queue.getJobs(['waiting', 'delayed'])).filter(
      (j) => j.data.type === 'property.nightly',
    );
    const properties = [
      ...Object.values(world.abc.properties),
      ...Object.values(world.xyz.properties),
    ];
    expect(nightly.map((j) => j.id).sort()).toEqual(
      properties.map((id) => `nightly:${id}:2026-10-02`).sort(),
    );
    const mnl = nightly.find(
      (j) => j.data.type === 'property.nightly' && j.data.propertyId === world.abc.properties.MNL,
    );
    expect(mnl?.data).toEqual({
      type: 'property.nightly',
      organizationId: world.abc.organizationId,
      propertyId: world.abc.properties.MNL,
      localDate: '2026-10-02',
    });
  });

  it('plans document housekeeping once per organization and local date, after 03:00', async () => {
    const now = new Date('2026-10-01T20:00:00Z'); // 04:00 on 2 October in Manila
    await planTenantJobs(system, queue, log, now);
    await planTenantJobs(system, queue, log, now);
    const documents = (await queue.getJobs(['waiting', 'delayed'])).filter(
      (j) => j.data.type === 'organization.daily-documents',
    );
    expect(documents.map((j) => j.id).sort()).toEqual(
      [
        `documents:${world.abc.organizationId}:2026-10-02`,
        `documents:${world.xyz.organizationId}:2026-10-02`,
      ].sort(),
    );
  });

  it('the system role still sees no tenant business data', async () => {
    await expect(system.$queryRaw`SELECT name FROM properties`).rejects.toThrow(
      /permission denied/,
    );
    await expect(system.$queryRaw`SELECT name FROM organizations`).rejects.toThrow(
      /permission denied/,
    );
    await expect(system.reservation.findMany()).rejects.toThrow(/permission denied/);
  });
});
