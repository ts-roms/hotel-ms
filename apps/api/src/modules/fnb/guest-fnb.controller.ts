import { Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type GuestOrderRequest,
  guestOrderRequestSchema,
  menuSchema,
  orderSchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { IdempotencyService, idempotencyKeyHeader } from '../../common/idempotency.js';
import { uuidParam } from '../../common/params.js';
import { GuestRoute } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { OrdersService } from './orders.service.js';

/** Room service in the guest portal (behind the guest_food_ordering flag). */
@ApiTags('guest portal')
@Controller('guest')
@GuestRoute({ verified: true })
export class GuestFnbController {
  constructor(
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('menus')
  @GuestRoute()
  @ZodResponse(200, listOf(menuSchema))
  async menus() {
    return { items: await this.orders.guestMenus() };
  }

  @Get('orders')
  @ZodResponse(200, listOf(orderSchema))
  async list() {
    return { items: await this.orders.guestOrders() };
  }

  @Post('orders')
  @idempotencyKeyHeader
  @ZodResponse(201, orderSchema)
  async place(
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(guestOrderRequestSchema) body: GuestOrderRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.run('guest.order.place', key, body, async () => ({
      status: 201,
      body: await this.orders.guestPlace(body),
    }));
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  @ZodResponse(200, orderSchema)
  cancel(@Param('orderId') orderId: string) {
    return this.orders.guestCancel(uuidParam(orderId));
  }
}
