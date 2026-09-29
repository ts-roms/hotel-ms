import type { Tx } from '@hotel/database';
import type { OutboxService } from '../../outbox/outbox.service.js';

type HousekeepingStatus = 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED';
type TaskType = 'CHECKOUT_CLEAN' | 'STAYOVER' | 'TOUCH_UP' | 'INSPECTION';

/**
 * Changes a room's housekeeping status with its history row and event, inside the
 * caller's transaction. No-op when the status is unchanged.
 */
export async function recordRoomStatus(
  tx: Tx,
  input: {
    organizationId: string;
    propertyId: string;
    roomId: string;
    to: HousekeepingStatus;
    reason: string | null;
    actorId: string | null;
  },
  outbox: OutboxService,
): Promise<void> {
  const room = await tx.room.findUniqueOrThrow({ where: { id: input.roomId } });
  if (room.housekeepingStatus === input.to) return;
  await tx.room.update({
    where: { id: input.roomId },
    data: { housekeepingStatus: input.to, version: { increment: 1 } },
  });
  await tx.roomStatusEvent.create({
    data: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      roomId: input.roomId,
      dimension: 'HOUSEKEEPING',
      fromValue: room.housekeepingStatus,
      toValue: input.to,
      reason: input.reason,
      actorId: input.actorId,
    },
  });
  await outbox.enqueue(
    tx,
    'RoomStatusChanged',
    {
      roomId: input.roomId,
      dimension: 'HOUSEKEEPING',
      from: room.housekeepingStatus,
      to: input.to,
    },
    { propertyId: input.propertyId },
  );
}

/**
 * Creates a housekeeping task unless an open one of the same type exists for the room.
 * Checks first instead of relying on the unique index, because a constraint error would
 * abort the surrounding transaction.
 */
export async function ensureHousekeepingTask(
  tx: Tx,
  input: {
    organizationId: string;
    propertyId: string;
    roomId: string;
    type: TaskType;
    businessDate: Date;
    actorId: string | null;
  },
): Promise<void> {
  const open = await tx.housekeepingTask.findFirst({
    where: { roomId: input.roomId, type: input.type, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  });
  if (open) return;
  await tx.housekeepingTask.create({
    data: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      roomId: input.roomId,
      type: input.type,
      businessDate: input.businessDate,
      createdBy: input.actorId,
    },
  });
}
