import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { birthdaySchema, listOf } from '@hotel/contracts';
import { RequirePermission } from '../../../common/route-metadata.js';
import { ZodResponse } from '../../../common/zod.js';
import { PeopleService } from './people.service.js';

/** Upcoming birthdays of the property's staff. */
@ApiTags('hr: property')
@Controller('properties/:propertyId')
export class BirthdaysController {
  constructor(private readonly people: PeopleService) {}

  @Get('birthdays')
  @RequirePermission('birthday.read')
  @ZodResponse(200, listOf(birthdaySchema))
  async birthdays(@Param('propertyId') propertyId: string) {
    return { items: await this.people.birthdays(propertyId) };
  }
}
