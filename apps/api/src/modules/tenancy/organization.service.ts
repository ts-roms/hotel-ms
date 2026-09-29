import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';

/** The caller's active organization (Tenancy). */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async current() {
    const org = await this.db.run((tx) =>
      tx.organization.findUnique({ where: { id: this.cls.get('organizationId')! } }),
    );
    if (!org) throw Problems.notFound('Organization');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      defaultLocale: org.defaultLocale,
      defaultCurrency: org.defaultCurrency,
      defaultTimezone: org.defaultTimezone,
    };
  }
}
