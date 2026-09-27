import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/request-context.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { TenantDb } from '../../infrastructure/database.js';
import { Problems } from '../../common/problem.js';

@ApiTags('organization')
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** The caller's active organization. There is deliberately no /organizations/:id. */
  @Get()
  @RequirePermission('organization.read', 'any')
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
