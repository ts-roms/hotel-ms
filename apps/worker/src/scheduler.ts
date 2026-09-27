import type { TenantJob } from '@hotel/contracts';
import type { PrismaClient } from '@hotel/database';
import type { JobsOptions, Queue } from 'bullmq';
import type { Logger } from 'pino';

/** Property-local wall clock time after which the nightly run is due. */
export const NIGHTLY_AFTER = '03:00';

function toLocal(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

const jobOptions = (jobId: string): JobsOptions => ({
  // The job id makes planning idempotent: the same run is queued at most once, however
  // often or on however many worker instances the planner runs.
  jobId,
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 3 * 86_400 },
  removeOnFail: { age: 14 * 86_400 },
});

/**
 * Plans scheduled tenant work from the clock (ADR-0017). Runs with the system role, which
 * may only list properties and organizations (ids, time zones, status); the jobs are run
 * by the API in each tenant's own context.
 *
 * - `property.nightly`: once per property and local date, after 03:00 local time
 *   (reconciliation).
 * - `organization.monthly-accrual`: once per organization and local month (leave accruals).
 */
export async function planTenantJobs(
  system: PrismaClient,
  queue: Queue<TenantJob>,
  log: Logger,
  now = new Date(),
): Promise<number> {
  const properties = await system.$queryRaw<
    { id: string; organization_id: string; timezone: string }[]
  >`
    SELECT id, organization_id, timezone FROM properties WHERE status <> 'INACTIVE'`;
  const organizations = await system.$queryRaw<{ id: string; default_timezone: string }[]>`
    SELECT id, default_timezone FROM organizations WHERE status = 'ACTIVE'`;
  const active = new Set(organizations.map((o) => o.id));

  const jobs: { name: string; data: TenantJob; opts: JobsOptions }[] = [];
  for (const p of properties) {
    if (!active.has(p.organization_id)) continue;
    const local = toLocal(now, p.timezone);
    if (local.time < NIGHTLY_AFTER) continue;
    jobs.push({
      name: 'property.nightly',
      data: {
        type: 'property.nightly',
        organizationId: p.organization_id,
        propertyId: p.id,
        localDate: local.date,
      },
      opts: jobOptions(`nightly:${p.id}:${local.date}`),
    });
  }
  for (const o of organizations) {
    const period = toLocal(now, o.default_timezone).date.slice(0, 7);
    jobs.push({
      name: 'organization.monthly-accrual',
      data: { type: 'organization.monthly-accrual', organizationId: o.id, period },
      opts: jobOptions(`accrual:${o.id}:${period}`),
    });
  }
  if (jobs.length > 0) await queue.addBulk(jobs);
  log.debug({ planned: jobs.length }, 'tenant jobs planned');
  return jobs.length;
}
