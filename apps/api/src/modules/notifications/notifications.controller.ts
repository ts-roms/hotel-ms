import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  notificationListQuerySchema,
  type NotificationListQuery,
  notificationListSchema,
} from '@hotel/contracts';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodQuery, ZodResponse } from '../../common/zod.js';
import { NotificationsService } from './notifications.service.js';

/** The member's own in-app notifications (ADR-0024). */
@ApiTags('notifications')
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('property.read', 'any')
  @ZodResponse(200, notificationListSchema)
  list(@ZodQuery(notificationListQuerySchema) query: NotificationListQuery) {
    return this.notifications.list(query);
  }

  @Post('read-all')
  @RequirePermission('property.read', 'any')
  @HttpCode(204)
  async readAll(): Promise<void> {
    await this.notifications.markAllRead();
  }

  @Post(':notificationId/read')
  @RequirePermission('property.read', 'any')
  @HttpCode(204)
  async read(@Param('notificationId') id: string): Promise<void> {
    await this.notifications.markRead(uuidParam(id));
  }
}
