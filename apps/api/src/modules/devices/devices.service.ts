import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type CreateDeviceRequest,
  DEVICE_PERMISSIONS,
  type Device,
  type DevicePairing,
  type KioskState,
} from '@hotel/contracts';
import { hashPassword, type Prisma, type Tx, verifyPassword } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { newToken, sha256 } from '../../common/crypto.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { PrismaService, TenantDb } from '../../infrastructure/database.js';
import { RateLimiter } from '../../infrastructure/redis.js';
import { AuditService } from '../audit/audit.service.js';
import { photoRetentionDaysInTx } from '../hr/time/photo-retention.js';
import {
  KioskAuth,
  OPERATOR_MAX_MS,
  type ResolvedDevice,
  type ResolvedOperator,
} from '../auth/kiosk-auth.js';

const PAIRING_TTL_MS = 15 * 60_000;
/** No 0/O, 1/I/L: codes are read off one screen and typed on another. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60_000;

type DeviceRow = Prisma.DeviceGetPayload<object>;

function toDeviceDto(d: DeviceRow): Device {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind as Device['kind'],
    permissions: d.permissions as Device['permissions'],
    status: d.revokedAt ? 'REVOKED' : d.tokenHash ? 'PAIRED' : 'PENDING',
    pairingExpiresAt: d.pairingExpiresAt?.toISOString() ?? null,
    pairedAt: d.pairedAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

const pairingCode = () =>
  Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const wrongPin = () =>
  new ProblemException(401, 'INVALID_CREDENTIALS', 'Wrong PIN', 'Check your PIN and try again.');

/**
 * Shared devices and staff PINs (ADR-0020). Managers register a device and pair it with a
 * one-time code; staff sign in on it with their PIN; the device reaches only its property,
 * with only its permissions, and only as far as the operator's own grants go.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly kiosk: KioskAuth,
    private readonly audit: AuditService,
    private readonly rateLimiter: RateLimiter,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  // ---- Management (staff) ------------------------------------------------------------------

  async list(propertyId: string): Promise<Device[]> {
    const rows = await this.db.run((tx) =>
      tx.device.findMany({ where: { propertyId }, orderBy: { createdAt: 'asc' } }),
    );
    return rows.map(toDeviceDto);
  }

  private async openPairing(
    tx: Tx,
    device: DeviceRow,
  ): Promise<{ row: DeviceRow; code: string; expiresAt: Date }> {
    const code = pairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    // A new pairing replaces the old token: whoever held it is signed out for good.
    const row = await tx.device.update({
      where: { id: device.id },
      data: {
        pairingCodeHash: sha256(code),
        pairingExpiresAt: expiresAt,
        tokenHash: null,
        pairedAt: null,
      },
    });
    await tx.deviceSession.updateMany({
      where: { deviceId: device.id, endedAt: null },
      data: { endedAt: new Date() },
    });
    return { row, code, expiresAt };
  }

  async create(propertyId: string, input: CreateDeviceRequest): Promise<DevicePairing> {
    return this.db.run(async (tx) => {
      const created = await tx.device.create({
        data: {
          organizationId: this.cls.get('organizationId')!,
          propertyId,
          name: input.name,
          kind: input.kind,
          permissions: [...new Set(input.permissions)],
          createdBy: this.cls.get('identityId') ?? null,
        },
      });
      const { row, code, expiresAt } = await this.openPairing(tx, created);
      await this.audit.record(tx, {
        action: 'device.created',
        entityType: 'device',
        entityId: row.id,
        propertyId,
        after: { name: input.name, kind: input.kind, permissions: input.permissions },
      });
      return { device: toDeviceDto(row), pairingCode: code, expiresAt: expiresAt.toISOString() };
    });
  }

  private async requireDevice(tx: Tx, propertyId: string, deviceId: string) {
    const device = await tx.device.findFirst({ where: { id: deviceId, propertyId } });
    if (!device) throw Problems.notFound('Device');
    return device;
  }

  /** A fresh pairing code (e.g. a replaced tablet); the old pairing stops working. */
  async repair(propertyId: string, deviceId: string): Promise<DevicePairing> {
    return this.db.run(async (tx) => {
      const device = await this.requireDevice(tx, propertyId, deviceId);
      if (device.revokedAt) throw Problems.conflict('This device was revoked. Register a new one.');
      const { row, code, expiresAt } = await this.openPairing(tx, device);
      await this.audit.record(tx, {
        action: 'device.pairing_opened',
        entityType: 'device',
        entityId: deviceId,
        propertyId,
      });
      return { device: toDeviceDto(row), pairingCode: code, expiresAt: expiresAt.toISOString() };
    });
  }

  async revoke(propertyId: string, deviceId: string): Promise<Device> {
    return this.db.run(async (tx) => {
      const device = await this.requireDevice(tx, propertyId, deviceId);
      if (device.revokedAt) return toDeviceDto(device);
      const row = await tx.device.update({
        where: { id: deviceId },
        data: {
          revokedAt: new Date(),
          tokenHash: null,
          pairingCodeHash: null,
          pairingExpiresAt: null,
        },
      });
      await tx.deviceSession.updateMany({
        where: { deviceId, endedAt: null },
        data: { endedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'device.revoked',
        entityType: 'device',
        entityId: deviceId,
        propertyId,
      });
      return toDeviceDto(row);
    });
  }

  // ---- Staff PINs (the member's own) -------------------------------------------------------

  async pinStatus(): Promise<{ hasPin: boolean }> {
    const membershipId = this.cls.get('membershipId')!;
    const pin = await this.db.run((tx) => tx.staffPin.findUnique({ where: { membershipId } }));
    return { hasPin: pin !== null };
  }

  async setPin(pin: string, currentPassword: string): Promise<{ hasPin: boolean }> {
    const identityId = this.cls.get('identityId')!;
    const membershipId = this.cls.get('membershipId')!;
    await this.rateLimiter.consume(`pin-set:${identityId}`, 5, 15 * 60);
    const identity = await this.prisma.platform.identity.findUniqueOrThrow({
      where: { id: identityId },
      include: { credential: true },
    });
    if (
      !identity.credential ||
      !(await verifyPassword(identity.credential.passwordHash, currentPassword))
    ) {
      throw Problems.validation([
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
      throw Problems.validation([{ path: 'pin', message: 'Choose a PIN that is harder to guess' }]);
    }
    const pinHash = await hashPassword(pin);
    await this.db.run(async (tx) => {
      await tx.staffPin.upsert({
        where: { membershipId },
        create: { membershipId, organizationId: this.cls.get('organizationId')!, pinHash },
        update: { pinHash, failedAttempts: 0, lockedUntil: null },
      });
      // A changed PIN ends every device session signed in with the old one.
      await tx.deviceSession.updateMany({
        where: { membershipId, endedAt: null },
        data: { endedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'member.pin_set',
        entityType: 'membership',
        entityId: membershipId,
      });
    });
    return { hasPin: true };
  }

  async removePin(): Promise<{ hasPin: boolean }> {
    const membershipId = this.cls.get('membershipId')!;
    await this.db.run(async (tx) => {
      await tx.staffPin.deleteMany({ where: { membershipId } });
      await tx.deviceSession.updateMany({
        where: { membershipId, endedAt: null },
        data: { endedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'member.pin_removed',
        entityType: 'membership',
        entityId: membershipId,
      });
    });
    return { hasPin: false };
  }

  // ---- The device (kiosk) ------------------------------------------------------------------

  /** Runs as the device, in its organization, audited with its id and no member actor. */
  private asDevice<T>(device: ResolvedDevice, fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.cls.set('organizationId', device.organizationId);
    this.cls.set('system', true);
    this.cls.set('device', {
      id: device.id,
      propertyId: device.propertyId,
      permissions: device.permissions,
      operatorSessionId: '',
    });
    return this.db.run(fn);
  }

  /** Exchanges a one-time pairing code for the device token (returned for the cookie). */
  async pair(code: string): Promise<{ token: string; device: ResolvedDevice }> {
    await this.rateLimiter.consume(`kiosk-pair:${this.cls.get('ip') ?? 'unknown'}`, 10, 15 * 60, {
      failClosed: true,
    });
    const codeHash = sha256(code);
    const found = await this.db.runWithDeviceToken(codeHash, (tx) =>
      tx.device.findUnique({ where: { pairingCodeHash: codeHash } }),
    );
    if (
      !found ||
      found.revokedAt ||
      !found.pairingExpiresAt ||
      found.pairingExpiresAt <= new Date()
    )
      throw Problems.invalidToken();
    const token = newToken();
    const tokenHash = sha256(token);
    const device: ResolvedDevice = {
      id: found.id,
      organizationId: found.organizationId,
      propertyId: found.propertyId,
      name: found.name,
      kind: found.kind as ResolvedDevice['kind'],
      permissions: found.permissions,
      tokenHash,
    };
    await this.asDevice(device, async (tx) => {
      // Single use: only the row still holding this code is updated.
      const { count } = await tx.device.updateMany({
        where: { id: found.id, pairingCodeHash: codeHash, revokedAt: null },
        data: {
          tokenHash,
          pairingCodeHash: null,
          pairingExpiresAt: null,
          pairedAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
      if (count !== 1) throw Problems.invalidToken();
      await this.audit.record(tx, {
        action: 'device.paired',
        entityType: 'device',
        entityId: found.id,
        propertyId: found.propertyId,
      });
    });
    return { token, device };
  }

  /** Members who may sign in here: a PIN, and one of the device's permissions here. */
  private async operators(tx: Tx, device: ResolvedDevice) {
    const members = await tx.organizationMembership.findMany({
      where: {
        status: 'ACTIVE',
        staffPin: { isNot: null },
        roleAssignments: {
          some: {
            OR: [{ scopeType: 'ORGANIZATION' }, { propertyId: device.propertyId }],
            role: { permissions: { some: { permissionCode: { in: device.permissions } } } },
          },
        },
      },
      select: { id: true, identity: { select: { displayName: true } } },
    });
    return members
      .map((m) => ({ membershipId: m.id, name: m.identity.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async state(device: ResolvedDevice, operator: ResolvedOperator | null): Promise<KioskState> {
    return this.db.runWithTrustedContext(
      { organizationId: device.organizationId, identityId: null },
      async (tx) => {
        const property = await tx.property.findUniqueOrThrow({
          where: { id: device.propertyId },
          select: { name: true },
        });
        const operators = await this.operators(tx, device);
        const current = operator
          ? await tx.organizationMembership.findUniqueOrThrow({
              where: { id: operator.membershipId },
              select: { identity: { select: { displayName: true } } },
            })
          : null;
        return {
          device: {
            id: device.id,
            name: device.name,
            propertyId: device.propertyId,
            propertyName: property.name,
            kind: device.kind,
            permissions: device.permissions.filter((p): p is (typeof DEVICE_PERMISSIONS)[number] =>
              (DEVICE_PERMISSIONS as readonly string[]).includes(p),
            ),
          },
          operator:
            operator && current
              ? {
                  membershipId: operator.membershipId,
                  name: current.identity.displayName,
                  expiresAt: operator.expiresAt.toISOString(),
                }
              : null,
          operators,
          photoRetentionDays: await photoRetentionDaysInTx(tx, device.organizationId),
          csrfToken: this.kiosk.csrfTokenFor(device.tokenHash),
        };
      },
    );
  }

  /**
   * PIN sign-in on a device. Wrong PINs count per member (locked after 5) and per device
   * (rate limit), so neither a person nor a tablet can be used to guess.
   */
  async signIn(
    device: ResolvedDevice,
    membershipId: string,
    pin: string,
  ): Promise<{ token: string; operator: ResolvedOperator }> {
    await this.rateLimiter.consume(`kiosk-pin:${device.id}`, 20, 5 * 60, { failClosed: true });
    const staffPin = await this.asDevice(device, async (tx) => {
      const operators = await this.operators(tx, device);
      if (!operators.some((o) => o.membershipId === membershipId)) throw wrongPin();
      return tx.staffPin.findUniqueOrThrow({ where: { membershipId } });
    });
    if (staffPin.lockedUntil && staffPin.lockedUntil > new Date()) {
      throw new ProblemException(
        423,
        'ACCOUNT_LOCKED',
        'PIN locked',
        'Too many wrong PINs. Try again later, or ask a manager.',
      );
    }
    const ok = await verifyPassword(staffPin.pinHash, pin);
    return this.asDevice(device, async (tx) => {
      if (!ok) {
        const failures = staffPin.failedAttempts + 1;
        const locked = failures >= MAX_PIN_FAILURES;
        await tx.staffPin.update({
          where: { membershipId },
          data: {
            failedAttempts: locked ? 0 : failures,
            lockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MS) : staffPin.lockedUntil,
          },
        });
        await this.audit.record(tx, {
          action: locked ? 'device.pin_locked' : 'device.pin_failed',
          entityType: 'membership',
          entityId: membershipId,
          propertyId: device.propertyId,
        });
        return null;
      }
      await tx.staffPin.update({
        where: { membershipId },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      // One operator at a time per device.
      await tx.deviceSession.updateMany({
        where: { deviceId: device.id, endedAt: null },
        data: { endedAt: new Date() },
      });
      const token = newToken();
      const session = await tx.deviceSession.create({
        data: {
          organizationId: device.organizationId,
          deviceId: device.id,
          membershipId,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + OPERATOR_MAX_MS),
        },
        include: { membership: { select: { identityId: true } } },
      });
      await this.audit.record(tx, {
        action: 'device.operator_signed_in',
        entityType: 'membership',
        entityId: membershipId,
        propertyId: device.propertyId,
      });
      return {
        token,
        operator: {
          sessionId: session.id,
          membershipId,
          identityId: session.membership.identityId,
          expiresAt: session.expiresAt,
        },
      };
    }).then((result) => {
      if (!result) throw wrongPin();
      return result;
    });
  }

  async signOut(device: ResolvedDevice, operator: ResolvedOperator | null): Promise<void> {
    if (!operator) return;
    await this.asDevice(device, async (tx) => {
      await tx.deviceSession.update({
        where: { id: operator.sessionId },
        data: { endedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'device.operator_signed_out',
        entityType: 'membership',
        entityId: operator.membershipId,
        propertyId: device.propertyId,
      });
    });
  }
}
