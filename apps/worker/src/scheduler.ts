import type { TenantJob } from '@hotel/contracts';
import { toLocal } from '@hotel/format';
import type { PrismaClient } from '@hotel/database';
import type { JobsOptions, Queue } from 'bullmq';
import type { Logger } from 'pino';

/** Property-local wall clock time after which the nightly run is due. */
export const NIGHTLY_AFTER = '03:00';
/** Reminders go out in the morning, property-local time (ADR-0024). */
export const REMINDERS_AFTER = '09:00';

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
 * - `property.daily-reminders`: once per property and local date, after 09:00 local time
 *   (guest arrival/departure reminders, birthdays; ADR-0024).
 * - `organization.daily-documents`: once per organization and local date, after 03:00
 *   local time (document sweep and retention, ADR-0021).
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
    if (local.time >= REMINDERS_AFTER) {
      jobs.push({
        name: 'property.daily-reminders',
        data: {
          type: 'property.daily-reminders',
          organizationId: p.organization_id,
          propertyId: p.id,
          localDate: local.date,
        },
        opts: jobOptions(`reminders:${p.id}:${local.date}`),
      });
    }
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
    const local = toLocal(now, o.default_timezone);
    if (local.time >= NIGHTLY_AFTER) {
      jobs.push({
        name: 'organization.daily-documents',
        data: {
          type: 'organization.daily-documents',
          organizationId: o.id,
          localDate: local.date,
        },
        opts: jobOptions(`documents:${o.id}:${local.date}`),
      });
    }
  }
  if (jobs.length > 0) await queue.addBulk(jobs);
  log.debug({ planned: jobs.length }, 'tenant jobs planned');
  return jobs.length;
}
