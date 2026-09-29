import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { birthdaySchema, listOf } from '@hotel/contracts';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodResponse } from '../../../common/zod.js';
import { BirthdaysService } from './birthdays.service.js';

/** Upcoming birthdays of the property's staff. */
@ApiTags('hr: property')
@Controller('properties/:propertyId')
export class BirthdaysController {
  constructor(private readonly birthdaysService: BirthdaysService) {}

  @Get('birthdays')
  @RequirePermission('birthday.read')
  @ZodResponse(200, listOf(birthdaySchema))
  async birthdays(@Param('propertyId') propertyId: string) {
    return { items: await this.birthdaysService.birthdays(propertyId) };
  }
}
