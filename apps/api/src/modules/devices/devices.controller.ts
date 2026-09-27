import { Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  CLOCK_PHOTO_TYPES,
  type ClockPunchQuery,
  clockPunchQuerySchema,
  clockPunchResultSchema,
  type CreateDeviceRequest,
  createDeviceRequestSchema,
  deviceSchema,
  devicePairingSchema,
  type KioskPairRequest,
  kioskPairRequestSchema,
  type KioskSignInRequest,
  kioskSignInRequestSchema,
  kioskStateSchema,
  pinStatusSchema,
  type SetPinRequest,
  setPinRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidParam } from '../../common/params.js';
import { Problems } from '../../common/problem.js';
import { Public, RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/zod.js';
import { TimeClockService } from '../hr/time-clock.service.js';
import { DevicesService } from './devices.service.js';
import { KioskAuth } from './kiosk-auth.js';

/** Managers register, pair and revoke a property's shared devices (ADR-0020). */
@ApiTags('devices')
@Controller('properties/:propertyId/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('device.manage')
  @ZodResponse(200, z.object({ items: z.array(deviceSchema) }))
  async list(@Param('propertyId') propertyId: string) {
    return { items: await this.devices.list(propertyId) };
  }

  @Post()
  @RequirePermission('device.manage')
  @ZodResponse(201, devicePairingSchema)
  create(
    @Param('propertyId') propertyId: string,
    @ZodBody(createDeviceRequestSchema) body: CreateDeviceRequest,
  ) {
    return this.devices.create(propertyId, body);
  }

  @Post(':deviceId/pairing')
  @RequirePermission('device.manage')
  @ZodResponse(201, devicePairingSchema)
  repair(@Param('propertyId') propertyId: string, @Param('deviceId') deviceId: string) {
    return this.devices.repair(propertyId, uuidParam(deviceId));
  }

  @Post(':deviceId/revoke')
  @RequirePermission('device.manage')
  @HttpCode(200)
  @ZodResponse(200, deviceSchema)
  revoke(@Param('propertyId') propertyId: string, @Param('deviceId') deviceId: string) {
    return this.devices.revoke(propertyId, uuidParam(deviceId));
  }
}

/** The member's own PIN for shared devices. */
@ApiTags('devices')
@Controller('me/pin')
export class PinController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, pinStatusSchema)
  status() {
    return this.devices.pinStatus();
  }

  @Put()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, pinStatusSchema)
  set(@ZodBody(setPinRequestSchema) body: SetPinRequest) {
    return this.devices.setPin(body.pin, body.currentPassword);
  }

  @Delete()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, pinStatusSchema)
  remove() {
    return this.devices.removePin();
  }
}

/**
 * The device's own endpoints (kiosk). Public for the staff pipeline: they authenticate
 * with the device cookie (and a pairing code once), checked here.
 */
@ApiTags('devices')
@Controller('kiosk')
export class KioskController {
  constructor(
    private readonly devices: DevicesService,
    private readonly kiosk: KioskAuth,
    private readonly timeClock: TimeClockService,
  ) {}

  private async requireDevice(req: FastifyRequest, csrf: boolean) {
    const device = await this.kiosk.device(req);
    if (!device) throw Problems.unauthenticated();
    if (csrf && !this.kiosk.verifyCsrf(device.tokenHash, req.headers['x-csrf-token']))
      throw Problems.csrf();
    return device;
  }

  @Post('pair')
  @Public()
  @HttpCode(200)
  @ZodResponse(200, kioskStateSchema)
  async pair(
    @ZodBody(kioskPairRequestSchema) body: KioskPairRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { token, device } = await this.devices.pair(body.code);
    // Browsers cap cookie lifetimes (about 400 days); re-pairing renews it.
    const expires = new Date(Date.now() + 400 * 86_400_000);
    reply.setCookie(this.kiosk.deviceCookie, token, this.kiosk.cookieOptions(expires));
    reply.clearCookie(this.kiosk.operatorCookie, { path: '/' });
    return this.devices.state(device, null);
  }

  @Get()
  @Public()
  @ZodResponse(200, kioskStateSchema)
  async state(@Req() req: FastifyRequest) {
    const device = await this.requireDevice(req, false);
    return this.devices.state(device, await this.kiosk.operator(req, device));
  }

  @Post('sign-in')
  @Public()
  @HttpCode(200)
  @ZodResponse(200, kioskStateSchema)
  async signIn(
    @Req() req: FastifyRequest,
    @ZodBody(kioskSignInRequestSchema) body: KioskSignInRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const device = await this.requireDevice(req, true);
    const { token, operator } = await this.devices.signIn(device, body.membershipId, body.pin);
    reply.setCookie(this.kiosk.operatorCookie, token, this.kiosk.cookieOptions(operator.expiresAt));
    return this.devices.state(device, operator);
  }

  @Post('sign-out')
  @Public()
  @HttpCode(200)
  @ZodResponse(200, kioskStateSchema)
  async signOut(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const device = await this.requireDevice(req, true);
    await this.devices.signOut(device, await this.kiosk.operator(req, device));
    reply.clearCookie(this.kiosk.operatorCookie, { path: '/' });
    return this.devices.state(device, null);
  }

  /** Time clock punch (ADR-0022): Employee ID in the query, the selfie as the body. */
  @Post('clock')
  @Public()
  @HttpCode(201)
  @ApiConsumes(...CLOCK_PHOTO_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ZodResponse(201, clockPunchResultSchema)
  async clock(@Req() req: FastifyRequest, @ZodQuery(clockPunchQuerySchema) query: ClockPunchQuery) {
    const device = await this.requireDevice(req, true);
    return this.timeClock.punch(device, query, req.headers['content-type'], req.body);
  }
}
