import { Injectable } from '@nestjs/common';
import {
  type GuestHotelInfo,
  type GuestPortalSettings,
  guestPortalSettingsSchema,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';

export const GUEST_PORTAL_SETTINGS_KEY = 'guest_portal';

/** The property's guest portal settings (property_settings "guest_portal"), with defaults. */
export async function guestPortalSettingsInTx(
  tx: Tx,
  propertyId: string,
): Promise<GuestPortalSettings> {
  const row = await tx.propertySetting.findFirst({
    where: { propertyId, key: GUEST_PORTAL_SETTINGS_KEY },
  });
  // Stored values were validated on write; anything unreadable falls back to defaults.
  const parsed = guestPortalSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : guestPortalSettingsSchema.parse({});
}

/**
 * Hotel information for guests and the self check-in ID rule (ADR-0027). Staff with
 * property.settings.manage edit it; guests read it in the portal.
 */
@Injectable()
export class GuestInfoService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  settings(propertyId: string): Promise<GuestPortalSettings> {
    return this.db.run((tx) => guestPortalSettingsInTx(tx, propertyId));
  }

  async updateSettings(
    propertyId: string,
    settings: GuestPortalSettings,
  ): Promise<GuestPortalSettings> {
    return this.db.run(async (tx) => {
      const before = await guestPortalSettingsInTx(tx, propertyId);
      const organizationId = this.cls.get('organizationId')!;
      const updatedBy = this.cls.get('identityId') ?? null;
      const value = { ...settings } as Prisma.InputJsonValue;
      await tx.propertySetting.upsert({
        where: {
          organizationId_propertyId_key: {
            organizationId,
            propertyId,
            key: GUEST_PORTAL_SETTINGS_KEY,
          },
        },
        create: { organizationId, propertyId, key: GUEST_PORTAL_SETTINGS_KEY, value, updatedBy },
        update: { value, updatedBy },
      });
      // The Wi-Fi password is not written to the audit log.
      const redact = (s: GuestPortalSettings) => ({
        ...s,
        wifiPassword: s.wifiPassword ? '***' : '',
      });
      await this.audit.record(tx, {
        action: 'property.guest_portal_settings_changed',
        entityType: 'property',
        entityId: propertyId,
        propertyId,
        before: redact(before),
        after: redact(settings),
      });
      return settings;
    });
  }

  /** What the current guest sees; the Wi-Fi only once verified and in house. */
  async hotelInfo(): Promise<GuestHotelInfo> {
    const guest = this.cls.get('guest')!;
    return this.db.run(async (tx) => {
      const line = await tx.reservationRoom.findUniqueOrThrow({
        where: { id: guest.reservationRoomId },
        select: { status: true, propertyId: true },
      });
      const p = await tx.property.findUniqueOrThrow({ where: { id: line.propertyId } });
      const s = await guestPortalSettingsInTx(tx, line.propertyId);
      const images = await tx.propertyImage.findMany({
        where: { propertyId: line.propertyId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, caption: true, sha256: true },
      });
      const showWifi = guest.verified && line.status === 'IN_HOUSE' && s.wifiName !== '';
      return {
        name: p.name,
        address: [p.addressLine1, p.addressLine2, p.city, p.region, p.postalCode]
          .filter(Boolean)
          .join(', '),
        phone: p.phone,
        email: p.email,
        checkInTime: p.checkInTime,
        checkOutTime: p.checkOutTime,
        about: s.about,
        wifi: showWifi ? { name: s.wifiName, password: s.wifiPassword } : null,
        amenities: s.amenities,
        services: s.services,
        houseRules: s.houseRules,
        images: images.map((i) => ({
          id: i.id,
          caption: i.caption,
          version: i.sha256.slice(0, 16),
        })),
      };
    });
  }
}
