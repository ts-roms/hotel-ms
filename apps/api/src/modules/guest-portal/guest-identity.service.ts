import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GUEST_ID_FILE_TYPES,
  GUEST_ID_MAX_BYTES,
  type GuestIdType,
  type GuestStay,
  type IdentityDocument,
  type IdentityDocumentListQuery,
  type IdentityReview,
  type UploadGuestIdQuery,
} from '@hotel/contracts';
import { type Prisma, type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate } from '../../common/dates.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { RateLimiter } from '../../infrastructure/redis.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../infrastructure/storage.js';
import { AuditService } from '../audit/audit.service.js';
import { matchesType } from '../hr/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { invalidState } from '../pms/reservations.service.js';
import { GuestInboxService } from './guest-inbox.service.js';

/** ID files are deleted this many days after the stay's departure date (ADR-0027). */
export const GUEST_ID_RETENTION_DAYS = 30;

const unsupported = (detail: string) =>
  new ProblemException(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported file', detail);

const include = {
  reservationRoom: {
    select: {
      reservationId: true,
      arrivalDate: true,
      departureDate: true,
      status: true,
      reservation: { select: { confirmationNo: true } },
    },
  },
  guest: { select: { firstName: true, lastName: true } },
} satisfies Prisma.GuestIdentityDocumentInclude;
type Row = Prisma.GuestIdentityDocumentGetPayload<{ include: typeof include }>;

const TYPE_LABEL: Record<GuestIdType, string> = {
  PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's license",
  NATIONAL_ID: 'National ID',
  OTHER: 'Other ID',
};

/**
 * Guest IDs (spec §22, §24; ADR-0027). A verified guest uploads a photo or scan of an ID for
 * their stay; the front desk approves or rejects it. A property can require an approved ID
 * before self check-in. Files are private (tenant-scoped storage keys, opened only through
 * the API with the sensitive guest.identity.review permission, every view audited) and are
 * deleted after the stay; the review record remains.
 */
@Injectable()
export class GuestIdentityService {
  private readonly logger = new Logger(GuestIdentityService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly inbox: NotificationsService,
    private readonly guestInbox: GuestInboxService,
    private readonly rateLimiter: RateLimiter,
    private readonly cls: ClsService<RequestContext>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ---- Guest ------------------------------------------------------------------------------

  /** The latest current (not superseded) ID of a stay, as the guest sees it. */
  async summaryInTx(tx: Tx, reservationRoomId: string): Promise<GuestStay['identity']> {
    const doc = await tx.guestIdentityDocument.findFirst({
      where: { reservationRoomId, status: { not: 'SUPERSEDED' } },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!doc) return null;
    return {
      documentType: doc.documentType as GuestIdType,
      status: doc.status as 'PENDING' | 'APPROVED' | 'REJECTED',
      rejectionReason: doc.rejectionReason,
      uploadedAt: doc.uploadedAt.toISOString(),
    };
  }

  async approvedInTx(tx: Tx, reservationRoomId: string): Promise<boolean> {
    return (
      (await tx.guestIdentityDocument.count({
        where: { reservationRoomId, status: 'APPROVED' },
      })) > 0
    );
  }

  async upload(
    contentType: string | undefined,
    body: unknown,
    query: UploadGuestIdQuery,
  ): Promise<GuestStay['identity']> {
    const guest = this.cls.get('guest')!;
    const organizationId = this.cls.get('organizationId')!;
    const propertyId = this.cls.get('propertyId')!;
    const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(GUEST_ID_FILE_TYPES as readonly string[]).includes(type))
      throw unsupported('Upload a photo (JPEG, PNG, WebP) or a PDF of your ID.');
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw Problems.validation([{ path: 'body', message: 'The file is empty' }]);
    if (body.length > GUEST_ID_MAX_BYTES)
      throw new ProblemException(413, 'VALIDATION_FAILED', 'File too large', 'At most 8 MiB.');
    if (!matchesType(body, type as (typeof GUEST_ID_FILE_TYPES)[number]))
      throw unsupported(`The file's content is not a ${type} file.`);
    await this.rateLimiter.consume(`guest-id-upload:${guest.sessionId}`, 5, 60 * 60, {
      failClosed: true,
    });

    const check = async (tx: Tx) => {
      const line = await tx.reservationRoom.findUniqueOrThrow({
        where: { id: guest.reservationRoomId },
      });
      if (line.status !== 'RESERVED' && line.status !== 'IN_HOUSE')
        throw invalidState('IDs can be uploaded before arrival and during the stay.');
      if (await this.approvedInTx(tx, line.id)) throw invalidState('Your ID is already approved.');
      return line;
    };
    await this.db.run(check);

    const id = uuidv7();
    const storageKey = `${organizationId}/guest-ids/${id}`;
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.storage.put(storageKey, body, type, sha256);

    let superseded: string[] = [];
    try {
      const summary = await this.db.run(async (tx) => {
        const line = await check(tx);
        // Earlier pending or rejected uploads are replaced; their files go at once.
        const older = await tx.guestIdentityDocument.findMany({
          where: { reservationRoomId: line.id, status: { in: ['PENDING', 'REJECTED'] } },
          select: { id: true, storageKey: true },
        });
        if (older.length > 0) {
          await tx.guestIdentityDocument.updateMany({
            where: { id: { in: older.map((o) => o.id) } },
            data: { status: 'SUPERSEDED', purgedAt: new Date(), version: { increment: 1 } },
          });
        }
        superseded = older.map((o) => o.storageKey);
        await tx.guestIdentityDocument.create({
          data: {
            id,
            organizationId,
            propertyId,
            reservationRoomId: line.id,
            guestId: guest.guestId,
            documentType: query.documentType,
            contentType: type,
            sizeBytes: body.length,
            sha256,
            storageKey,
          },
        });
        await this.inbox.notifyInTx(tx, {
          membershipIds: await this.inbox.membersWith(tx, 'guest.identity.review', propertyId),
          propertyId,
          kind: 'GUEST_ID_SUBMITTED',
          title: 'Guest ID to review',
          body: `${TYPE_LABEL[query.documentType]} · arriving ${fromDbDate(line.arrivalDate)}`,
          link: `/p/${propertyId}/id-review`,
        });
        await this.audit.record(tx, {
          action: 'guest.identity_uploaded',
          entityType: 'reservation',
          entityId: line.reservationId,
          propertyId,
          after: {
            documentId: id,
            documentType: query.documentType,
            sizeBytes: body.length,
            sha256,
          },
        });
        await this.outbox.enqueue(
          tx,
          'GuestIdentitySubmitted',
          { documentId: id, reservationRoomId: line.id },
          { propertyId },
        );
        return this.summaryInTx(tx, line.id);
      });
      await this.deleteFiles(superseded);
      return summary;
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  // ---- Staff ------------------------------------------------------------------------------

  private async toDto(tx: Tx, r: Row): Promise<IdentityDocument> {
    const reviewer = r.reviewedBy
      ? await tx.identity.findUnique({ where: { id: r.reviewedBy }, select: { displayName: true } })
      : null;
    return {
      id: r.id,
      reservationId: r.reservationRoom.reservationId,
      reservationRoomId: r.reservationRoomId,
      confirmationNo: r.reservationRoom.reservation.confirmationNo,
      guestName: `${r.guest.firstName} ${r.guest.lastName}`,
      arrivalDate: fromDbDate(r.reservationRoom.arrivalDate),
      departureDate: fromDbDate(r.reservationRoom.departureDate),
      stayStatus: r.reservationRoom.status,
      documentType: r.documentType as GuestIdType,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      status: r.status as IdentityDocument['status'],
      rejectionReason: r.rejectionReason,
      uploadedAt: r.uploadedAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewerName: reviewer?.displayName ?? null,
      purged: r.purgedAt !== null,
      version: r.version,
    };
  }

  async list(propertyId: string, query: IdentityDocumentListQuery): Promise<IdentityDocument[]> {
    return this.db.run(async (tx) => {
      const rows = await tx.guestIdentityDocument.findMany({
        where: {
          propertyId,
          ...(query.status === 'ALL'
            ? { status: { not: 'SUPERSEDED' } }
            : { status: query.status }),
        },
        include,
        // The review queue oldest first; history newest first.
        orderBy: { uploadedAt: query.status === 'PENDING' ? 'asc' : 'desc' },
        take: 200,
      });
      return Promise.all(rows.map((r) => this.toDto(tx, r)));
    });
  }

  private async requireRow(tx: Tx, propertyId: string, id: string): Promise<Row> {
    const row = await tx.guestIdentityDocument.findFirst({
      where: { id, propertyId },
      include,
    });
    if (!row) throw Problems.notFound('Guest ID');
    return row;
  }

  /** The file, for review; every view is audited. */
  async open(
    propertyId: string,
    id: string,
  ): Promise<{ contentType: string; sizeBytes: number; stream: Readable }> {
    const row = await this.db.run(async (tx) => {
      const row = await this.requireRow(tx, propertyId, id);
      if (row.purgedAt)
        throw new ProblemException(
          410,
          'NOT_FOUND',
          'File deleted',
          'The ID file was deleted after the stay.',
        );
      await this.audit.record(tx, {
        action: 'guest.identity_viewed',
        entityType: 'reservation',
        entityId: row.reservationRoom.reservationId,
        propertyId,
        after: { documentId: id },
      });
      return row;
    });
    return {
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      stream: await this.storage.get(row.storageKey),
    };
  }

  async review(
    propertyId: string,
    id: string,
    expectedVersion: number,
    input: IdentityReview,
  ): Promise<IdentityDocument> {
    return this.db.run(async (tx) => {
      const current = await this.requireRow(tx, propertyId, id);
      if (current.version !== expectedVersion) throw Problems.versionConflict();
      if (current.status !== 'PENDING') throw invalidState('This ID was already reviewed.');
      const approve = input.decision === 'APPROVE';
      const { count } = await tx.guestIdentityDocument.updateMany({
        where: { id, version: expectedVersion, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          rejectionReason: approve ? null : input.reason,
          reviewedAt: new Date(),
          reviewedBy: this.cls.get('identityId') ?? null,
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw Problems.versionConflict();
      await this.guestInbox.notifyInTx(tx, {
        reservationRoomId: current.reservationRoomId,
        propertyId,
        kind: 'IDENTITY',
        title: approve ? 'Your ID is approved' : 'Please upload your ID again',
        body: approve ? '' : input.reason,
      });
      await this.audit.record(tx, {
        action: approve ? 'guest.identity_approved' : 'guest.identity_rejected',
        entityType: 'reservation',
        entityId: current.reservationRoom.reservationId,
        propertyId,
        after: { documentId: id, reason: approve ? undefined : input.reason },
      });
      await this.outbox.enqueue(
        tx,
        'GuestIdentityReviewed',
        { documentId: id, decision: input.decision },
        { propertyId },
      );
      return this.toDto(tx, await this.requireRow(tx, propertyId, id));
    });
  }

  /**
   * Retention (daily organization job): deletes the files of stays that departed more than
   * GUEST_ID_RETENTION_DAYS ago. The row stays, marked purged, as the review record.
   */
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - GUEST_ID_RETENTION_DAYS * 86_400_000);
    const due = await this.db.run(async (tx) => {
      const rows = await tx.guestIdentityDocument.findMany({
        where: { purgedAt: null, reservationRoom: { departureDate: { lt: cutoff } } },
        select: { id: true, storageKey: true },
        take: 1000,
      });
      if (rows.length > 0) {
        await tx.guestIdentityDocument.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { purgedAt: now, version: { increment: 1 } },
        });
      }
      return rows;
    });
    await this.deleteFiles(due.map((r) => r.storageKey));
    return due.length;
  }

  private async deleteFiles(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage.delete(key).catch((error: unknown) => {
        this.logger.error(`Could not delete guest ID file ${key}: ${String(error)}`);
      });
    }
  }
}
