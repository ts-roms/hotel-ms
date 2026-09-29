import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CancelOrderRequest,
  cancelOrderRequestSchema,
  type CreateCategoryRequest,
  createCategoryRequestSchema,
  type CreateMenuItemRequest,
  createMenuItemRequestSchema,
  type CreateOutletRequest,
  createOutletRequestSchema,
  menuItemSchema,
  menuSchema,
  type OrderListQuery,
  orderListQuerySchema,
  orderSchema,
  type OrderTransitionRequest,
  orderTransitionRequestSchema,
  outletSchema,
  type SetAvailabilityRequest,
  setAvailabilityRequestSchema,
  type StaffOrderRequest,
  staffOrderRequestSchema,
  type UpdateMenuItemRequest,
  updateMenuItemRequestSchema,
  type UpdateOutletRequest,
  updateOutletRequestSchema,
  listOf,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { parseIfMatch } from '../../common/etag.js';
import { IdempotencyService, idempotencyKeyHeader } from '../idempotency/idempotency.service.js';
import { uuidParam } from '../../common/params.js';
import type { RequestContext } from '../../common/request-context.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { TenantDb } from '../../infrastructure/database.js';
import { RealtimeService } from '../../infrastructure/realtime.js';
import { MenuService } from './menu.service.js';
import { OrdersService } from './orders.service.js';

const HEARTBEAT_MS = 25_000;

@ApiTags('f&b')
@Controller('properties/:propertyId')
export class FnbController {
  constructor(
    private readonly menus: MenuService,
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeService,
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  // ---- Outlets and menus -------------------------------------------------------------------

  @Get('outlets')
  @RequirePermission('fnb.order.read')
  @ZodResponse(200, listOf(outletSchema))
  async outlets(@Param('propertyId') propertyId: string) {
    return { items: await this.menus.outlets(propertyId) };
  }

  @Post('outlets')
  @RequirePermission('fnb.menu.manage')
  @ZodResponse(201, outletSchema)
  createOutlet(
    @Param('propertyId') propertyId: string,
    @ZodBody(createOutletRequestSchema) body: CreateOutletRequest,
  ) {
    return this.menus.createOutlet(propertyId, body);
  }

  @Patch('outlets/:outletId')
  @RequirePermission('fnb.menu.manage')
  @ZodResponse(200, outletSchema)
  updateOutlet(
    @Param('propertyId') propertyId: string,
    @Param('outletId') outletId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateOutletRequestSchema) body: UpdateOutletRequest,
  ) {
    return this.menus.updateOutlet(propertyId, uuidParam(outletId), parseIfMatch(ifMatch), body);
  }

  @Get('outlets/:outletId/menu')
  @RequirePermission('fnb.order.read')
  @ZodResponse(200, menuSchema)
  menu(@Param('propertyId') propertyId: string, @Param('outletId') outletId: string) {
    return this.menus.menu(propertyId, uuidParam(outletId));
  }

  @Post('outlets/:outletId/menu/categories')
  @RequirePermission('fnb.menu.manage')
  @ZodResponse(201, menuSchema)
  createCategory(
    @Param('propertyId') propertyId: string,
    @Param('outletId') outletId: string,
    @ZodBody(createCategoryRequestSchema) body: CreateCategoryRequest,
  ) {
    return this.menus.createCategory(propertyId, uuidParam(outletId), body);
  }

  @Post('outlets/:outletId/menu/items')
  @RequirePermission('fnb.menu.manage')
  @ZodResponse(201, menuItemSchema)
  createItem(
    @Param('propertyId') propertyId: string,
    @Param('outletId') outletId: string,
    @ZodBody(createMenuItemRequestSchema) body: CreateMenuItemRequest,
  ) {
    return this.menus.createItem(propertyId, uuidParam(outletId), body);
  }

  @Patch('menu-items/:itemId')
  @RequirePermission('fnb.menu.manage')
  @ZodResponse(200, menuItemSchema)
  updateItem(
    @Param('propertyId') propertyId: string,
    @Param('itemId') itemId: string,
    @ZodBody(updateMenuItemRequestSchema) body: UpdateMenuItemRequest,
  ) {
    return this.menus.updateItem(propertyId, uuidParam(itemId), body);
  }

  @Put('menu-items/:itemId/availability')
  @RequirePermission('fnb.menu.availability')
  @ZodResponse(200, menuItemSchema)
  setAvailability(
    @Param('propertyId') propertyId: string,
    @Param('itemId') itemId: string,
    @ZodBody(setAvailabilityRequestSchema) body: SetAvailabilityRequest,
  ) {
    return this.menus.setAvailability(propertyId, uuidParam(itemId), body.available);
  }

  // ---- Orders ------------------------------------------------------------------------------

  @Get('orders')
  @RequirePermission('fnb.order.read')
  @ZodResponse(200, listOf(orderSchema))
  async list(
    @Param('propertyId') propertyId: string,
    @ZodQuery(orderListQuerySchema) query: OrderListQuery,
  ) {
    return { items: await this.orders.list(propertyId, query) };
  }

  @Post('orders')
  @RequirePermission('fnb.order.create')
  @idempotencyKeyHeader
  @ZodResponse(201, orderSchema)
  async place(
    @Param('propertyId') propertyId: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(staffOrderRequestSchema) body: StaffOrderRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.run(
      'order.place',
      key,
      { propertyId, ...body },
      async () => ({
        status: 201,
        body: await this.orders.staffPlace(propertyId, body),
      }),
    );
    if (result.replayed) reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  @Get('orders/:orderId')
  @RequirePermission('fnb.order.read')
  @ZodResponse(200, orderSchema)
  get(@Param('propertyId') propertyId: string, @Param('orderId') orderId: string) {
    return this.orders.get(propertyId, uuidParam(orderId));
  }

  @Post('orders/:orderId/status')
  @RequirePermission('fnb.order.update')
  @HttpCode(200)
  @ZodResponse(200, orderSchema)
  transition(
    @Param('propertyId') propertyId: string,
    @Param('orderId') orderId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(orderTransitionRequestSchema) body: OrderTransitionRequest,
  ) {
    return this.orders.transition(
      propertyId,
      uuidParam(orderId),
      parseIfMatch(ifMatch),
      body.status,
    );
  }

  @Post('orders/:orderId/cancel')
  @RequirePermission('fnb.order.update')
  @HttpCode(200)
  @ZodResponse(200, orderSchema)
  cancel(
    @Param('propertyId') propertyId: string,
    @Param('orderId') orderId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(cancelOrderRequestSchema) body: CancelOrderRequest,
  ) {
    const canOverride = this.cls
      .get('grants')!
      .hasForProperty('fnb.order.cancel_override', propertyId);
    return this.orders.cancel(
      propertyId,
      uuidParam(orderId),
      parseIfMatch(ifMatch),
      body.reason,
      canOverride,
    );
  }

  /**
   * Kitchen display stream (Server-Sent Events): one `order` event per change at the
   * outlet. The payload names the order only; the board refetches what it shows.
   */
  @Get('outlets/:outletId/orders/stream')
  @RequirePermission('fnb.order.read')
  async stream(
    @Param('propertyId') propertyId: string,
    @Param('outletId') outletId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const outlet = await this.db.run((tx) =>
      this.menus.requireOutlet(tx, propertyId, uuidParam(outletId)),
    );
    const channel = RealtimeService.channel(
      this.cls.get('organizationId')!,
      `fnb:outlet:${outlet.id}`,
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 3000\n: connected\n\n');
    const unsubscribe = await this.realtime.subscribe(channel, (message) => {
      reply.raw.write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
