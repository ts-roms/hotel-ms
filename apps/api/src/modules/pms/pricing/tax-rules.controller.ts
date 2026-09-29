import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateTaxRuleRequest,
  createTaxRuleRequestSchema,
  taxRuleSchema,
} from '@hotel/contracts';
import { z } from 'zod';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { TaxRulesService } from './tax-rules.service.js';

/** The property's tax rules, applied by the tax engine when charges are posted. */
@ApiTags('pricing')
@Controller('properties/:propertyId')
export class TaxRulesController {
  constructor(private readonly taxes: TaxRulesService) {}

  @Get('tax-rules')
  @RequirePermission('folio.read')
  @ZodResponse(200, z.array(taxRuleSchema))
  taxRules() {
    return this.taxes.listTaxRules();
  }

  @Post('tax-rules')
  @RequirePermission('tax.manage')
  @HttpCode(201)
  @ZodResponse(201, taxRuleSchema)
  createTaxRule(@ZodBody(createTaxRuleRequestSchema) body: CreateTaxRuleRequest) {
    return this.taxes.createTaxRule(body);
  }

  @Post('tax-rules/:taxRuleId/archive')
  @RequirePermission('tax.manage')
  @HttpCode(204)
  async archiveTaxRule(@Param('taxRuleId') taxRuleId: string) {
    await this.taxes.archiveTaxRule(uuidParam(taxRuleId));
  }
}
