import type { PropertyImage, UpdatePropertyImageRequest } from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Hotel photos shown in the guest portal (ADR-0030). */
export function imagesClient({ call, qs, baseUrl, p, id }: PropertyTransport) {
  return {
    images: () => call<{ items: PropertyImage[] }>('GET', `${p}/images`).then((r) => r.data.items),
    uploadImage: (file: Blob, caption: string) =>
      call<{ items: PropertyImage[] }>('POST', `${p}/images${qs({ caption })}`, file).then(
        (r) => r.data.items,
      ),
    updateImage: (imageId: string, body: UpdatePropertyImageRequest) =>
      call<{ items: PropertyImage[] }>('PATCH', `${p}/images/${id(imageId)}`, body).then(
        (r) => r.data.items,
      ),
    removeImage: (imageId: string) =>
      call<void>('DELETE', `${p}/images/${id(imageId)}`).then((r) => r.data),
    imageUrl: (imageId: string, version: string) =>
      `${baseUrl}${p}/images/${id(imageId)}/content?v=${encodeURIComponent(version)}`,
  };
}
