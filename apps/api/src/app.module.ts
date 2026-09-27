import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { IdempotencyService } from './common/idempotency.js';
import { ProblemFilter } from './common/problem.filter.js';
import { ENV, type Env } from './config/env.js';
import { PrismaService, TenantDb } from './infrastructure/database.js';
import { RealtimeService } from './infrastructure/realtime.js';
import { CacheRedis, RateLimiter } from './infrastructure/redis.js';
import { NotificationsQueue } from './infrastructure/queue.js';
import { SecretBox } from './infrastructure/secret-box.js';
import { createObjectStorage, OBJECT_STORAGE } from './infrastructure/storage.js';
import { AccessController } from './modules/access/access.controller.js';
import { GrantsService } from './modules/access/grants.service.js';
import { InvitationsService } from './modules/access/invitations.service.js';
import { MembersService } from './modules/access/members.service.js';
import { RolesService } from './modules/access/roles.service.js';
import { AuditController } from './modules/audit/audit.controller.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AuthGuard, PermissionGuard, TenantGuard } from './modules/auth/guards.js';
import { MfaService, SECRET_BOX } from './modules/auth/mfa.service.js';
import { PasswordService } from './modules/auth/password.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { FolioService } from './modules/folio/folio.service.js';
import { FrontOfficeController } from './modules/front-office/front-office.controller.js';
import { FrontOfficeService } from './modules/front-office/front-office.service.js';
import { HousekeepingService } from './modules/front-office/housekeeping.service.js';
import { NightAuditService } from './modules/front-office/night-audit.service.js';
import {
  GuestPortalController,
  GuestServiceController,
} from './modules/guest-portal/guest-portal.controller.js';
import { GuestPortalService } from './modules/guest-portal/guest-portal.service.js';
import { GuestGuard, GuestSessions } from './modules/guest-portal/guest-session.js';
import { FrontDeskKeyProvider, ROOM_ACCESS_PROVIDER } from './modules/guest-portal/room-access.js';
import { ServiceRequestsService } from './modules/guest-portal/service-requests.service.js';
import { AttendanceService } from './modules/hr/attendance.service.js';
import { HrAccess } from './modules/hr/hr-access.js';
import {
  DevicesController,
  KioskController,
  PinController,
} from './modules/devices/devices.controller.js';
import { DevicesService } from './modules/devices/devices.service.js';
import { KioskAuth } from './modules/devices/kiosk-auth.js';
import {
  DocumentRetentionController,
  EmployeeDocumentsController,
} from './modules/hr/documents.controller.js';
import { EmployeeDocumentsService } from './modules/hr/documents.service.js';
import { ClockPhotosController } from './modules/hr/time-clock.controller.js';
import { TimeClockService } from './modules/hr/time-clock.service.js';
import { HrController, MeController, PropertyHrController } from './modules/hr/hr.controller.js';
import { LeaveService } from './modules/hr/leave.service.js';
import { PayrollService } from './modules/hr/payroll.service.js';
import { PeopleService } from './modules/hr/people.service.js';
import { ScheduleService } from './modules/hr/schedule.service.js';
import { FnbController, GuestFnbController } from './modules/fnb/fnb.controller.js';
import { MenuService } from './modules/fnb/menu.service.js';
import { OrdersService } from './modules/fnb/orders.service.js';
import { CashierService } from './modules/payments/cashier.service.js';
import { FinanceSettingsService } from './modules/payments/finance-settings.service.js';
import { DocumentsService } from './modules/payments/documents.service.js';
import {
  FinanceController,
  GuestPaymentsController,
  PaymentWebhooksController,
  SandboxGatewayController,
} from './modules/payments/payments.controller.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  SandboxProvider,
} from './modules/payments/providers.js';
import { ReportsService } from './modules/payments/reports.service.js';
import { TenantJobsProcessor } from './modules/jobs/tenant-jobs.processor.js';
import { OutboxService } from './modules/outbox/outbox.service.js';
import { GuestsService } from './modules/pms/guests.service.js';
import { InventoryController } from './modules/pms/inventory.controller.js';
import { RatesService } from './modules/pms/rates.service.js';
import { GuestsController, ReservationsController } from './modules/pms/reservations.controller.js';
import { ReservationsService } from './modules/pms/reservations.service.js';
import { RoomsService } from './modules/pms/rooms.service.js';
import { OrganizationController } from './modules/tenancy/organization.controller.js';
import { PropertiesController } from './modules/tenancy/properties.controller.js';
import { PropertiesService } from './modules/tenancy/properties.service.js';

/*
 * Phase 0 keeps a single Nest module. Bounded-context modules (blueprint §6) get their own
 * Nest modules with explicit exports as soon as a second context lands.
 */
export const CONTROLLERS = [
  HealthController,
  AuthController,
  OrganizationController,
  PropertiesController,
  AccessController,
  AuditController,
  InventoryController,
  ReservationsController,
  GuestsController,
  FrontOfficeController,
  GuestServiceController,
  GuestPortalController,
  HrController,
  EmployeeDocumentsController,
  DocumentRetentionController,
  ClockPhotosController,
  DevicesController,
  PinController,
  KioskController,
  MeController,
  PropertyHrController,
  FnbController,
  GuestFnbController,
  FinanceController,
  GuestPaymentsController,
  PaymentWebhooksController,
  SandboxGatewayController,
];

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      // The CLS context is entered in a Fastify onRequest hook (see app.factory.ts).
      imports: [ClsModule.forRoot({ global: true })],
      controllers: CONTROLLERS,
      providers: [
        { provide: ENV, useValue: env },
        { provide: SECRET_BOX, useValue: new SecretBox(env.DATA_ENCRYPTION_KEYS) },
        { provide: OBJECT_STORAGE, useValue: createObjectStorage(env) },
        EmployeeDocumentsService,
        KioskAuth,
        DevicesService,
        TimeClockService,
        NotificationsQueue,
        PrismaService,
        TenantDb,
        CacheRedis,
        RateLimiter,
        GrantsService,
        AuditService,
        OutboxService,
        SessionService,
        AuthService,
        PropertiesService,
        MfaService,
        PasswordService,
        MembersService,
        RolesService,
        InvitationsService,
        IdempotencyService,
        RoomsService,
        RatesService,
        GuestsService,
        ReservationsService,
        FolioService,
        FrontOfficeService,
        HousekeepingService,
        NightAuditService,
        GuestSessions,
        GuestPortalService,
        ServiceRequestsService,
        HrAccess,
        PeopleService,
        ScheduleService,
        AttendanceService,
        LeaveService,
        PayrollService,
        RealtimeService,
        MenuService,
        OrdersService,
        PaymentsService,
        CashierService,
        FinanceSettingsService,
        DocumentsService,
        ReportsService,
        TenantJobsProcessor,
        {
          provide: PAYMENT_PROVIDERS,
          useValue: new Map<string, PaymentProvider>(
            env.PAYMENT_SANDBOX_ENABLED ? [['sandbox', new SandboxProvider(env)]] : [],
          ),
        },
        { provide: ROOM_ACCESS_PROVIDER, useClass: FrontDeskKeyProvider },
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
