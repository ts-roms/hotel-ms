import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CLOCK_PHOTO_MAX_BYTES,
  CLOCK_PHOTO_TYPES,
  type ClockPhoto,
  type ClockPunchQuery,
  type ClockPunchResult,
} from '@hotel/contracts';
import { uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { addDays } from '../../common/dates.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { fromLocal } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { RateLimiter } from '../../infrastructure/redis.js';
import {
  OBJECT_STORAGE,
  ObjectNotFound,
  type ObjectStorage,
} from '../../infrastructure/storage.js';
import { AuditService } from '../audit/audit.service.js';
import type { ResolvedDevice } from '../devices/kiosk-auth.js';
import { AttendanceService } from './attendance.service.js';
import { matchesType } from './documents.service.js';
import { activeOn, employeeName, HrAccess } from './hr-access.js';

/** Selfies are kept this long, then deleted (the punch itself stays). */
export const CLOCK_PHOTO_DAYS = 90;
const PHOTO_TAGS = { retention: 'attendance-photo' };

const unsupported = (detail: string) =>
  new ProblemException(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported photo', detail);

/**
 * Time clock (ADR-0022): a paired TIME_CLOCK device records punches for employees who
 * enter their Employee ID, each with a selfie taken at that moment. Managers review the
 * photos; they are deleted after CLOCK_PHOTO_DAYS.
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

  async punch(
    device: ResolvedDevice,
    query: ClockPunchQuery,
    contentType: string | undefined,
    body: unknown,
  ): Promise<ClockPunchResult> {
    if (device.kind !== 'TIME_CLOCK') throw Problems.forbidden('This device is not a time clock.');
    // Enough for a shift change at the door; not enough to try Employee IDs at will.
    await this.rateLimiter.consume(`clock:${device.id}`, 60, 5 * 60, { failClosed: true });
    const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(CLOCK_PHOTO_TYPES as readonly string[]).includes(type))
      throw unsupported('Send the selfie as a JPEG, PNG or WebP image.');
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw Problems.validation([{ path: 'body', message: 'The selfie is missing' }]);
    if (body.length > CLOCK_PHOTO_MAX_BYTES)
      throw new ProblemException(413, 'VALIDATION_FAILED', 'Photo too large', 'At most 2 MiB.');
    if (!matchesType(body, type as (typeof CLOCK_PHOTO_TYPES)[number]))
      throw unsupported(`The photo is not a ${type} image.`);

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

    const photoId = uuidv7();
    const storageKey = `${device.organizationId}/attendance-photos/${photoId}`;
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.storage.put(storageKey, body, type, sha256, { tags: PHOTO_TAGS });
    try {
      const punch = await this.db.run(async (tx) => {
        const punch = await this.attendance.punchInTx(tx, {
          employeeId: employee.id,
          propertyId: device.propertyId,
          type: query.type,
          source: 'KIOSK',
          recordedBy: null,
        });
        await tx.attendancePhoto.create({
          data: {
            punchId: punch.id,
            organizationId: device.organizationId,
            deviceId: device.id,
            storageKey,
            contentType: type,
            sizeBytes: body.length,
            sha256,
          },
        });
        await this.audit.record(tx, {
          action: 'attendance.clock_punch',
          entityType: 'employee',
          entityId: employee.id,
          propertyId: device.propertyId,
          after: { punchId: punch.id, type: query.type, photoSha256: sha256 },
        });
        return punch;
      });
      return {
        employeeName: employee.preferredName || employee.firstName,
        type: punch.type,
        at: punch.at.toISOString(),
      };
    } catch (error) {
      // No punch, no photo.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
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

  /** Daily job: selfies older than CLOCK_PHOTO_DAYS are deleted. */
  async purgePhotos(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - CLOCK_PHOTO_DAYS * 86_400_000);
    const due = await this.db.run(async (tx) => {
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
