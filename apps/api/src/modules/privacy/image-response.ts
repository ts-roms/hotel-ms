import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OpenImage } from './images.service.js';

/** An image, private to whoever may see it; cached until it changes. */
export async function sendImage(req: FastifyRequest, reply: FastifyReply, image: OpenImage) {
  const etag = `"${image.etag}"`;
  if (req.headers['if-none-match'] === etag) {
    image.stream.destroy();
    await reply.status(304).send();
    return;
  }
  await reply
    .header('content-type', 'image/webp')
    .header('etag', etag)
    .header('cache-control', 'private, max-age=86400')
    .header('content-security-policy', "sandbox; default-src 'none'")
    .send(image.stream);
}
