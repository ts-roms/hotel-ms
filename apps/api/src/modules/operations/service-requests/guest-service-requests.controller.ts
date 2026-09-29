import { Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type GuestCheckoutRequest,
  guestCheckoutRequestSchema,
  type GuestServiceRating,
  guestServiceRatingSchema,
  type GuestServiceRequestCreate,
  guestServiceRequestCreateSchema,
  listOf,
  serviceRequestSchema,
} from '@hotel/contracts';
import { uuidParam } from '../../../common/params.js';
import { GuestRoute } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { ServiceRequestsService } from './service-requests.service.js';

/**
 * The guest's service requests in the guest portal (spec §26): list, create and rate them,
 * and ask for check-out. Verified sessions only (ADR-0033).
 */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute()
export class GuestServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Post('checkout-request')
  @GuestRoute({ verified: true })
  @HttpCode(201)
  @ZodResponse(201, serviceRequestSchema)
  requestCheckout(@ZodBody(guestCheckoutRequestSchema) body: GuestCheckoutRequest) {
    return this.requests.guestRequestCheckout(body);
  }

  @Get('service-requests')
  @GuestRoute({ verified: true })
  @ZodResponse(200, listOf(serviceRequestSchema))
  async listRequests() {
    return { items: await this.requests.guestList() };
  }

  @Post('service-requests')
  @GuestRoute({ verified: true })
  @HttpCode(201)
  @ZodResponse(201, serviceRequestSchema)
  createRequest(@ZodBody(guestServiceRequestCreateSchema) body: GuestServiceRequestCreate) {
    return this.requests.guestCreate(body);
  }

  @Put('service-requests/:requestId/rating')
  @GuestRoute({ verified: true })
  @ZodResponse(200, serviceRequestSchema)
  rate(
    @Param('requestId') requestId: string,
    @ZodBody(guestServiceRatingSchema) body: GuestServiceRating,
  ) {
    return this.requests.guestRate(uuidParam(requestId), body);
  }
}
