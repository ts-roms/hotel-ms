import { Injectable } from '@nestjs/common';
import type {
  Notification,
  NotificationKind,
  NotificationList,
  NotificationListQuery,
  PermissionCode,
} from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';

export interface NotifyInput {
  membershipIds: (string | null | undefined)[];
  propertyId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string | null;
}

/**
 * In-app notifications (spec §40, ADR-0024). Written in the same transaction as the change
 * they announce, so a notification never describes something that was rolled back. Each
 * member reads only their own.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async notifyInTx(tx: Tx, input: NotifyInput): Promise<void> {
    const recipients = [...new Set(input.membershipIds.filter((m): m is string => !!m))];
    if (recipients.length === 0) return;
    await tx.notification.createMany({
      data: recipients.map((membershipId) => ({
        organizationId: this.cls.get('organizationId')!,
        propertyId: input.propertyId ?? null,
        membershipId,
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: (input.body ?? '').slice(0, 1000),
        link: input.link ?? null,
      })),
    });
  }

  /** Active members holding a permission at a property (or organization-wide). */
  async membersWith(tx: Tx, permission: PermissionCode, propertyId: string): Promise<string[]> {
    const rows = await tx.organizationMembership.findMany({
      where: {
        status: 'ACTIVE',
        roleAssignments: {
          some: {
            OR: [{ scopeType: 'ORGANIZATION' }, { propertyId }],
            role: { permissions: { some: { permissionCode: permission } } },
          },
        },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Reserves a one-time message (e.g. `booking-confirmation:{reservationId}`). False when it
   * was already sent: reruns and retries never send twice.
   */
  async reserveMessage(tx: Tx, dedupeKey: string, channel: 'EMAIL' | 'SMS' | 'IN_APP') {
    const { count } = await tx.messageLog.createMany({
      data: [{ organizationId: this.cls.get('organizationId')!, dedupeKey, channel }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  // ---- The member's own inbox ---------------------------------------------------------------

  private get membershipId(): string {
    const id = this.cls.get('membershipId');
    if (!id) throw Problems.forbidden('Only staff members have notifications.');
    return id;
  }

  async list(query: NotificationListQuery): Promise<NotificationList> {
    const membershipId = this.membershipId;
    return this.db.run(async (tx) => {
      const rows = await tx.notification.findMany({
        where: { membershipId, ...(query.unread ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const unread = await tx.notification.count({ where: { membershipId, readAt: null } });
      return {
        items: rows.map((n): Notification => ({
          id: n.id,
          kind: n.kind as NotificationKind,
          title: n.title,
          body: n.body,
          link: n.link,
          propertyId: n.propertyId,
          createdAt: n.createdAt.toISOString(),
          read: n.readAt !== null,
        })),
        unread,
      };
    });
  }

  async markRead(id: string): Promise<void> {
    const membershipId = this.membershipId;
    await this.db.run(async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { id, membershipId, readAt: null },
        data: { readAt: new Date() },
      });
      if (count === 0 && !(await tx.notification.count({ where: { id, membershipId } })))
        throw Problems.notFound('Notification');
    });
  }

  async markAllRead(): Promise<void> {
    const membershipId = this.membershipId;
    await this.db.run((tx) =>
      tx.notification.updateMany({
        where: { membershipId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
  }
}
