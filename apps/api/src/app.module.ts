import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { ProblemFilter } from './common/problem.filter.js';
import type { Env } from './config/env.js';
import { CoreModule } from './core.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuthGuard, PermissionGuard, TenantGuard } from './modules/auth/guards.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { FnbModule } from './modules/fnb/fnb.module.js';
import { FrontOfficeModule } from './modules/front-office/front-office.module.js';
import { GuestPortalModule } from './modules/guest-portal/guest-portal.module.js';
import { GuestGuard } from './modules/guest-portal/guest-session.js';
import { HealthModule } from './modules/health/health.module.js';
import { HrModule } from './modules/hr/hr.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { ManagementModule } from './modules/management/management.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { OpsModule } from './modules/ops/ops.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { PmsModule } from './modules/pms/pms.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';

/**
 * One Nest module per bounded context (blueprint §6.1, ADR-0031). Each declares its
 * controllers and providers and exports only what other contexts call; the shared kernel
 * (CoreModule, AuditModule, OutboxModule) is global.
 */
export const CONTEXT_MODULES = [
  AuditModule,
  OutboxModule,
  HealthModule,
  AuthModule,
  AccessModule,
  TenancyModule,
  NotificationsModule,
  PmsModule,
  OperationsModule,
  FinanceModule,
  FrontOfficeModule,
  GuestPortalModule,
  HrModule,
  DevicesModule,
  CalendarModule,
  ManagementModule,
  FnbModule,
  PrivacyModule,
  OpsModule,
  JobsModule,
];

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        // The CLS context is entered in a Fastify onRequest hook (see app.factory.ts).
        ClsModule.forRoot({ global: true }),
        CoreModule.forRoot(env),
        ...CONTEXT_MODULES,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemFilter },
        // Order matters: authenticate → establish tenant → authorize. Guest routes are
        // skipped by the first three and authenticated by GuestGuard.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_GUARD, useClass: GuestGuard },
      ],
    };
  }
}
