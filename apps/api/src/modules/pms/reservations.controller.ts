import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  type AssignRoomRequest,
  assignRoomRequestSchema,
  type CancelRequest,
  cancelRequestSchema,
  type CreateGuestRequest,
  createGuestRequestSchema,
  type CreateReservationRequest,
  createReservationRequestSchema,
  cursorPage,
  guestSchema,
  type GuestSearchQuery,
  guestSearchQuerySchema,
  type ReservationListQuery,
  reservationListQuerySchema,
  reservationSchema,
  type UpdateGuestRequest,
  updateGuestRequestSchema,
  type UpdateReservationRoomRequest,
  updateReservationRoomRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseIfMatch, weakEtag } from '../../common/etag.js';
import { IdempotencyService } from '../../common/idempotency.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { GuestsService } from './guests.service.js';
import { ReservationsService } from './reservations.service.js';

@ApiTags('reservations')
@Controller('properties/:propertyId/reservations')
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequirePermission('reservation.read')
  @ZodResponse(200, cursorPage(reservationSchema))
  list(@ZodQuery(reservationListQuerySchema) query: ReservationListQuery) {
    return this.reservations.list(query);
  }

  @Post()
  @RequirePermission('reservation.create')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique per attempt; retries reuse it',
  })
  @ZodResponse(201, reservationSchema)
  async create(
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(createReservationRequestSchema) body: CreateReservationRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.run('reservation.create', key, body, async () => ({
      status: 201,
      body: await this.reservations.create(body),
    }));
    reply.status(result.status);
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  @Get(':reservationId')
  @RequirePermission('reservation.read')
  @ZodResponse(200, reservationSchema)
  get(@Param('reservationId') reservationId: string) {
    return this.reservations.get(uuidParam(reservationId));
  }

  @Patch(':reservationId/rooms/:lineId')
  @RequirePermission('reservation.update')
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Version of the reservation room (W/"n")',
  })
  @ZodResponse(200, reservationSchema)
  async updateLine(
    @Param('reservationId') reservationId: string,
    @Param('lineId') lineId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateReservationRoomRequestSchema) body: UpdateReservationRoomRequest,
  ) {
    return this.reservations.updateLine(
      uuidParam(reservationId),
      uuidParam(lineId),
      parseIfMatch(ifMatch),
      body,
    );
  }

  @Put(':reservationId/rooms/:lineId/assignment')
  @RequirePermission('reservation.update')
  @ZodResponse(200, reservationSchema)
  assign(
    @Param('reservationId') reservationId: string,
    @Param('lineId') lineId: string,
    @ZodBody(assignRoomRequestSchema) body: AssignRoomRequest,
  ) {
    return this.reservations.assign(uuidParam(reservationId), uuidParam(lineId), body.roomId);
  }

  @Delete(':reservationId/rooms/:lineId/assignment')
  @RequirePermission('reservation.update')
  @ZodResponse(200, reservationSchema)
  unassign(@Param('reservationId') reservationId: string, @Param('lineId') lineId: string) {
    return this.reservations.unassign(uuidParam(reservationId), uuidParam(lineId));
  }

  @Post(':reservationId/cancel')
  @RequirePermission('reservation.cancel')
  @HttpCode(200)
  @ZodResponse(200, reservationSchema)
  cancel(
    @Param('reservationId') reservationId: string,
    @ZodBody(cancelRequestSchema) body: CancelRequest,
  ) {
    return this.reservations.cancel(uuidParam(reservationId), body.reason);
  }

  @Post(':reservationId/rooms/:lineId/cancel')
  @RequirePermission('reservation.cancel')
  @HttpCode(200)
  @ZodResponse(200, reservationSchema)
  cancelLine(
    @Param('reservationId') reservationId: string,
    @Param('lineId') lineId: string,
    @ZodBody(cancelRequestSchema) body: CancelRequest,
  ) {
    return this.reservations.cancel(uuidParam(reservationId), body.reason, uuidParam(lineId));
  }
}

/** Guest profiles are organization-wide; creation is attributed to a property. */
@ApiTags('guests')
@Controller()
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Get('guests')
  @RequirePermission('guest.read', 'any')
  @ZodResponse(200, z.array(guestSchema))
  search(@ZodQuery(guestSearchQuerySchema) query: GuestSearchQuery) {
    return this.guests.search(query);
  }

  @Get('guests/:guestId')
  @RequirePermission('guest.read', 'any')
  @ZodResponse(200, guestSchema)
  async get(@Param('guestId') guestId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const guest = await this.guests.get(uuidParam(guestId));
    reply.header('etag', weakEtag(guest.version));
    return guest;
  }

  @Post('properties/:propertyId/guests')
  @RequirePermission('guest.update')
  @HttpCode(201)
  @ZodResponse(201, guestSchema)
  create(@ZodBody(createGuestRequestSchema) body: CreateGuestRequest) {
    return this.guests.create(body);
  }

  @Patch('guests/:guestId')
  @RequirePermission('guest.update', 'any')
  @ZodResponse(200, guestSchema)
  async update(
    @Param('guestId') guestId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateGuestRequestSchema) body: UpdateGuestRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const guest = await this.guests.update(uuidParam(guestId), parseIfMatch(ifMatch), body);
    reply.header('etag', weakEtag(guest.version));
    return guest;
  }
}
