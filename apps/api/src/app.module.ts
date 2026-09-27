import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { ProblemFilter } from './common/problem.filter.js';
import { ENV, type Env } from './config/env.js';
import { PrismaService, TenantDb } from './infrastructure/database.js';
import { CacheRedis, RateLimiter } from './infrastructure/redis.js';
import { GrantsService } from './modules/access/grants.service.js';
import { AuditController } from './modules/audit/audit.controller.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AuthGuard, PermissionGuard, TenantGuard } from './modules/auth/guards.js';
import { SessionService } from './modules/auth/session.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { OutboxService } from './modules/outbox/outbox.service.js';
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
  AuditController,
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
        { provide: APP_FILTER, useClass: ProblemFilter },
        // Order matters: authenticate → establish tenant → authorize.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}
