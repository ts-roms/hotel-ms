import { Injectable } from '@nestjs/common';
import type { GuestNotification, GuestNotificationKind, StaffGuestMessage } from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * The guest portal's notification feed (ADR-0027): one per stay (reservation line), written
 * in the same transaction as the change it reports: request and order progress, the ID
 * review, checkout, and messages from the front desk.
 */
@Injectable()
export class GuestInboxService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async notifyInTx(
    tx: Tx,
    input: {
      reservationRoomId: string;
      propertyId: string;
      kind: GuestNotificationKind;
      title: string;
      body?: string;
    },
  ): Promise<void> {
    await tx.guestNotification.create({
      data: {
        organizationId: this.cls.get('organizationId')!,
        propertyId: input.propertyId,
        reservationRoomId: input.reservationRoomId,
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: (input.body ?? '').slice(0, 1000),
        createdBy: this.cls.get('identityId') ?? null,
      },
    });
  }

  unreadInTx(tx: Tx, reservationRoomId: string): Promise<number> {
    return tx.guestNotification.count({ where: { reservationRoomId, readAt: null } });
  }

  // ---- Guest ------------------------------------------------------------------------------

  private get lineId() {
    return this.cls.get('guest')!.reservationRoomId;
  }

  async list(): Promise<GuestNotification[]> {
    const rows = await this.db.run((tx) =>
      tx.guestNotification.findMany({
        where: { reservationRoomId: this.lineId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    );
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind as GuestNotificationKind,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      read: n.readAt !== null,
    }));
  }

  async markAllRead(): Promise<void> {
    await this.db.run((tx) =>
      tx.guestNotification.updateMany({
        where: { reservationRoomId: this.lineId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
  }

  // ---- Staff ------------------------------------------------------------------------------

  /** A message from the front desk to a guest's portal (booked or in house). */
  async staffMessage(
    reservationId: string,
    lineId: string,
    input: StaffGuestMessage,
  ): Promise<void> {
    const propertyId = this.cls.get('propertyId')!;
    await this.db.run(async (tx) => {
      const line = await tx.reservationRoom.findFirst({
        where: { id: lineId, reservationId, propertyId },
      });
      if (!line) throw Problems.notFound('Reservation room');
      if (line.status !== 'RESERVED' && line.status !== 'IN_HOUSE')
        throw Problems.conflict('Messages go to upcoming and in-house guests only.');
      await this.notifyInTx(tx, {
        reservationRoomId: lineId,
        propertyId,
        kind: 'MESSAGE',
        title: input.title,
        body: input.body,
      });
      await this.audit.record(tx, {
        action: 'guest.message_sent',
        entityType: 'reservation',
        entityId: reservationId,
        propertyId,
        after: { reservationRoomId: lineId, title: input.title },
      });
    });
  }
}
