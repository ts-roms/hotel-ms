import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  cashierShiftSchema,
  type CloseShiftRequest,
  closeShiftRequestSchema,
  currentCashierShiftSchema,
  listOf,
  type OpenShiftRequest,
  openShiftRequestSchema,
} from '@hotel/contracts';
import { IfMatch, parseIfMatch } from '../../../common/etag.js';
import { uuidParam } from '../../../common/params.js';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../../common/zod.js';
import { CashierService } from './cashier.service.js';

/** Cashier shifts: the caller's drawer, opening float, count at close, shift history. */
@ApiTags('finance')
@Controller('properties/:propertyId')
export class CashierController {
  constructor(private readonly cashier: CashierService) {}

  @Get('cashier/shift')
  @RequirePermission('cashier.shift')
  @ZodResponse(200, currentCashierShiftSchema)
  async currentShift(@Param('propertyId') propertyId: string) {
    return { shift: await this.cashier.current(propertyId) };
  }

  @Post('cashier/shift')
  @RequirePermission('cashier.shift')
  @ZodResponse(201, cashierShiftSchema)
  openShift(
    @Param('propertyId') propertyId: string,
    @ZodBody(openShiftRequestSchema) body: OpenShiftRequest,
  ) {
    return this.cashier.open(propertyId, body.openingFloatMinor);
  }

  @Post('cashier/shifts/:shiftId/close')
  @RequirePermission('cashier.shift')
  @HttpCode(200)
  @ZodResponse(200, cashierShiftSchema)
  closeShift(
    @Param('propertyId') propertyId: string,
    @Param('shiftId') shiftId: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(closeShiftRequestSchema) body: CloseShiftRequest,
  ) {
    return this.cashier.close(
      propertyId,
      uuidParam(shiftId),
      parseIfMatch(ifMatch),
      body.countedCashMinor,
      body.notes,
    );
  }

  @Get('cashier/shifts')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, listOf(cashierShiftSchema))
  async shifts(@Param('propertyId') propertyId: string) {
    return { items: await this.cashier.list(propertyId) };
  }
}
