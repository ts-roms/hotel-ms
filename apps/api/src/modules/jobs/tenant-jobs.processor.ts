import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TENANT_JOBS_QUEUE, type TenantJob } from '@hotel/contracts';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { reportError } from '../../infrastructure/error-reporting.js';
import { GuestIdentityService } from '../pms/guests/guest-identity.service.js';
import { EmployeeDocumentsService } from '../hr/workforce/employee-documents.service.js';
import { LeaveService } from '../hr/time/leave.service.js';
import { ProfileRecordsService } from '../hr/workforce/profile-records.service.js';
import { TimeClockService } from '../hr/time/time-clock.service.js';
import { RemindersService } from './reminders.service.js';
import { FinanceReportsService } from '../finance/reports/finance-reports.service.js';

/**
 * Runs scheduled tenant jobs planned by the worker (ADR-0017). Each job runs in its own
 * request-like context for its organization, as the SYSTEM actor. Job data comes only
 * from our own scheduler through the internal queue.
 */
@Injectable()
export class TenantJobsProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<TenantJob> | null = null;
  private connection: Redis | null = null;

  constructor(
    private readonly cls: ClsService<RequestContext>,
    private readonly reports: FinanceReportsService,
    private readonly leave: LeaveService,
    private readonly documents: EmployeeDocumentsService,
    private readonly timeClock: TimeClockService,
    private readonly reminders: RemindersService,
    private readonly guestIds: GuestIdentityService,
    private readonly records: ProfileRecordsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!this.env.TENANT_JOBS_ENABLED) return;
    this.connection = new Redis(this.env.REDIS_QUEUE_URL, { maxRetriesPerRequest: null });
    this.connection.on('error', () => undefined);
    this.worker = new Worker<TenantJob>(
      TENANT_JOBS_QUEUE,
      (job) => this.run(job.data, String(job.id)),
      {
        connection: this.connection,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, error) =>
      reportError(error, {
        job: job?.data.type,
        jobId: job?.id,
        organizationId: job?.data.organizationId,
        attempts: job?.attemptsMade,
      }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }

  /** Executes one job; also called directly by tests. */
  run(job: TenantJob, jobId = 'direct'): Promise<unknown> {
    return this.cls.run(async () => {
      this.cls.set('requestId', `job:${jobId}`);
      this.cls.set('ip', null);
      this.cls.set('userAgent', null);
      this.cls.set('system', true);
      this.cls.set('organizationId', job.organizationId);
      switch (job.type) {
        case 'property.nightly':
          this.cls.set('propertyId', job.propertyId);
          return this.reports.recordNightly(job.propertyId, job.localDate);
        case 'property.daily-reminders':
          this.cls.set('propertyId', job.propertyId);
          return this.reminders.run(job.propertyId, job.localDate);
        case 'organization.monthly-accrual':
          return this.leave.accrueMonth(job.period);
        case 'organization.daily-documents': {
          const documents = await this.documents.runDaily(job.localDate);
          const photos = await this.timeClock.purgePhotos();
          const guestIds = await this.guestIds.purge();
          const certifications = await this.records.remindExpiring(job.localDate);
          return {
            ...documents,
            photosPurged: photos,
            guestIdsPurged: guestIds,
            certificationReminders: certifications,
          };
        }
      }
    });
  }
}
