import type { PropertyImage, UpdatePropertyImageRequest } from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** Hotel photos and menu item images shown in the guest portal (ADR-0030). */
export function imagesClient({ call, baseUrl, propertyId }: PropertyTransport) {
  return {
    images: () =>
      op.ImagesController_list<{ items: PropertyImage[] }>(call, { propertyId }).then(items),
    uploadImage: (file: Blob, caption: string) =>
      op
        .ImagesController_upload<{ items: PropertyImage[] }>(
          call,
          { propertyId },
          { caption },
          file,
        )
        .then(items),
    updateImage: (imageId: string, body: UpdatePropertyImageRequest) =>
      op
        .ImagesController_update<{ items: PropertyImage[] }>(call, { propertyId, imageId }, body)
        .then(items),
    removeImage: (imageId: string) =>
      op.ImagesController_remove(call, { propertyId, imageId }).then(data),
    imageUrl: (imageId: string, version: string) =>
      `${baseUrl}${op.paths.ImagesController_content({ propertyId, imageId })}?v=${encodeURIComponent(version)}`,
    setMenuItemImage: (itemId: string, file: Blob) =>
      op
        .ImagesController_setMenuImage<{ imageVersion: string }>(call, { propertyId, itemId }, file)
        .then(data),
    removeMenuItemImage: (itemId: string) =>
      op.ImagesController_removeMenuImage(call, { propertyId, itemId }).then(data),
    menuItemImageUrl: (itemId: string, version: string) =>
      `${baseUrl}${op.paths.ImagesController_menuImage({ propertyId, itemId })}?v=${encodeURIComponent(version)}`,
  };
}
