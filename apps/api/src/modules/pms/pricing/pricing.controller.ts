import { Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  availabilitySchema,
  type AvailabilityQuery,
  availabilityQuerySchema,
  type CreateRatePlanRequest,
  createRatePlanRequestSchema,
  type QuoteQuery,
  quoteQuerySchema,
  quoteSchema,
  ratePlanSchema,
  type SetRateOverridesRequest,
  setRateOverridesRequestSchema,
  type UpdateRatePlanRequest,
  updateRatePlanRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch, weakEtag } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../../common/zod.js';
import { RatesService } from './rates.service.js';

/** Rate plans and their overrides, stay quotes and availability. */
@ApiTags('pricing')
@Controller('properties/:propertyId')
export class PricingController {
  constructor(private readonly rates: RatesService) {}

  @Get('rate-plans')
  @RequirePermission('rate.read')
  @ZodResponse(200, z.array(ratePlanSchema))
  listRatePlans() {
    return this.rates.list();
  }

  @Post('rate-plans')
  @RequirePermission('rate.manage')
  @HttpCode(201)
  @ZodResponse(201, ratePlanSchema)
  createRatePlan(@ZodBody(createRatePlanRequestSchema) body: CreateRatePlanRequest) {
    return this.rates.create(body);
  }

  @Patch('rate-plans/:ratePlanId')
  @RequirePermission('rate.manage')
  @ZodResponse(200, ratePlanSchema)
  async updateRatePlan(
    @Param('ratePlanId') ratePlanId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateRatePlanRequestSchema) body: UpdateRatePlanRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const plan = await this.rates.update(uuidParam(ratePlanId), parseIfMatch(ifMatch), body);
    reply.header('etag', weakEtag(plan.version));
    return plan;
  }

  @Put('rate-plans/:ratePlanId/overrides')
  @RequirePermission('rate.manage')
  @HttpCode(204)
  async setOverrides(
    @Param('ratePlanId') ratePlanId: string,
    @ZodBody(setRateOverridesRequestSchema) body: SetRateOverridesRequest,
  ) {
    await this.rates.setOverrides(uuidParam(ratePlanId), body);
  }

  @Get('quote')
  @RequirePermission('rate.read')
  @ZodResponse(200, quoteSchema, 'Nightly prices for a prospective stay')
  quote(@ZodQuery(quoteQuerySchema) query: QuoteQuery) {
    return this.rates.quote(query);
  }

  @Get('availability')
  @RequirePermission('reservation.read')
  @ZodResponse(200, availabilitySchema)
  availability(@ZodQuery(availabilityQuerySchema) query: AvailabilityQuery) {
    return this.rates.availability(query);
  }
}
