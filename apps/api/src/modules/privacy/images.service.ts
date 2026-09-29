import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IMAGE_MAX_PER_PROPERTY,
  type PropertyImage,
  type UpdatePropertyImageRequest,
} from '@hotel/contracts';
import { uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { invalidState, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { processImage } from '../../infrastructure/images.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../infrastructure/storage.js';
import { AuditService } from '../audit/audit.service.js';
import { MenuService } from '../fnb/menu.service.js';

/**
 * Hotel photos for the guest portal and menu item photos (spec §16, §27; ADR-0030). Files
 * live in tenant-scoped object storage and are served through the API: to staff of the
 * property, and to guests of that property only.
 */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly menus: MenuService,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      actorId: this.cls.get('identityId') ?? null,
    };
  }

  /** The property of the current guest session. */
  guestPropertyId(): string {
    return this.cls.get('propertyId')!;
  }

  // ---- Hotel photos --------------------------------------------------------------------

  async list(propertyId: string): Promise<PropertyImage[]> {
    const rows = await this.db.run((tx) =>
      tx.propertyImage.findMany({
        where: { propertyId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      caption: r.caption,
      sortOrder: r.sortOrder,
      width: r.width,
      height: r.height,
      version: r.sha256.slice(0, 16),
    }));
  }

  async upload(
    propertyId: string,
    contentType: string | undefined,
    body: unknown,
    caption: string,
  ): Promise<PropertyImage[]> {
    const image = await processImage(contentType, body);
    const { organizationId, actorId } = this.ctx;
    const count = await this.db.run((tx) => tx.propertyImage.count({ where: { propertyId } }));
    if (count >= IMAGE_MAX_PER_PROPERTY)
      throw invalidState(`At most ${IMAGE_MAX_PER_PROPERTY} photos per property.`);
    const id = uuidv7();
    const storageKey = `${organizationId}/property-images/${id}`;
    await this.storage.put(storageKey, image.body, 'image/webp', image.sha256);
    try {
      await this.db.run(async (tx) => {
        const last = await tx.propertyImage.findFirst({
          where: { propertyId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        await tx.propertyImage.create({
          data: {
            id,
            organizationId,
            propertyId,
            storageKey,
            sha256: image.sha256,
            width: image.width,
            height: image.height,
            sizeBytes: image.body.length,
            caption,
            sortOrder: (last?.sortOrder ?? -1) + 1,
            createdBy: actorId,
          },
        });
        await this.audit.record(tx, {
          action: 'property.image_added',
          entityType: 'property',
          entityId: propertyId,
          propertyId,
          after: { imageId: id, sha256: image.sha256 },
        });
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
    return this.list(propertyId);
  }

  async update(
    propertyId: string,
    id: string,
    input: UpdatePropertyImageRequest,
  ): Promise<PropertyImage[]> {
    await this.db.run(async (tx) => {
      const { count } = await tx.propertyImage.updateMany({
        where: { id, propertyId },
        data: input,
      });
      if (count !== 1) throw Problems.notFound('Photo');
    });
    return this.list(propertyId);
  }

  async remove(propertyId: string, id: string): Promise<void> {
    const key = await this.db.run(async (tx) => {
      const row = await tx.propertyImage.findFirst({ where: { id, propertyId } });
      if (!row) throw Problems.notFound('Photo');
      await tx.propertyImage.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'property.image_removed',
        entityType: 'property',
        entityId: propertyId,
        propertyId,
        before: { imageId: id },
      });
      return row.storageKey;
    });
    await this.deleteFile(key);
  }

  async openPropertyImage(propertyId: string, id: string): Promise<OpenImage> {
    const row = await this.db.run((tx) =>
      tx.propertyImage.findFirst({ where: { id, propertyId } }),
    );
    if (!row) throw Problems.notFound('Photo');
    return { etag: row.sha256.slice(0, 16), stream: await this.storage.get(row.storageKey) };
  }

  // ---- Menu item photos ----------------------------------------------------------------

  private async requireItem(propertyId: string, itemId: string) {
    const item = await this.db.run((tx) =>
      tx.menuItem.findFirst({ where: { id: itemId, outlet: { propertyId } } }),
    );
    if (!item) throw Problems.notFound('Menu item');
    return item;
  }

  async setMenuItemImage(
    propertyId: string,
    itemId: string,
    contentType: string | undefined,
    body: unknown,
  ): Promise<{ imageVersion: string }> {
    const image = await processImage(contentType, body);
    const previous = await this.requireItem(propertyId, itemId);
    // A new key per upload, so a cached old photo is never served under the new version.
    const storageKey = `${this.ctx.organizationId}/menu-images/${uuidv7()}`;
    await this.storage.put(storageKey, image.body, 'image/webp', image.sha256);
    await this.db.run(async (tx) => {
      await this.menus.setItemImageInTx(tx, itemId, { key: storageKey, sha256: image.sha256 });
      await this.audit.record(tx, {
        action: 'menu_item.image_set',
        entityType: 'menu_item',
        entityId: itemId,
        propertyId,
        after: { sha256: image.sha256 },
      });
    });
    if (previous.imageKey && previous.imageKey !== storageKey)
      await this.deleteFile(previous.imageKey);
    return { imageVersion: image.sha256.slice(0, 16) };
  }

  async removeMenuItemImage(propertyId: string, itemId: string): Promise<void> {
    const item = await this.requireItem(propertyId, itemId);
    if (!item.imageKey) return;
    await this.db.run(async (tx) => {
      await this.menus.setItemImageInTx(tx, itemId, null);
      await this.audit.record(tx, {
        action: 'menu_item.image_removed',
        entityType: 'menu_item',
        entityId: itemId,
        propertyId,
      });
    });
    await this.deleteFile(item.imageKey);
  }

  /** Staff and guests of the item's property; archived items keep no public photo. */
  async openMenuItemImage(
    propertyId: string,
    itemId: string,
    forGuest: boolean,
  ): Promise<OpenImage> {
    const item = await this.requireItem(propertyId, itemId);
    if (!item.imageKey || !item.imageSha256 || (forGuest && item.archivedAt))
      throw Problems.notFound('Photo');
    return { etag: item.imageSha256.slice(0, 16), stream: await this.storage.get(item.imageKey) };
  }

  private async deleteFile(key: string): Promise<void> {
    await this.storage.delete(key).catch((error: unknown) => {
      this.logger.error(`Could not delete image ${key}: ${String(error)}`);
    });
  }
}

export interface OpenImage {
  etag: string;
  stream: Readable;
}
