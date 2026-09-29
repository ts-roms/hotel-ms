import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  organizationDashboardSchema,
  type SearchQuery,
  searchQuerySchema,
  searchResultSchema,
} from '@hotel/contracts';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodQuery, ZodResponse } from '../../common/zod.js';
import { ManagementService } from './management.service.js';
import { SearchService } from './search.service.js';

/** Organization-level views (ADR-0025). */
@ApiTags('management')
@Controller()
export class ManagementController {
  constructor(
    private readonly management: ManagementService,
    private readonly searchService: SearchService,
  ) {}

  /** Group overview: every property the caller can see, sections by permission. */
  @Get('dashboard')
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, organizationDashboardSchema)
  organization() {
    return this.management.organizationDashboard();
  }

  @Get('search')
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, searchResultSchema)
  search(@ZodQuery(searchQuerySchema) query: SearchQuery) {
    return this.searchService.search(query.q);
  }
}
