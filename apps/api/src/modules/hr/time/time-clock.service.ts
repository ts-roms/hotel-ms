import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CLOCK_PHOTO_MAX_BYTES,
  CLOCK_PHOTO_TYPES,
  type ClockPhoto,
  type ClockPunchQuery,
  type ClockPunchResult,
  type PhotoRetention,
  type Punch,
  type PunchType,
} from '@hotel/contracts';
import { type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { addDays } from '../../../common/dates.js';
import { ProblemException, Problems } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { matchesType } from '../../../common/uploads.js';
import { fromLocal } from '../../../common/zoned-time.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { RateLimiter } from '../../../infrastructure/redis.js';
import {
  OBJECT_STORAGE,
  ObjectNotFound,
  type ObjectStorage,
} from '../../../infrastructure/storage.js';
import { AuditService } from '../../audit/audit.service.js';
import type { ResolvedDevice } from '../../auth/kiosk-auth.js';
import { AttendanceService, toPunchDto } from './attendance.service.js';
import { PHOTO_RETENTION_KEY, photoRetentionDaysInTx } from './photo-retention.js';
import { activeOn, employeeName, HrAccess } from '../hr-access.js';

const PHOTO_TAGS = { retention: 'attendance-photo' };
/** Selfies are required with every punch, from the web and from time clocks (ADR-0022). */

const unsupported = (detail: string) =>
  new ProblemException(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported photo', detail);

/**
 * Time clock (ADR-0022): a paired TIME_CLOCK device records punches for employees who
 * enter their Employee ID, each with a selfie taken at that moment. Managers review the
 * photos; they are deleted after the organization's retention period (default 90 days).
 */
@Injectable()
export class TimeClockService {
  private readonly logger = new Logger(TimeClockService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly attendance: AttendanceService,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly rateLimiter: RateLimiter,
    private readonly cls: ClsService<RequestContext>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** The selfie must be a real image of an accepted type; returns its content type. */
  private checkPhoto(contentType: string | undefined, body: unknown): string {
    const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(CLOCK_PHOTO_TYPES as readonly string[]).includes(type))
      throw unsupported('Send the selfie as a JPEG, PNG or WebP image.');
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw Problems.validation([{ path: 'body', message: 'The selfie is missing' }]);
    if (body.length > CLOCK_PHOTO_MAX_BYTES)
      throw new ProblemException(413, 'VALIDATION_FAILED', 'Photo too large', 'At most 2 MiB.');
    if (!matchesType(body, type as (typeof CLOCK_PHOTO_TYPES)[number]))
      throw unsupported(`The photo is not a ${type} image.`);
    return type;
  }

  /**
   * Stores the selfie, then records the punch and its photo in one transaction. A refused
   * punch (e.g. "not clocked in") takes its photo with it.
   */
  private async recordWithPhoto(input: {
    employeeId: string;
    propertyId: string;
    type: PunchType;
    source: 'WEB' | 'KIOSK';
    recordedBy: string | null;
    deviceId: string | null;
    contentType: string;
    body: Buffer;
  }) {
    const organizationId = this.cls.get('organizationId')!;
    const storageKey = `${organizationId}/attendance-photos/${uuidv7()}`;
    const sha256 = createHash('sha256').update(input.body).digest('hex');
    await this.storage.put(storageKey, input.body, input.contentType, sha256, {
      tags: PHOTO_TAGS,
    });
    try {
      return await this.db.run(async (tx) => {
        const punch = await this.attendance.punchInTx(tx, {
          employeeId: input.employeeId,
          propertyId: input.propertyId,
          type: input.type,
          source: input.source,
          recordedBy: input.recordedBy,
        });
        await tx.attendancePhoto.create({
          data: {
            punchId: punch.id,
            organizationId,
            deviceId: input.deviceId,
            storageKey,
            contentType: input.contentType,
            sizeBytes: input.body.length,
            sha256,
          },
        });
        await this.audit.record(tx, {
          action: input.source === 'KIOSK' ? 'attendance.clock_punch' : 'attendance.web_punch',
          entityType: 'employee',
          entityId: input.employeeId,
          propertyId: input.propertyId,
          after: { punchId: punch.id, type: input.type, photoSha256: sha256 },
        });
        return punch;
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Web punch from the employee's own session: a selfie is required here too. */
  async webPunch(
    propertyId: string,
    type: PunchType,
    contentType: string | undefined,
    body: unknown,
  ): Promise<Punch> {
    const photoType = this.checkPhoto(contentType, body);
    const employeeId = await this.db.run(async (tx) => {
      const me = await this.access.myEmployee(tx);
      const property = await this.access.property(tx, propertyId);
      const assigned = await tx.employmentAssignment.count({
        where: { employeeId: me.id, propertyId, ...activeOn(property.today) },
      });
      if (!assigned) throw Problems.forbidden('You are not assigned to this property today.');
      return me.id;
    });
    const punch = await this.recordWithPhoto({
      employeeId,
      propertyId,
      type,
      source: 'WEB',
      recordedBy: this.access.actorId,
      deviceId: null,
      contentType: photoType,
      body: body as Buffer,
    });
    return toPunchDto(punch);
  }

  /** Time clock punch: Employee ID and a selfie, on a paired TIME_CLOCK device. */
  async punch(
    device: ResolvedDevice,
    query: ClockPunchQuery,
    contentType: string | undefined,
    body: unknown,
  ): Promise<ClockPunchResult> {
    if (device.kind !== 'TIME_CLOCK') throw Problems.forbidden('This device is not a time clock.');
    // Enough for a shift change at the door; not enough to try Employee IDs at will.
    await this.rateLimiter.consume(`clock:${device.id}`, 60, 5 * 60, { failClosed: true });
    const photoType = this.checkPhoto(contentType, body);

    // The device's organization and property; audited as SYSTEM with the device id.
    this.cls.set('organizationId', device.organizationId);
    this.cls.set('propertyId', device.propertyId);
    this.cls.set('system', true);
    this.cls.set('device', {
      id: device.id,
      propertyId: device.propertyId,
      permissions: [],
      operatorSessionId: '',
    });

    const employee = await this.db.run(async (tx) => {
      const found = await tx.employee.findFirst({
        where: {
          employeeNo: { equals: query.employeeNo, mode: 'insensitive' },
          status: 'ACTIVE',
        },
      });
      if (!found) throw Problems.notFound('Employee ID');
      const property = await this.access.property(tx, device.propertyId);
      const assigned = await tx.employmentAssignment.count({
        where: { employeeId: found.id, propertyId: device.propertyId, ...activeOn(property.today) },
      });
      if (!assigned) throw Problems.forbidden('You are not assigned to this property today.');
      return found;
    });

    const punch = await this.recordWithPhoto({
      employeeId: employee.id,
      propertyId: device.propertyId,
      type: query.type,
      source: 'KIOSK',
      recordedBy: null,
      deviceId: device.id,
      contentType: photoType,
      body: body as Buffer,
    });
    return {
      employeeName: employee.preferredName || employee.firstName,
      type: punch.type,
      at: punch.at.toISOString(),
    };
  }

  // ---- Review (staff) ----------------------------------------------------------------------

  async photos(propertyId: string, from: string, to: string): Promise<ClockPhoto[]> {
    return this.db.run(async (tx) => {
      const property = await this.access.property(tx, propertyId);
      const rows = await tx.attendancePhoto.findMany({
        where: {
          deletedAt: null,
          punch: {
            propertyId,
            at: {
              gte: fromLocal(from, '00:00', property.timezone),
              lt: fromLocal(addDays(to, 1), '00:00', property.timezone),
            },
          },
        },
        include: {
          punch: { include: { employee: true } },
          device: { select: { name: true } },
        },
        orderBy: { punch: { at: 'desc' } },
        take: 500,
      });
      return rows.map((r) => ({
        punchId: r.punchId,
        employeeId: r.punch.employeeId,
        employeeNo: r.punch.employee.employeeNo,
        employeeName: employeeName(r.punch.employee),
        type: r.punch.type,
        at: r.punch.at.toISOString(),
        deviceName: r.device?.name ?? null,
        source: r.punch.source === 'KIOSK' ? ('KIOSK' as const) : ('WEB' as const),
      }));
    });
  }

  /** Opens one selfie; every view is audited. */
  async openPhoto(
    propertyId: string,
    punchId: string,
  ): Promise<{ contentType: string; sizeBytes: number; stream: Readable }> {
    const photo = await this.db.run(async (tx) => {
      const photo = await tx.attendancePhoto.findFirst({
        where: { punchId, deletedAt: null, punch: { propertyId } },
        include: { punch: { select: { employeeId: true } } },
      });
      if (!photo) throw Problems.notFound('Photo');
      await this.audit.record(tx, {
        action: 'attendance.photo_viewed',
        entityType: 'employee',
        entityId: photo.punch.employeeId,
        propertyId,
        after: { punchId },
      });
      return photo;
    });
    try {
      return {
        contentType: photo.contentType,
        sizeBytes: photo.sizeBytes,
        stream: await this.storage.get(photo.storageKey),
      };
    } catch (error) {
      if (error instanceof ObjectNotFound) throw Problems.notFound('Photo');
      throw error;
    }
  }

  /** Days selfies are kept in the current organization. */
  private retentionDaysInTx(tx: Tx): Promise<number> {
    return photoRetentionDaysInTx(tx, this.cls.get('organizationId')!);
  }

  async retention(): Promise<PhotoRetention> {
    return this.db.run(async (tx) => ({ days: await this.retentionDaysInTx(tx) }));
  }

  /** Shorter periods apply at the next daily run, to photos already taken too. */
  async setRetention(input: PhotoRetention): Promise<PhotoRetention> {
    return this.db.run(async (tx) => {
      const before = await this.retentionDaysInTx(tx);
      const organizationId = this.cls.get('organizationId')!;
      const updatedBy = this.cls.get('identityId') ?? null;
      const value = { days: input.days };
      await tx.organizationSetting.upsert({
        where: { organizationId_key: { organizationId, key: PHOTO_RETENTION_KEY } },
        create: { organizationId, key: PHOTO_RETENTION_KEY, value, updatedBy },
        update: { value, updatedBy },
      });
      await this.audit.record(tx, {
        action: 'organization.photo_retention_changed',
        entityType: 'organization',
        entityId: organizationId,
        before: { days: before },
        after: { days: input.days },
      });
      return { days: input.days };
    });
  }

  /** Daily job: selfies older than the organization's retention period are deleted. */
  async purgePhotos(now = new Date()): Promise<number> {
    const due = await this.db.run(async (tx) => {
      const days = await this.retentionDaysInTx(tx);
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const rows = await tx.attendancePhoto.findMany({
        where: { deletedAt: null, createdAt: { lt: cutoff } },
        select: { punchId: true, storageKey: true },
        take: 1000,
      });
      if (rows.length > 0) {
        await tx.attendancePhoto.updateMany({
          where: { punchId: { in: rows.map((r) => r.punchId) } },
          data: { deletedAt: now },
        });
      }
      return rows;
    });
    for (const r of due) {
      await this.storage.delete(r.storageKey).catch((error: unknown) => {
        this.logger.error(`Could not delete clock photo ${r.punchId}: ${String(error)}`);
      });
    }
    return due.length;
  }
}
