import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CreateDiscountProfileRequest,
  createDiscountProfileRequestSchema,
  discountProfileSchema,
  exchangeRateSchema,
  listOf,
  type SetExchangeRateRequest,
  setExchangeRateRequestSchema,
} from '@hotel/contracts';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { FinanceSettingsService } from './finance-settings.service.js';

/** Foreign-cash exchange rates and statutory discount profiles of a property. */
@ApiTags('finance')
@Controller('properties/:propertyId')
export class FinanceSettingsController {
  constructor(private readonly settings: FinanceSettingsService) {}

  @Get('exchange-rates')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(exchangeRateSchema))
  async exchangeRates(@Param('propertyId') propertyId: string) {
    return { items: await this.settings.exchangeRates(propertyId) };
  }

  @Post('exchange-rates')
  @RequirePermission('exchange_rate.manage')
  @ZodResponse(201, exchangeRateSchema)
  setExchangeRate(
    @Param('propertyId') propertyId: string,
    @ZodBody(setExchangeRateRequestSchema) body: SetExchangeRateRequest,
  ) {
    return this.settings.setExchangeRate(propertyId, body);
  }

  @Get('discount-profiles')
  @RequirePermission('folio.read')
  @ZodResponse(200, listOf(discountProfileSchema))
  async discountProfiles(@Param('propertyId') propertyId: string) {
    return { items: await this.settings.discountProfiles(propertyId) };
  }

  @Post('discount-profiles')
  @RequirePermission('tax.manage')
  @ZodResponse(201, discountProfileSchema)
  createDiscountProfile(
    @Param('propertyId') propertyId: string,
    @ZodBody(createDiscountProfileRequestSchema) body: CreateDiscountProfileRequest,
  ) {
    return this.settings.createDiscountProfile(propertyId, body);
  }

  @Post('discount-profiles/:profileId/archive')
  @RequirePermission('tax.manage')
  @HttpCode(204)
  async archiveDiscountProfile(
    @Param('propertyId') propertyId: string,
    @Param('profileId') profileId: string,
  ): Promise<void> {
    await this.settings.archiveDiscountProfile(propertyId, uuidParam(profileId));
  }
}
